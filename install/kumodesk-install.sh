#!/usr/bin/env bash
# KumoDesk – instalacja wewnątrz kontenera / maszyny z Debianem lub Ubuntu.
# Wywoływany przez ct/kumodesk.sh; można też uruchomić ręcznie:
#   curl -fsSL https://raw.githubusercontent.com/kbx07/kumodesk/main/install/kumodesk-install.sh | bash
set -euo pipefail

REPO="${KUMODESK_REPO:-kbx07/kumodesk}"
BRANCH="${KUMODESK_BRANCH:-main}"
PORT="${KUMODESK_PORT:-3003}"
APP_DIR=/opt/kumodesk
DATA_DIR=/var/lib/kumodesk
export DEBIAN_FRONTEND=noninteractive

[[ $EUID -eq 0 ]] || { echo "Uruchom jako root." >&2; exit 1; }

echo "==> Pakiety systemowe"
apt-get update -qq
apt-get install -y -qq curl ca-certificates git gnupg >/dev/null

# Node.js 22 LTS (aplikacja używa wbudowanego node:sqlite – wymaga >= 22.13)
need_node=1
if command -v node >/dev/null; then
  node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)' && need_node=0
fi
if [[ $need_node -eq 1 ]]; then
  echo "==> Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

echo "==> Użytkownik i katalogi"
id kumodesk &>/dev/null || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin kumodesk
mkdir -p "$DATA_DIR"

echo "==> Kod aplikacji ($REPO, gałąź $BRANCH)"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" fetch -q origin "$BRANCH"
  git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
else
  rm -rf "$APP_DIR"
  git clone -q --depth 1 --branch "$BRANCH" "https://github.com/$REPO.git" "$APP_DIR"
fi
(cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
chown -R kumodesk:kumodesk "$APP_DIR" "$DATA_DIR"

echo "==> Usługa systemd"
cat > /etc/systemd/system/kumodesk.service <<EOF
[Unit]
Description=KumoDesk - Ichimoku D1 decision desk
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=kumodesk
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=DATA_DIR=$DATA_DIR
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning server/index.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

# Polecenie `update` – jak w skryptach community-scripts.
cat > /usr/local/bin/update <<EOF
#!/usr/bin/env bash
set -euo pipefail
echo "==> Aktualizacja KumoDesk"
git config --global --add safe.directory $APP_DIR 2>/dev/null || true
git -C $APP_DIR fetch -q origin $BRANCH
git -C $APP_DIR reset -q --hard origin/$BRANCH
(cd $APP_DIR && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
chown -R kumodesk:kumodesk $APP_DIR
systemctl restart kumodesk
echo "==> Gotowe: \$(node -p "require('$APP_DIR/package.json').version")"
EOF
chmod +x /usr/local/bin/update

systemctl daemon-reload
systemctl enable -q --now kumodesk
sleep 2
systemctl is-active -q kumodesk || { journalctl -u kumodesk -n 30 --no-pager; exit 1; }
echo "==> KumoDesk działa na porcie $PORT (dane: $DATA_DIR)"
