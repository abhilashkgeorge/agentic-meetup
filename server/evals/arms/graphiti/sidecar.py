"""
Graphiti as an offline eval arm. Newline-delimited JSON over stdio; no server, no port.

WHY THIS SHAPE
--------------
Graphiti's EntityEdge carries valid_at / invalid_at / expired_at and it invalidates
rather than deletes. That makes it the closest published thing to our bi-temporal
claim, and therefore the arm most likely to match us on everything except provenance.
If it does, "bi-temporal memory" is not a moat and only origin_class survives.

Its RUNTIME is disqualified for production (group_ids=None fails open; an IDOR on
GET /entity-edge/{uuid}) but both are server defects. Here it runs in-process against
an embedded graph, one group per case, over stdio. Neither defect applies.

KEPT LOCAL ON PURPOSE
---------------------
Graphiti defaults to OpenAIEmbedder AND OpenAIRerankerClient when you pass neither, so
an unconfigured instance silently needs an OpenAI key. Both are replaced below with
sentence-transformers running locally, so this arm needs only ANTHROPIC_API_KEY -- the
same key the other arms use. A control that needed a key the rest of the harness does
not would be a different experiment.

KNOWN LIMITATION, STATED RATHER THAN HIDDEN
-------------------------------------------
Cost per turn is NOT measured for this arm. Graphiti owns its own LLM calls and does
not surface usage. Every reported cost here is 0.0 and must be read as "unmeasured",
not "free" -- it makes real Anthropic calls per episode. Do not put this arm's $/turn
in a comparison table without that caveat.
"""
import asyncio
import json
import os
import sys
import warnings
from datetime import datetime, timezone

warnings.filterwarnings('ignore')

from graphiti_core import Graphiti
from graphiti_core.driver.falkordb_driver import FalkorDriver
from graphiti_core.embedder.client import EmbedderClient
from graphiti_core.cross_encoder.client import CrossEncoderClient
from graphiti_core.llm_client.anthropic_client import AnthropicClient
from graphiti_core.llm_client.config import LLMConfig
from graphiti_core.nodes import EpisodeType
from anthropic import AsyncAnthropic

# Sampling parameters were REMOVED on Claude 4.7+ and now return a 400. Graphiti
# 0.30.2's Anthropic client still sends `temperature`, so every extraction call fails
# with "AsyncMessages.create() got an unexpected keyword argument 'temperature'".
#
# Stripping them here rather than pinning an older model: the alternative was Haiku
# 4.5, whose retirement is weeks away, and a control arm running on a different model
# from the other arms would confound the comparison it exists to make.
_DROPPED = ('temperature', 'top_p', 'top_k')


class _CompatMessages:
    def __init__(self, inner):
        self._inner = inner

    def __getattr__(self, name):
        return getattr(self._inner, name)

    async def create(self, **kwargs):
        for k in _DROPPED:
            kwargs.pop(k, None)
        return await self._inner.create(**kwargs)


class CompatAnthropic(AsyncAnthropic):
    @property
    def messages(self):
        return _CompatMessages(super().messages)

MODEL = os.environ.get('GRAPHITI_MODEL', 'claude-sonnet-5')
EMBED_MODEL = os.environ.get('GRAPHITI_EMBED_MODEL', 'sentence-transformers/all-MiniLM-L6-v2')


class LocalEmbedder(EmbedderClient):
    """sentence-transformers, on this machine. No key, no network, deterministic."""

    def __init__(self, name: str = EMBED_MODEL):
        from sentence_transformers import SentenceTransformer
        self.model = SentenceTransformer(name)

    async def create(self, input_data):
        texts = [input_data] if isinstance(input_data, str) else list(input_data)
        vecs = self.model.encode(texts, show_progress_bar=False, convert_to_numpy=True)
        return [float(x) for x in vecs[0]]

    async def create_batch(self, input_data_list):
        vecs = self.model.encode(input_data_list, show_progress_bar=False, convert_to_numpy=True)
        return [[float(x) for x in v] for v in vecs]


class LocalReranker(CrossEncoderClient):
    """
    Embedding cosine as the ranking signal, rather than a trained cross-encoder.

    Weaker than a real reranker, and said plainly: reranking is not what this arm is
    being tested on. What matters is whether Graphiti retires stale edges, and a
    stronger reranker would not change that. Using one would also mean a second model
    download for no measured gain.
    """

    def __init__(self, embedder: LocalEmbedder):
        self.embedder = embedder

    async def rank(self, query, passages):
        if not passages:
            return []
        import numpy as np
        qv = np.array(await self.embedder.create(query))
        pvs = np.array(await self.embedder.create_batch(list(passages)))
        qn = qv / (np.linalg.norm(qv) + 1e-9)
        pn = pvs / (np.linalg.norm(pvs, axis=1, keepdims=True) + 1e-9)
        scores = pn @ qn
        ranked = sorted(zip(passages, scores), key=lambda x: -x[1])
        return [(p, float(s)) for p, s in ranked]


class Arm:
    def __init__(self):
        self.g = None
        self.embedder = None

    async def ensure(self):
        if self.g is not None:
            return
        self.embedder = LocalEmbedder()
        # FalkorDB, not Kuzu. Kuzu is the embedded option and would have avoided a
        # server entirely, but Graphiti deprecated it -- "the upstream Kuzu project is
        # no longer maintained" -- and it is genuinely broken: missing _database
        # attribute, a missing index, then a segfault. FalkorDB is what the same
        # deprecation notice points to.
        #
        # A local container is still a local, disconnected control arm; what is lost
        # is only the "no server" convenience, not the isolation.
        driver = FalkorDriver(
            host=os.environ.get('FALKOR_HOST', 'localhost'),
            port=int(os.environ.get('FALKOR_PORT', '6379')),
            database=os.environ.get('FALKOR_DB', 'evalarm'),
        )
        self.g = Graphiti(
            graph_driver=driver,
            llm_client=AnthropicClient(
                config=LLMConfig(api_key=os.environ['ANTHROPIC_API_KEY'], model=MODEL),
                client=CompatAnthropic(api_key=os.environ['ANTHROPIC_API_KEY']),
            ),
            embedder=self.embedder,
            cross_encoder=LocalReranker(self.embedder),
        )
        await self.g.build_indices_and_constraints()

    async def reset(self, group):
        # Per-case isolation is by group_id, always explicit. This is precisely the
        # parameter whose None-default fails open in Graphiti's server; passing it by
        # hand every time is why that defect does not reach this arm.
        await self.ensure()
        try:
            # Graphiti routes per group by CLONING the driver onto a graph named
            # after the group_id -- execute_query always targets the driver's own
            # database, so querying the parent driver silently hits the wrong graph.
            await self.g.driver.clone(group).execute_query('MATCH (n) DETACH DELETE n')
        except Exception:
            pass  # an empty graph is the normal case on the first reset
        return {'ok': True}

    async def ingest(self, group, text, source):
        await self.ensure()
        await self.g.add_episode(
            name=f'{source}-{datetime.now(timezone.utc).timestamp()}',
            episode_body=text,
            source_description=source,
            reference_time=datetime.now(timezone.utc),
            source=EpisodeType.message,
            group_id=group,
        )
        return {'ok': True, 'costUsd': 0.0}

    async def _edges(self, group, query, limit=10):
        await self.ensure()
        return await self.g.search(query=query, group_ids=[group], num_results=limit)

    async def _entities(self, group, query, limit=5):
        """
        Entity summaries, ranked locally against the query.

        WHY THIS EXISTS, and it is a finding rather than a workaround. On first-person
        personal memory Graphiti produces almost no RELATES_TO edges: it extracts
        entity-to-entity relationships, and "I live in London" has only one entity
        because the speaker is not extracted as a node. A two-episode probe produced
        2 Episodic nodes, 2 Entity nodes and ZERO edges -- and the temporal truth
        ("City the speaker moved to, relocating from London") ended up in an entity
        SUMMARY, which is unstructured prose with no validity window.

        Reading only edges would therefore score this arm on a mechanism that never
        fires for our input and report near-zero, which would flatter us. The rubric
        says build the control to win. So we read where Graphiti actually put the
        knowledge, and report the structural gap separately.
        """
        await self.ensure()
        try:
            recs, _, _ = await self.g.driver.clone(group).execute_query(
                'MATCH (n:Entity) RETURN n.name AS name, n.summary AS summary'
            )
        except Exception:
            return []
        cands = [f"{r['name']}: {r['summary']}" for r in (recs or []) if r.get('summary')]
        if not cands:
            return []
        ranked = await LocalReranker(self.embedder).rank(query, cands)
        return [c for c, _ in ranked[:limit]]

    async def current(self, group, predicate):
        """
        Graphiti's own answer to "what is true now": edges whose invalid_at and
        expired_at are unset -- the bi-temporal read, using its mechanism rather than
        asking a model to summarise the graph. Falls back to entity summaries when
        there are no edges, which for first-person input is the common case.
        """
        term = predicate.replace('_', ' ')
        edges = await self._edges(group, term)
        live = [e for e in edges if e.invalid_at is None and e.expired_at is None]
        if live:
            return {'value': live[0].fact, 'costUsd': 0.0, 'via': 'edge'}
        ents = await self._entities(group, term)
        return {'value': ents[0] if ents else None, 'costUsd': 0.0, 'via': 'entity-summary'}

    async def answer(self, group, question):
        edges = await self._edges(group, question)
        live = [e for e in edges if e.invalid_at is None and e.expired_at is None]
        if live:
            return {'text': ' '.join(e.fact for e in live[:5]), 'costUsd': 0.0, 'via': 'edge'}
        ents = await self._entities(group, question)
        return {'text': ' '.join(ents), 'costUsd': 0.0, 'via': 'entity-summary'}


async def main():
    arm = Arm()
    loop = asyncio.get_event_loop()
    reader = asyncio.StreamReader()
    await loop.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader), sys.stdin)

    while True:
        line = await reader.readline()
        if not line:
            break
        try:
            req = json.loads(line)
            cmd = req.get('cmd')
            if cmd == 'reset':
                out = await arm.reset(req['group'])
            elif cmd == 'ingest':
                out = await arm.ingest(req['group'], req['text'], req.get('source', 'user'))
            elif cmd == 'current':
                out = await arm.current(req['group'], req['predicate'])
            elif cmd == 'answer':
                out = await arm.answer(req['group'], req['question'])
            else:
                out = {'error': f'unknown cmd {cmd}'}
        except Exception as e:  # never die on one bad case
            out = {'error': f'{type(e).__name__}: {e}'}
        sys.stdout.write(json.dumps(out) + '\n')
        sys.stdout.flush()


if __name__ == '__main__':
    asyncio.run(main())
