#!/usr/bin/env bash
# Deploy h-router-relay to a VPS (or install locally).
#
# Usage:
#   ./deploy.sh user@host            # build + scp binary + install + restart on the VPS
#   ./deploy.sh --local              # build + install on this machine (needs sudo)
#   ./deploy.sh --local --no-build   # install the already-built binary only
#
# Remote install does (over ssh, as root or a sudo user):
#   - useradd -r -s /usr/sbin/nologin hrouter        (once)
#   - install -d -o hrouter /etc/h-router
#   - install -m 0600 /etc/h-router/relay.env       (created empty if missing;
#     edit it on the VPS afterwards — secrets live there, never in this repo)
#   - install -m 0755 h-router-relay /usr/local/bin/h-router-relay
#   - install the systemd unit, daemon-reload, enable --now, curl /health
#
# Secrets are never copied by this script. Set them on the target in
# /etc/h-router/relay.env (HROUTER_RELAY_* — see config.example.toml and
# README.md). The relay refuses to start without the env file present
# (the unit uses EnvironmentFile=), so an empty file is created if missing.
set -euo pipefail

RELAY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="$RELAY_DIR/target/release/h-router-relay"
UNIT="$RELAY_DIR/h-router-relay.service"
LISTEN="${HROUTER_RELAY_LISTEN:-127.0.0.1:20129}"

usage() {
  echo "Usage: $0 [--local | user@host] [--no-build]" >&2
  exit 1
}

TARGET=""
NO_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --local) TARGET="--local" ;;
    --no-build) NO_BUILD=1 ;;
    *@*) TARGET="$arg" ;;
    *) usage ;;
  esac
done
[ -n "$TARGET" ] || usage

build_binary() {
  if [ "$NO_BUILD" -eq 1 ]; then
    [ -x "$BIN" ] || { echo "No built binary at $BIN (run without --no-build)" >&2; exit 1; }
    return 0
  fi
  echo "==> Building release binary (offline if the cargo cache is seeded)…"
  export PATH="$HOME/.cargo/bin:$PATH"
  (cd "$RELAY_DIR" && cargo build --release --offline 2>/dev/null \
    || (cd "$RELAY_DIR" && cargo build --release))
  echo "==> Built: $BIN ($(stat -c%s "$BIN" 2>/dev/null || stat -f%z "$BIN") bytes)"
}

check_health() {
  local base="$1"
  echo "==> Checking $base/health …"
  curl -fsS --max-time 5 "$base/health" && echo && echo "OK: relay is up."
}

install_remote() {
  local host="$1"
  echo "==> Copying binary + unit to $host …"
  scp -q "$BIN" "$host:/tmp/h-router-relay"
  scp -q "$UNIT" "$host:/tmp/h-router-relay.service"
  ssh "$host" bash -s <<'EOF'
set -euo pipefail
id hrouter >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin hrouter
install -d -o hrouter -g hrouter /etc/h-router
[ -f /etc/h-router/relay.env ] || install -m 0600 -o hrouter -g hrouter /dev/null /etc/h-router/relay.env
install -m 0755 /tmp/h-router-relay /usr/local/bin/h-router-relay
install -m 0644 /tmp/h-router-relay.service /etc/systemd/system/h-router-relay.service
rm -f /tmp/h-router-relay /tmp/h-router-relay.service
systemctl daemon-reload
systemctl enable --now h-router-relay
systemctl status h-router-relay --no-pager | head -5
EOF
  # The relay binds 127.0.0.1 by default, so check health on the host itself.
  echo "==> Checking health on $host …"
  ssh "$host" curl -fsS --max-time 5 http://127.0.0.1:20129/health && echo && echo "OK: relay is up."
}

install_local() {
  echo "==> Installing locally (sudo) …"
  sudo install -m 0755 "$BIN" /usr/local/bin/h-router-relay
  id hrouter >/dev/null 2>&1 || sudo useradd -r -s /usr/sbin/nologin hrouter
  sudo install -d -o hrouter -g hrouter /etc/h-router
  [ -f /etc/h-router/relay.env ] || sudo install -m 0600 -o hrouter -g hrouter /dev/null /etc/h-router/relay.env
  sudo install -m 0644 "$UNIT" /etc/systemd/system/h-router-relay.service
  sudo systemctl daemon-reload
  sudo systemctl enable --now h-router-relay
  sudo systemctl status h-router-relay --no-pager | head -5
  check_health "http://$LISTEN"
}

build_binary
if [ "$TARGET" = "--local" ]; then
  install_local
else
  install_remote "$TARGET"
fi
echo "==> Done. If this is a first install, edit /etc/h-router/relay.env on the"
echo "    target (HROUTER_RELAY_* secrets) and run: systemctl restart h-router-relay"
