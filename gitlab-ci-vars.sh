#!/usr/bin/env bash
# Push the build-time variables from .env.local into GitLab CI/CD variables.
#
#   export GITLAB_TOKEN=<a PAT with api scope>     # never on the command line
#   bash gitlab-ci-vars.sh
#
# Run it from the tracker repo. It reads .env.local — the file the hand deploys
# have been using — so CI builds the same bundle that has been shipping.
set -euo pipefail

HOST="${GITLAB_HOST:-https://git.bobby.host}"
PROJECT="${GITLAB_PROJECT:-bobby%2Fucelot}"   # URL-encoded path
ENVFILE="${ENVFILE:-.env.local}"

[ -n "${GITLAB_TOKEN:-}" ] || { echo "set GITLAB_TOKEN (a PAT with 'api' scope)" >&2; exit 1; }
[ -f "$ENVFILE" ] || { echo "no $ENVFILE here — run this from the tracker repo" >&2; exit 1; }

# The five the browser bundle actually READS.
#
# Not NEXT_PUBLIC_GITHUB_CLIENT_ID: it survives only in a comment, and a grep
# over source is what put it on this list in the first place. Not
# NEXT_PUBLIC_BETA_ALLOWED_EMAILS either — it has a `?? ""` fallback and is the
# legacy path BETA_ADMIN_EMAILS replaced, so absent is a working configuration.
WANT="
NEXT_PUBLIC_APP_URL
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_AUTH_COOKIE_DOMAIN
NEXT_PUBLIC_GITHUB_APP_SLUG
"

# Parameter expansion rather than sed: the value is arbitrary text — JWTs,
# URLs, comma lists — and every character in it is one more chance to terminate
# a sed expression early, which is exactly how the first version of this failed.
value_of() {
  local key="$1" line
  line=$(grep -E "^(export +)?$key=" "$ENVFILE" | tail -1) || return 1
  [ -n "$line" ] || return 1
  line=${line#export }
  line=${line#*=}
  line=${line%$'\r'}                       # a file saved on Windows
  case $line in \"*\") line=${line#\"}; line=${line%\"};; esac
  case $line in \'*\') line=${line#\'}; line=${line%\'};; esac
  printf '%s' "$line"
}

put() {
  local key="$1" val="$2" code
  code=$(curl -sS -o /tmp/glvar.out -w '%{http_code}' \
    --request POST "$HOST/api/v4/projects/$PROJECT/variables" \
    --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
    --form "key=$key" --form "value=$val" \
    --form "protected=false" --form "masked=false" --form "raw=true")
  case "$code" in
    201) echo "  created  $key"; return 0 ;;
    400)
      grep -q "already been taken" /tmp/glvar.out 2>/dev/null || {
        echo "  FAILED   $key (400): $(cat /tmp/glvar.out)" >&2; return 1; }
      # Exists — update it, so re-running is idempotent rather than an error.
      code=$(curl -sS -o /tmp/glvar.out -w '%{http_code}' \
        --request PUT "$HOST/api/v4/projects/$PROJECT/variables/$key" \
        --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
        --form "value=$val" --form "protected=false" --form "masked=false" --form "raw=true")
      [ "$code" = "200" ] && { echo "  updated  $key"; return 0; }
      echo "  FAILED   $key (update, HTTP $code): $(cat /tmp/glvar.out)" >&2; return 1 ;;
    *) echo "  FAILED   $key (HTTP $code): $(cat /tmp/glvar.out)" >&2; return 1 ;;
  esac
}

missing=""; failed=0
for key in $WANT; do
  # PRESENT-BUT-EMPTY is not the same as ABSENT. NEXT_PUBLIC_AUTH_COOKIE_DOMAIN
  # is deliberately blank — .env.local.example says to leave it empty unless two
  # apps share cookies — so treating empty as missing would report a correct
  # configuration as broken and refuse to copy it.
  if val=$(value_of "$key"); then
    put "$key" "$val" || failed=1
    [ -n "$val" ] || echo "           (empty — copied as-is, which is what is deployed today)"
  else
    missing="$missing $key"
  fi
done

[ -z "$missing" ] || { echo; echo "not in $ENVFILE:$missing" >&2; failed=1; }

echo
echo "Add by hand, in the UI:"
echo "  CLOUDFLARE_API_TOKEN   — MASK this one; it is the only real secret here"
echo "  CLOUDFLARE_ACCOUNT_ID"
exit $failed