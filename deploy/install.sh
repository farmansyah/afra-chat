#!/bin/bash
# Install (or repair) the A.F.R.A ♥ chat on an Ubuntu/Debian server, next to anything else running there.
#   sudo bash deploy/install.sh chat.example.com      (or 203-0-113-5.sslip.io for IP 203.0.113.5)
# Runs the relay as its own service on 127.0.0.1:8090 (memory-capped) and Caddy for HTTPS on ports 80/443.
set -euo pipefail
DOMAIN="${1:?Give the address, e.g. sudo bash deploy/install.sh 203-0-113-5.sslip.io}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_AS="${SUDO_USER:-$(whoami)}"
PORT=8090

echo "==> Python environment"
sudo -u "$RUN_AS" python3 -m venv "$DIR/.venv"
sudo -u "$RUN_AS" "$DIR/.venv/bin/pip" install -q --disable-pip-version-check -r "$DIR/relay/requirements.txt"
sudo -u "$RUN_AS" mkdir -p "$DIR/data"

echo "==> Relay service"
cat > /etc/systemd/system/afra-relay.service <<UNIT
[Unit]
Description=A.F.R.A chat relay
After=network-online.target

[Service]
User=$RUN_AS
WorkingDirectory=$DIR/relay
Environment=RELAY_DATA=$DIR/data WEB_DIR=$DIR/web PUSH_CONTACT=mailto:afra@$DOMAIN
ExecStart=$DIR/.venv/bin/uvicorn relay:app --host 127.0.0.1 --port $PORT --proxy-headers --forwarded-allow-ips 127.0.0.1 --ws-max-size 131072
Restart=always
RestartSec=3
MemoryMax=300M
Nice=10

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now afra-relay
systemctl restart afra-relay

echo "==> Caddy (HTTPS)"
if ! command -v caddy >/dev/null; then
  apt-get install -y -q debian-keyring debian-archive-keyring apt-transport-https curl gpg >/dev/null
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q >/dev/null && apt-get install -y -q caddy >/dev/null
fi
mkdir -p /etc/caddy/sites
cat > /etc/caddy/sites/afra-chat.caddy <<SITE
$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:$PORT
}
SITE
if grep -q "/usr/share/caddy" /etc/caddy/Caddyfile 2>/dev/null; then  # the placeholder page that comes with Caddy
  printf 'import sites/*.caddy\n' > /etc/caddy/Caddyfile
elif ! grep -q "import sites/\*.caddy" /etc/caddy/Caddyfile; then
  printf '\nimport sites/*.caddy\n' >> /etc/caddy/Caddyfile
fi
caddy validate --config /etc/caddy/Caddyfile >/dev/null
systemctl enable --now caddy >/dev/null 2>&1
systemctl reload caddy

echo "==> Done: https://$DOMAIN"
echo "   (ports 80 and 443 must be open in your cloud firewall, e.g. Lightsail > Networking)"
