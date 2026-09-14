#!/usr/bin/env bash
# Prints everything the clone believes about one person, in one screen.
#
# Reads through the OWNER role on purpose: the app role is behind RLS, so a plain
# psql session sees zero rows and looks like data loss when it is actually isolation
# working. Run before and after an import to see exactly what changed.
#
#   ./scripts/what-it-knows.sh            # newest device user
#   ./scripts/what-it-knows.sh <user-id>  # a specific one
set -euo pipefail
cd "$(dirname "$0")/.."

CID=$(docker ps --filter "publish=5433" -q | head -1)
[ -n "$CID" ] || { echo "Postgres container on 5433 is not running."; exit 1; }
q() { docker exec -i "$CID" psql -U clone -d clone "$@"; }

USER_ID="${1:-}"

if [ "$USER_ID" = "--list" ]; then
  q -c "SELECT u.id, t.name AS tenant,
               (SELECT count(*) FROM episodes e WHERE e.user_id=u.id) AS messages,
               (SELECT count(*) FROM facts f WHERE f.user_id=u.id) AS facts,
               greatest(coalesce((SELECT max(occurred_at) FROM episodes e WHERE e.user_id=u.id), u.created_at),
                        coalesce((SELECT max(recorded_at) FROM facts f WHERE f.user_id=u.id), u.created_at)) AS last_used
        FROM app_users u JOIN tenants t ON t.id = u.tenant_id
        ORDER BY facts DESC, messages DESC LIMIT 20;"
  exit 0
fi

if [ -z "$USER_ID" ]; then
  # Ranked by how much is stored, NOT by recency. The test suite writes fresh rows
  # constantly, so "most recent" reliably picks a throwaway fixture over the real
  # account. Volume does not have that problem: nobody's fixtures hold 59 facts.
  USER_ID=$(q -tAc "
    SELECT u.id FROM app_users u
    ORDER BY (SELECT count(*) FROM facts f WHERE f.user_id = u.id)
           + (SELECT count(*) FROM episodes e WHERE e.user_id = u.id) DESC,
             u.created_at DESC
    LIMIT 1")
  [ -n "$USER_ID" ] || { echo "Nobody has used it yet."; exit 0; }
  echo "(no id given -- showing the account with the most stored. ./scripts/what-it-knows.sh --list for others)"
fi

echo "user: $USER_ID"
echo "taken: $(date -u '+%Y-%m-%d %H:%M:%SZ')"

echo
echo "=== WHAT IT BELIEVES NOW ==="
q -c "SELECT predicate, object_text AS value, origin_class AS learned_from, stance,
             corroboration_count AS times_heard
      FROM facts WHERE user_id='$USER_ID' AND status='active' AND valid_to IS NULL
      ORDER BY predicate;"

echo "=== WAITING TO BE CONFIRMED (imported, not yet trusted) ==="
q -c "SELECT predicate, object_text AS value, left(source_quote,70) AS from_this
      FROM facts WHERE user_id='$USER_ID' AND status='staged' ORDER BY predicate;"

echo "=== NO LONGER TRUE (kept, never deleted) ==="
q -c "SELECT predicate, object_text AS value, status,
             coalesce(valid_to::text,'-') AS stopped_being_true
      FROM facts WHERE user_id='$USER_ID'
        AND NOT (status='active' AND valid_to IS NULL) AND status <> 'staged'
      ORDER BY predicate;"

echo "=== THE SUMMARY IT CARRIES INTO EVERY REPLY ==="
q -c "SELECT block_name, token_count AS tokens, content
      FROM core_profile WHERE user_id='$USER_ID' ORDER BY block_name;"

echo "=== QUESTIONS IT WANTS TO ASK YOU ==="
q -c "SELECT kind, status, clarifying_question
      FROM fact_conflicts WHERE user_id='$USER_ID' AND status <> 'resolved';"

echo "=== TOTALS ==="
q -c "SELECT
        (SELECT count(*) FROM episodes WHERE user_id='$USER_ID') AS messages,
        (SELECT count(*) FROM facts WHERE user_id='$USER_ID' AND status='active' AND valid_to IS NULL) AS live_facts,
        (SELECT count(*) FROM facts WHERE user_id='$USER_ID' AND status='staged') AS awaiting_confirmation,
        (SELECT round(coalesce(sum(cost_usd),0)::numeric, 4) FROM llm_calls WHERE user_id='$USER_ID') AS spent_usd;"
