#!/usr/bin/env bash
#
# Replay supabase/migrations into a throwaway Postgres and assert the result
# matches production.
#
# WHY THIS EXISTS. Migrations here are applied by hand to the hosted database,
# which means the files in git are a claim about production rather than a
# description of it — and the claim has been wrong before (issue_embeddings was
# partitioned in production and plain in 0015 for ~48 migrations). That is
# survivable with one database. With two it becomes silent divergence: a second
# region built from these files gets a different schema, and every bug afterwards
# reproduces in only one of them.
#
# This replays the whole chain from empty and checks the shapes that have drifted
# or that the app depends on structurally. Run it before applying anything to a
# hosted database, and before standing up a new region.
#
#   ./scripts/migration-replay/replay.sh          # replay, verify, tear down
#   ./scripts/migration-replay/replay.sh --keep   # leave the container up
#
# Needs Docker. Nothing else — no Supabase CLI, no local Postgres.

set -euo pipefail

CONTAINER=bobby-migration-replay
IMAGE=pgvector/pgvector:pg17
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$(cd "$HERE/../../supabase/migrations" && pwd)"
KEEP=0
[[ "${1:-}" == "--keep" ]] && KEEP=1

psql_() { docker exec "$CONTAINER" psql -U postgres -q -v ON_ERROR_STOP=1 "$@"; }
cleanup() { [[ $KEEP -eq 0 ]] && docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "▸ starting $IMAGE"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=pg "$IMAGE" >/dev/null
for _ in $(seq 1 60); do
    docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
    sleep 1
done

# pg_net ships with Supabase, not with the pgvector image. 0051 does `create
# extension pg_net`, so stub the extension and let bootstrap.sql supply the one
# function the trigger calls. Stubbing it here rather than editing the migration
# keeps the replay honest: the real migration text is what runs.
echo "▸ stubbing pg_net"
docker exec "$CONTAINER" bash -c 'EXT=/usr/share/postgresql/17/extension
printf "comment = '"'"'stub'"'"'\ndefault_version = '"'"'0.1'"'"'\nrelocatable = true\n" > $EXT/pg_net.control
printf -- "-- net.http_post comes from bootstrap.sql\n" > $EXT/pg_net--0.1.sql'

echo "▸ bootstrapping auth/roles/extensions"
docker cp "$HERE/bootstrap.sql" "$CONTAINER:/tmp/bootstrap.sql" >/dev/null
psql_ -f /tmp/bootstrap.sql
# 0003 adds tables to Supabase's realtime publication, which normally already
# exists on a Supabase project.
psql_ -c "create publication supabase_realtime;"

echo "▸ replaying $(ls "$MIGRATIONS"/*.sql | wc -l | tr -d ' ') migrations"
docker cp "$MIGRATIONS" "$CONTAINER:/tmp/migrations" >/dev/null
docker exec "$CONTAINER" bash -c '
    set -e
    for f in $(ls /tmp/migrations/*.sql | sort); do
        if ! out=$(psql -U postgres -q -v ON_ERROR_STOP=1 -f "$f" 2>&1); then
            echo "  ✗ $(basename "$f")"
            echo "$out" | grep -E "ERROR|DETAIL|HINT" | head -8
            exit 1
        fi
    done
    echo "  ✓ all applied"
'

# ── assertions ───────────────────────────────────────────────────────────────
# Each of these encodes something the app structurally depends on, so a future
# migration that quietly changes it fails here rather than in production.
echo "▸ verifying deployed shape"

check() { # name, sql returning one value, expected
    local got
    got=$(docker exec "$CONTAINER" psql -U postgres -tAc "$2")
    if [[ "$got" == "$3" ]]; then
        echo "  ✓ $1"
    else
        echo "  ✗ $1 — expected '$3', got '$got'"
        FAILED=1
    fi
}
FAILED=0

check "issue_embeddings is partitioned" \
    "select relkind from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='tracker' and c.relname='issue_embeddings'" \
    "p"

check "…by hash on project_id" \
    "select pg_get_partkeydef(c.oid) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='tracker' and c.relname='issue_embeddings'" \
    "HASH (project_id)"

check "…into 16 partitions" \
    "select count(*) from pg_inherits where inhparent='tracker.issue_embeddings'::regclass" \
    "16"

check "…keyed (project_id, issue_id)" \
    "select pg_get_constraintdef(oid) from pg_constraint where conrelid='tracker.issue_embeddings'::regclass and contype='p'" \
    "PRIMARY KEY (project_id, issue_id)"

# The composite FK the access-group grants hang off. Dropping the unique it
# depends on would break Collections silently.
check "projects has the (id, team_id) unique" \
    "select count(*) from pg_constraint where conrelid='tracker.projects'::regclass and contype='u' and pg_get_constraintdef(oid)='UNIQUE (id, team_id)'" \
    "1"

# Placement lives on the TEAM (0064), not the project — a request resolves its
# team from the request header before any regional read, which is what removes
# the circular "read the project to find out where the project lives".
check "teams.region + teams.cell exist" \
    "select count(*) from information_schema.columns where table_schema='tracker' and table_name='teams' and column_name in ('region','cell')" \
    "2"

check "projects carries NO placement columns" \
    "select count(*) from information_schema.columns where table_schema='tracker' and table_name='projects' and column_name in ('region','cell')" \
    "0"

# RLS is now a reachability fuse (0067), not an authorization system: enabled
# everywhere so a leaked anon key reads nothing, with policies only on the tables
# the browser actually connects to.
check "RLS is enabled on every tracker table" \
    "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='tracker' and c.relkind in ('r','p') and not c.relrowsecurity" \
    "0"

check "tenant tables have NO policies left" \
    "select count(*) from pg_policies where schemaname='tracker' and tablename in ('projects','issues','issue_embeddings','issue_comments','pull_requests','public_sessions','project_groups','team_members','teams')" \
    "0"

# Non-negotiable: the anon key is public, so anything the browser subscribes to
# must still enforce. Losing these is a full disclosure, not a degradation.
check "realtime tables KEEP their policies" \
    "select count(distinct tablename) from pg_policies where schemaname='tracker' and tablename in ('project_analyser','issue_suggestions','notifications')" \
    "3"

# Re-applying must be safe. This is the path a HOSTED database takes: it already
# has the partitioned table, so 0063 has to detect that and return rather than
# rebuild. Getting this wrong would drop live embeddings, so it is checked here
# rather than discovered by applying it.
echo "▸ re-applying 0063 (the hosted-database path)"
if docker exec "$CONTAINER" psql -U postgres -q -v ON_ERROR_STOP=1 \
        -f /tmp/migrations/0063_issue_embeddings_partitioned.sql >/dev/null 2>&1; then
    check "0063 is idempotent — partitions survive re-application" \
        "select count(*) from pg_inherits where inhparent='tracker.issue_embeddings'::regclass" \
        "16"
else
    echo "  ✗ 0063 failed on re-application"
    FAILED=1
fi

# ── table-level parity against production ────────────────────────────────────
# A clean replay proves the migrations are self-consistent, not that they match
# the hosted database. This diff catches the two ways they drift apart.
echo "▸ diffing tables against the production snapshot"
docker exec "$CONTAINER" psql -U postgres -tAc \
    "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='tracker' and c.relkind in ('r','p')
       and c.relname not like 'issue_embeddings_p%' order by 1" \
    | sed '/^$/d' > /tmp/replay-tables.txt
grep -vE '^\s*(#|$)' "$HERE/production-tables.txt" | sort > /tmp/prod-tables.txt

# In the migrations but NOT in production: a migration that never landed. Code
# that touches these is failing in production right now, so this is an error.
MISSING=$(comm -13 /tmp/prod-tables.txt /tmp/replay-tables.txt || true)
if [[ -n "$MISSING" ]]; then
    echo "  ✗ migrations create tables production does not have (unapplied migration?):"
    echo "$MISSING" | sed 's/^/      /'
    FAILED=1
else
    echo "  ✓ every migrated table exists in production"
fi

# In production but NOT in the migrations: DDL from outside this repo, i.e.
# bobby-analyser. Reported, not failed — it is expected today, but it is exactly
# how issue_embeddings drifted, so it should stay visible.
EXTRA=$(comm -23 /tmp/prod-tables.txt /tmp/replay-tables.txt || true)
if [[ -n "$EXTRA" ]]; then
    echo "  ⚠ production has tables no migration creates (analyser-owned DDL):"
    echo "$EXTRA" | sed 's/^/      /'
fi

echo
if [[ $FAILED -eq 0 ]]; then
    echo "✅ migrations replay clean and match the deployed shape"
else
    echo "❌ replay succeeded but the resulting schema differs from production"
    exit 1
fi

[[ $KEEP -eq 1 ]] && echo "container kept: docker exec -it $CONTAINER psql -U postgres"
exit 0
