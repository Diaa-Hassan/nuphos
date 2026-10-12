#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${OPENAB_CREDENTIALS_DIR:-}" ]]; then
  NUPHOS_TOKEN=$(cat "$OPENAB_CREDENTIALS_DIR/NUPHOS_TOKEN" 2>/dev/null || true)
  export NUPHOS_TOKEN
fi

if [ "$#" -ne 2 ]; then
  echo "Usage: setup-credentials.sh <teamId> <bindingId>" >&2
  exit 2
fi

team_id="$1"
binding_id="$2"
base="${NUPHOS_BACKEND_URL:-${NUPHOS_API_URL:-https://api.nuphos.ai}}"
base="${base%/}"

urlencode() {
  python3 - "$1" <<'PY'
import sys, urllib.parse
print(urllib.parse.quote(sys.argv[1], safe=""))
PY
}

read_local_nuphos_token() {
  python3 <<'PY'
from pathlib import Path
import re
path = Path.home() / ".config" / "nuphos" / "cli.yaml"
try:
    text = path.read_text()
except FileNotFoundError:
    raise SystemExit(0)
match = re.search(r'(?m)^token:\s*(.+?)\s*$', text)
if match:
    token = match.group(1).strip()
    if (token.startswith('"') and token.endswith('"')) or (token.startswith("'") and token.endswith("'")):
        token = token[1:-1]
    print(token)
PY
}

auth_token="${NUPHOS_TOKEN:-}"
if [ -z "$auth_token" ]; then
  auth_token="$(read_local_nuphos_token || true)"
fi
if [ -z "$auth_token" ]; then
  echo "NUPHOS_TOKEN is not set and ~/.config/nuphos/cli.yaml has no token" >&2
  exit 1
fi

team_enc="$(urlencode "$team_id")"
binding_enc="$(urlencode "$binding_id")"
path="/teams/${team_enc}/mixpanel-accounts/${binding_enc}/credentials"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

curl -fsSL \
  --connect-timeout 10 \
  --max-time 30 \
  --retry 3 \
  --retry-delay 1 \
  --retry-connrefused \
  -H "Authorization: Bearer ${auth_token}" \
  -H "Accept: application/json" \
  "${base}${path}" > "$tmp"

mkdir -p "$HOME/.mixpanel"
chmod 700 "$HOME/.mixpanel"

# 600 before writing, so the secret never exists under a permissive umask.
touch "$HOME/.mixpanel/nuphos.env"
chmod 600 "$HOME/.mixpanel/nuphos.env"

python3 - "$tmp" "$HOME/.mixpanel/nuphos.env" <<'PY'
import json, shlex, sys
src, dst = sys.argv[1], sys.argv[2]
data = json.load(open(src))

# Validate before opening `dst` for writing: open(dst, "w") truncates, so a
# malformed-but-successful response would wipe working credentials on the way
# to failing.
username = (data.get("username") or "").strip()
secret = (data.get("secret") or "").strip()
api_host = (data.get("apiHost") or "").strip()
data_host = (data.get("dataHost") or "").strip()
if not username or not secret or not api_host or not data_host:
    raise SystemExit("Credentials response is incomplete; re-bind the Mixpanel account.")

with open(dst, "w") as f:
    f.write("unset MIXPANEL_USERNAME MIXPANEL_SECRET\n")
    f.write(f"export MIXPANEL_USERNAME={shlex.quote(username)}\n")
    f.write(f"export MIXPANEL_SECRET={shlex.quote(secret)}\n")
    f.write(f"export MIXPANEL_REGION={shlex.quote(str(data.get('region', '')))}\n")
    f.write(f"export MIXPANEL_API_HOST={shlex.quote(api_host)}\n")
    f.write(f"export MIXPANEL_DATA_HOST={shlex.quote(data_host)}\n")
    f.write(f"export MIXPANEL_BINDING_ID={shlex.quote(str(data.get('bindingId', '')))}\n")
PY

chmod 600 "$HOME/.mixpanel/nuphos.env"
echo "Wrote Mixpanel credentials to ~/.mixpanel/nuphos.env"
