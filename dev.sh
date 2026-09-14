#!/usr/bin/env bash
#
# Start everything, and make the addresses correct by construction.
#
# The failure this replaces: the app derived the server's address from Metro's host.
# With Metro not running that returns nothing and it falls back to localhost, which on
# a phone means the phone itself -- so the symptom was "could not reach the server"
# with the server running perfectly the whole time. The Mac's DHCP lease moving, or a
# router with client isolation, produced the identical dead end.
#
# A tunnel removes the class of problem, and it is not optional anyway: grader links
# are opened by friends on their own phones, off your WiFi, so a LAN address can never
# work for them.
#
#   ./dev.sh          server + tunnel + metro
#   ./dev.sh --lan    server + metro only, LAN addresses (no tunnel)
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8000}"
USE_TUNNEL=1
[ "${1:-}" = "--lan" ] && USE_TUNNEL=0

cleanup() { jobs -p | xargs kill 2>/dev/null || true; }
trap cleanup EXIT INT TERM

# --- 1. server ---------------------------------------------------------------
if lsof -ti:"$PORT" >/dev/null 2>&1; then
  echo "→ server already listening on $PORT, leaving it alone"
else
  echo "→ starting server on $PORT"
  (cd server && npm run dev) &
  for _ in $(seq 1 40); do
    curl -sf -m 2 "http://localhost:$PORT/health" >/dev/null 2>&1 && break
    sleep 1
  done
fi
curl -sf -m 2 "http://localhost:$PORT/health" >/dev/null 2>&1 \
  || { echo "✗ server did not come up on $PORT"; exit 1; }

# --- 2. address the phone will use -------------------------------------------
#
# A tunnel URL that is printed is not a tunnel URL that works: cloudflared's quick
# tunnels announce a hostname before publishing DNS for it, and on some networks the
# DNS never appears at all. So every candidate is USED only after something answers
# on it. Printing an address nobody can reach is the exact failure this replaces.
BASE=""

works() { curl -sf -m 8 "$1/health" >/dev/null 2>&1; }

try_cloudflared() {
  command -v cloudflared >/dev/null 2>&1 || return 1
  echo "→ trying cloudflared"
  cloudflared tunnel --url "http://localhost:$PORT" --no-autoupdate > /tmp/cf.log 2>&1 &
  local url=""
  for _ in $(seq 1 20); do
    url=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/cf.log 2>/dev/null | head -1)
    [ -n "$url" ] && break
    sleep 1
  done
  [ -n "$url" ] || return 1
  # Up to 40s for DNS. If it never publishes, this tunnel is useless to a phone.
  for _ in $(seq 1 20); do
    works "$url" && { BASE="$url"; return 0; }
    sleep 2
  done
  echo "  cloudflared URL never became reachable — dropping it"
  pkill -f "cloudflared tunnel --url http://localhost:$PORT" 2>/dev/null || true
  return 1
}

try_ngrok() {
  command -v ngrok >/dev/null 2>&1 || return 1
  echo "→ trying ngrok"
  if ! curl -sf -m 2 http://127.0.0.1:4040/api/tunnels >/dev/null 2>&1; then
    # A reserved domain, if you have one, makes the URL stable across restarts --
    # which is what lets the app bake it in once instead of on every rebuild.
    if [ -n "${NGROK_DOMAIN:-}" ]; then
      ngrok http "$PORT" --domain "$NGROK_DOMAIN" --log stdout > /tmp/ngrok.log 2>&1 &
    else
      ngrok http "$PORT" --log stdout > /tmp/ngrok.log 2>&1 &
    fi
  fi
  local url=""
  for _ in $(seq 1 30); do
    url=$(curl -sf -m 2 http://127.0.0.1:4040/api/tunnels 2>/dev/null \
      | python3 -c 'import sys,json;t=json.load(sys.stdin)["tunnels"];print(next((x["public_url"] for x in t if x["public_url"].startswith("https")), ""))' 2>/dev/null || true)
    [ -n "$url" ] && works "$url" && { BASE="$url"; return 0; }
    sleep 1
  done
  return 1
}

if [ "$USE_TUNNEL" = "1" ]; then
  try_cloudflared || try_ngrok || echo "! no tunnel — falling back to LAN"
fi

if [ -z "$BASE" ]; then
  IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")
  [ -n "$IP" ] || { echo "✗ no LAN address and no tunnel"; exit 1; }
  BASE="http://$IP:$PORT"
  echo "! LAN address: only works if the router lets your phone see this Mac."
fi

# --- 3. write it where both sides read it ------------------------------------
# Grader links are built server-side and opened on other people's phones, so the
# server has to know its own public name. It cannot infer it from a request.
python3 - "$BASE" <<'PY'
import pathlib, sys, re
base = sys.argv[1]
for path, key in [('server/.env', 'PUBLIC_BASE_URL'), ('app/.env', 'EXPO_PUBLIC_API_URL')]:
    p = pathlib.Path(path)
    text = p.read_text() if p.exists() else ''
    line = f'{key}={base}'
    if re.search(rf'^{key}=.*$', text, re.M):
        text = re.sub(rf'^{key}=.*$', line, text, flags=re.M)
    else:
        text = (text.rstrip('\n') + '\n' if text else '') + line + '\n'
    p.write_text(text)
    print(f'  {path}: {line}')
PY

# --- 4. USB, when a phone is plugged in ------------------------------------------
#
# A debug build loads its JavaScript from Metro, so Metro has to be reachable from the
# phone -- and on a router with client isolation it is not, no matter how correct the
# addresses are. `adb reverse` makes the phone's own localhost point at this Mac
# through the cable, which no network policy can interfere with.
#
# Deliberately NOT used for the API. Pointing the app at localhost works beautifully
# until the cable comes out, and then the phone is calling itself with no clue why --
# which is exactly how the last outage happened. Metro over USB, API over the tunnel:
# unplugging then costs a reload, not a mystery.
ADB="${ADB:-$(command -v adb || echo /Volumes/Development/Macbook-Apps/AndroidSdk/platform-tools/adb)}"
if [ -x "$ADB" ] && [ -n "$("$ADB" devices | sed -n '2p')" ]; then
  "$ADB" reverse tcp:8081 tcp:8081 >/dev/null 2>&1 && echo "→ metro reachable over USB"
else
  echo "! no android device on USB — the phone must reach Metro over WiFi"
fi

echo
echo "  server   http://localhost:$PORT"
echo "  phone    $BASE"
echo "  stats    $BASE/stats"
echo
echo "→ starting metro (leave this running)"
(cd app && npx expo start) &
wait
