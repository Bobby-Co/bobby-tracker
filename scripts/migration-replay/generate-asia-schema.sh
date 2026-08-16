#!/usr/bin/env bash
#
# Regenerate asia-full-schema.sql — the whole migration chain as ONE script, for
# bootstrapping a new regional Supabase project from the SQL Editor (no CLI
# needed). Run after adding any migration.
#
# The header is written here rather than scraped back out of the previous output:
# round-tripping it through sed made regeneration depend on the last run's
# formatting, which silently produced a file containing the old schema twice.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$HERE/../../supabase/migrations"
OUT="$HERE/asia-full-schema.sql"

{
    cat <<'HDR'
-- asia-full-schema.sql — the ENTIRE tracker migration chain, concatenated in
-- order, for bootstrapping a NEW Supabase project as a regional data plane.
--
-- GENERATED FILE — do not edit. Regenerate with:
--   scripts/migration-replay/generate-asia-schema.sh
--
-- HOW TO USE: paste into the new project's SQL Editor and run once. It is the
-- same chain applied to the primary, so the regional database starts
-- structurally identical. Run regional-node-setup.sql afterwards — that is the
-- one that severs the constraints which cannot span two databases.
--
-- WHY THE FULL CHAIN, including control-plane tables the region will never use:
-- one migration chain is worth far more than a lean schema. Two chains means
-- every future migration needs a judgement call about where it belongs, and the
-- replay harness could only verify one of them. The unused tables cost nothing
-- but disk.
--
-- PLACEMENT IS PER TEAM (0064). A team lives in exactly one cell and everything
-- it owns is served from there, so a request resolves its region once — from the
-- team it already loaded out of the control plane — and never has to read
-- regional data to find out where regional data lives.
--
-- A useful side effect: because `team_members` is EMPTY in a regional database,
-- every inherited RLS policy there already evaluates to false — is_team_member()
-- can never find a row. The regional data plane is deny-all to
-- `authenticated`/`anon` and reachable only by service_role, which bypasses RLS.
-- Exactly the posture we want, with no extra policy migration.
HDR

    # Glob directly instead of `$(ls …)`: the repo path contains a space, and
    # word-splitting the command substitution shredded every filename.
    #
    # The marker carries a token no migration body uses. Counting bare filenames
    # over-counted, because two migrations open with their own name on a line.
    for f in "$MIGRATIONS"/*.sql; do
        printf '\n\n-- ═══ MIGRATION: %s ═══\n\n' "$(basename "$f")"
        cat "$f"
    done
} > "$OUT.tmp"

# Verify BEFORE publishing, so a bad generation can't overwrite a good file.
expected=$(find "$MIGRATIONS" -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')
actual=$(grep -c '^-- ═══ MIGRATION: ' "$OUT.tmp")
if [[ "$expected" != "$actual" ]]; then
    rm -f "$OUT.tmp"
    echo "✗ expected $expected migrations, embedded $actual — $OUT left untouched" >&2
    exit 1
fi

mv "$OUT.tmp" "$OUT"
echo "✓ $OUT — $actual migrations, $(wc -l < "$OUT" | tr -d ' ') lines"
