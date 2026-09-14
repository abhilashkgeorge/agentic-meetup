#!/usr/bin/env bash
# Sets up the Graphiti control arm. Run once.
set -euo pipefail
cd "$(dirname "$0")"

# Python 3.12, not 3.14: ensurepip fails on 3.14 and torch has no wheels for it.
/opt/homebrew/bin/python3.12 -m venv .venv
./.venv/bin/pip install --quiet --upgrade pip
# falkordb, not kuzu: Graphiti deprecated Kuzu ("no longer maintained") and it is
# genuinely broken -- missing _database attribute, missing index, then a segfault.
./.venv/bin/pip install 'graphiti-core[falkordb,anthropic,sentence-transformers]'

# FalkorDB. A local container, so the arm is still offline in the sense that matters:
# it talks to nothing outside this machine except the same Anthropic API the other
# arms use.
docker rm -f clone-falkor >/dev/null 2>&1 || true
docker run -d --name clone-falkor -p 6379:6379 falkordb/falkordb:latest >/dev/null
until docker exec clone-falkor redis-cli PING >/dev/null 2>&1; do sleep 1; done

echo "graphiti arm ready. First run downloads the sentence-transformers model (~90MB)."
