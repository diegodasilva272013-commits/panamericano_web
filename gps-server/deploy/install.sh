#!/usr/bin/env bash
# Instala el receptor GPS en un VPS Ubuntu 22.04/24.04 (como root). Se puede volver a ejecutar: actualiza sin tocar el .env.
#   curl -fsSL https://raw.githubusercontent.com/diegodasilva272013-commits/panamericano_web/main/gps-server/deploy/install.sh | sudo bash
# o, con el repositorio ya clonado:   sudo bash gps-server/deploy/install.sh
set -euo pipefail

REPO="https://github.com/diegodasilva272013-commits/panamericano_web.git"
DIR=/opt/panamericano
PORT="${GPS_PORT:-4031}"

[ "$(id -u)" = 0 ] || { echo "Ejecutalo como root (sudo)."; exit 1; }

echo "==> Paquetes base"
apt-get update -y
apt-get install -y curl git ufw ca-certificates

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "==> Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "==> Usuario sin privilegios"
id gps >/dev/null 2>&1 || useradd --system --home "$DIR" --shell /usr/sbin/nologin gps

echo "==> Código"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else rm -rf "$DIR" && git clone --depth 1 "$REPO" "$DIR"; fi
cd "$DIR/gps-server"
npm ci --omit=dev 2>/dev/null || npm install --omit=dev

if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  echo "!! Falta completar $DIR/gps-server/.env (SUPABASE_SERVICE_ROLE_KEY). Después: systemctl restart gps-receptor"
fi
chown -R gps:gps "$DIR"
chmod 600 .env

echo "==> Servicio"
install -m 644 deploy/gps-receptor.service /etc/systemd/system/gps-receptor.service
systemctl daemon-reload
systemctl enable gps-receptor
if grep -q '^SUPABASE_SERVICE_ROLE_KEY=.\+' .env; then systemctl restart gps-receptor; else echo "(el servicio arranca cuando completes el .env)"; fi

echo "==> Firewall: solo SSH y el puerto de los equipos (UDP y TCP)"
ufw allow OpenSSH
ufw allow "${PORT}/udp"
ufw allow "${PORT}/tcp"
ufw --force enable

echo
echo "Listo. Ver el estado:   systemctl status gps-receptor    ·    journalctl -u gps-receptor -f"
echo "Estado interno:         curl -s http://127.0.0.1:8081"
