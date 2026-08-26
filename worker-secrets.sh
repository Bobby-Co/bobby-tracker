#!/usr/bin/env bash
# Move the runtime config out of .env and onto the Worker, where it is read at
# RUNTIME instead of being baked in by whoever happened to run the build.
#
#   bash worker-secrets.sh          # show what would be uploaded
#   bash worker-secrets.sh --apply  # upload it
#
# ─── Why ────────────────────────────────────────────────────────────────────
#
# .env is gitignored, so it exists on a laptop and nowhere else. Next.js loads it
# at build time, which is why hand deploys worked: the values were baked into the
# bundle. The CI runner has no .env, so the Worker it built had no analyser URL,
# no cell manifest and no GitHub App key — and PR analysis stopped rather than
# failing loudly, because an absent URL reads as "no analyser configured".
#
# Worker secrets are read at runtime and survive every deploy, so once these are
# set it does not matter which machine builds. That is the actual fix; putting
# them in CI would just move the dependency to a second laptop.
set -euo pipefail

ENVFILE="${ENVFILE:-.env}"
[ -f "$ENVFILE" ] || { echo "no $ENVFILE here — run this from the tracker repo" >&2; exit 1; }

# Everything the app reads at runtime. NEXT_PUBLIC_* are deliberately absent:
# they are inlined into the browser bundle at BUILD time, so a Worker secret
# would never be consulted. Those belong in CI, and only those.
KEYS=$(grep -oE "^(export +)?[A-Z][A-Z0-9_]+=" "$ENVFILE" | sed 's/^export //; s/=$//' | grep -v '^NEXT_PUBLIC_' | sort -u)

# node --env-file parses dotenv properly — quoted, multi-line values included.
# GITHUB_APP_PRIVATE_KEY is a 26-line PEM, and a line-by-line reader truncates it
# at the first newline, which produces a Worker that authenticates against
# nothing and says so only when a webhook arrives.
JSON=$(node --env-file="$ENVFILE" -e '
  const keys = process.argv.slice(1);
  const out = {};
  for (const k of keys) {
    const v = process.env[k];
    if (v !== undefined && v !== "") out[k] = v;   // empty is not a secret
  }
  process.stdout.write(JSON.stringify(out));
' $KEYS)

COUNT=$(printf '%s' "$JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(Object.keys(JSON.parse(s)).length))')

if [ "${1:-}" != "--apply" ]; then
  echo "Would upload $COUNT secret(s) to the Worker:"
  printf '%s' "$JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const [k,v] of Object.entries(JSON.parse(s))) console.log("  "+k.padEnd(42)+v.length+" chars")})'
  echo
  echo "Values are never printed. Re-run with --apply to upload."
  exit 0
fi

echo "Uploading $COUNT secret(s)…"
printf '%s' "$JSON" | bunx wrangler secret bulk
echo
echo "Done. Verify with:  bunx wrangler secret list"
echo "These take effect immediately — no redeploy needed."
