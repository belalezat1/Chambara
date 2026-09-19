#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-5173}"
if ! [[ "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "Port must be between 1 and 65535." >&2
  exit 1
fi

ORIGIN="http://127.0.0.1:${PORT}"
if ! curl -fsS --max-time 5 "$ORIGIN" >/dev/null; then
  echo "Game server is not responding at $ORIGIN. Run npm run dev in another terminal first." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLS_DIR="${SCRIPT_DIR}/../.tools"
HOSTS_MARKER="# chambara-trycloudflare-tunnel"

if command -v cloudflared >/dev/null 2>&1; then
  TUNNEL_EXECUTABLE="$(command -v cloudflared)"
else
  ARCH="$(uname -m)"
  case "$ARCH" in
    arm64|aarch64) CLOUDFLARED_ASSET="cloudflared-darwin-arm64.tgz" ;;
    x86_64|amd64) CLOUDFLARED_ASSET="cloudflared-darwin-amd64.tgz" ;;
    *)
      echo "Unsupported architecture: $ARCH" >&2
      exit 1
      ;;
  esac

  TUNNEL_EXECUTABLE="${TOOLS_DIR}/cloudflared"
  if [[ ! -x "$TUNNEL_EXECUTABLE" ]]; then
    mkdir -p "$TOOLS_DIR"
    DOWNLOAD_PATH="${TOOLS_DIR}/cloudflared.download.tgz"
    echo "Downloading cloudflared from the official Cloudflare release..."
    curl -fsSL \
      "https://github.com/cloudflare/cloudflared/releases/latest/download/${CLOUDFLARED_ASSET}" \
      -o "$DOWNLOAD_PATH"
    tar -xzf "$DOWNLOAD_PATH" -C "$TOOLS_DIR" cloudflared
    rm -f "$DOWNLOAD_PATH"
    chmod +x "$TUNNEL_EXECUTABLE"
  fi
fi

LOG_FILE="$(mktemp -t chambara-tunnel.XXXXXX.log)"
HOSTS_PATCHED=0
PUBLIC_HOST=""

remove_hosts_patch() {
  if [[ "$HOSTS_PATCHED" -ne 1 || -z "$PUBLIC_HOST" ]]; then
    return 0
  fi
  if [[ "$(uname -s)" != "Darwin" ]]; then
    return 0
  fi
  osascript >/dev/null 2>&1 <<'EOF' || true
do shell script "sed -i '' '/chambara-trycloudflare-tunnel/d' /etc/hosts" with administrator privileges
EOF
  dscacheutil -flushcache >/dev/null 2>&1 || true
  killall -HUP mDNSResponder >/dev/null 2>&1 || true
  HOSTS_PATCHED=0
}

cleanup() {
  remove_hosts_patch
  if [[ -n "${TAIL_PID:-}" ]]; then
    kill "$TAIL_PID" 2>/dev/null || true
  fi
  if [[ -n "${TUNNEL_PID:-}" ]] && kill -0 "$TUNNEL_PID" 2>/dev/null; then
    kill "$TUNNEL_PID" 2>/dev/null || true
    wait "$TUNNEL_PID" 2>/dev/null || true
  fi
  rm -f "$LOG_FILE"
}
trap cleanup EXIT INT TERM

resolve_via_public_dns() {
  local host="$1"
  dig +short +time=3 +tries=2 "$host" @1.1.1.1 A 2>/dev/null | awk '/^[0-9]+\./ { print; exit }'
}

system_resolves() {
  local host="$1"
  python3 - <<PY >/dev/null 2>&1
import socket
socket.getaddrinfo("${host}", 443)
PY
}

install_hosts_patch() {
  local host="$1"
  local ip="$2"
  if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "Add this line to /etc/hosts (requires admin), then reload the page:" >&2
    echo "  ${ip} ${host}" >&2
    return 1
  fi

  echo
  echo "Your network DNS cannot resolve *.trycloudflare.com."
  echo "macOS will ask for your password once to add a temporary /etc/hosts entry."
  echo "It is removed when you stop the tunnel (Ctrl+C)."
  echo

  local line="${ip} ${host} ${HOSTS_MARKER}"
  # AppleScript string: escape backslashes and double quotes only.
  local as_line="${line//\\/\\\\}"
  as_line="${as_line//\"/\\\"}"

  if ! osascript <<EOF
do shell script "grep -F 'chambara-trycloudflare-tunnel' /etc/hosts >/dev/null 2>&1 || printf '%s\\n' \"${as_line}\" >> /etc/hosts" with administrator privileges
EOF
  then
    echo "Could not update /etc/hosts (password cancelled or denied)." >&2
    echo "Manual fix — run this, then keep the tunnel running:" >&2
    echo "  sudo sh -c 'printf \"%s\\n\" \"${line}\" >> /etc/hosts' && sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder" >&2
    echo "Or set Wi‑Fi DNS to 1.1.1.1 and 8.8.8.8 in System Settings → Network → Wi‑Fi → Details → DNS." >&2
    return 1
  fi

  dscacheutil -flushcache >/dev/null 2>&1 || true
  killall -HUP mDNSResponder >/dev/null 2>&1 || true
  HOSTS_PATCHED=1
  PUBLIC_HOST="$host"

  sleep 0.5
  if system_resolves "$host"; then
    echo "Hosts patch OK — ${host} → ${ip}"
    return 0
  fi

  echo "Hosts patch applied but system resolver still fails. Try:" >&2
  echo "  sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder" >&2
  return 1
}

echo "Starting Cloudflare quick tunnel → ${ORIGIN}"
echo "Keep this terminal open. Press Ctrl+C to stop."
echo

"$TUNNEL_EXECUTABLE" tunnel --url "$ORIGIN" --protocol http2 >"$LOG_FILE" 2>&1 &
TUNNEL_PID=$!

PUBLIC_URL=""
for _ in $(seq 1 45); do
  if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
    echo "cloudflared exited early. Last log lines:" >&2
    tail -40 "$LOG_FILE" >&2 || true
    exit 1
  fi
  PUBLIC_URL="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_FILE" | head -1 || true)"
  if [[ -n "$PUBLIC_URL" ]]; then
    break
  fi
  sleep 0.5
done

if [[ -z "$PUBLIC_URL" ]]; then
  echo "Timed out waiting for a trycloudflare.com URL. Log:" >&2
  tail -60 "$LOG_FILE" >&2 || true
  exit 1
fi

PUBLIC_HOST="${PUBLIC_URL#https://}"
echo "Tunnel URL:  ${PUBLIC_URL}"
echo

if system_resolves "$PUBLIC_HOST"; then
  echo "DNS: OK (system resolver)"
else
  PUBLIC_IP="$(resolve_via_public_dns "$PUBLIC_HOST")"
  if [[ -z "$PUBLIC_IP" ]]; then
    echo "WARNING: Could not resolve ${PUBLIC_HOST} via 1.1.1.1 either." >&2
    echo "Check network / firewall, then retry." >&2
  else
    install_hosts_patch "$PUBLIC_HOST" "$PUBLIC_IP" || true
  fi
fi

if system_resolves "$PUBLIC_HOST"; then
  HTTP_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "${PUBLIC_URL}/" || echo 000)"
  if [[ "$HTTP_CODE" == "200" ]]; then
    echo "Reachability check: OK (HTTP ${HTTP_CODE})"
  else
    echo "WARNING: Resolved, but HTTP returned ${HTTP_CODE}. Wait a few seconds and retry in the browser." >&2
  fi
  echo
else
  echo
  echo "Tunnel is running, but this Mac still cannot resolve the URL."
  echo "After fixing DNS/hosts, open:"
  echo "  ${PUBLIC_URL}"
  echo
fi

echo "On this computer, open:"
echo "  ${PUBLIC_URL}"
echo "Then use Copy controller link / QR (must be the trycloudflare URL, not localhost)."
echo
echo "Streaming cloudflared log (Ctrl+C stops the tunnel)..."
echo "----------------------------------------------------------------"
tail -n +1 -f "$LOG_FILE" &
TAIL_PID=$!
wait "$TUNNEL_PID"
EXIT_CODE=$?
kill "$TAIL_PID" 2>/dev/null || true
TAIL_PID=""
exit "$EXIT_CODE"
