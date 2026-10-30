#!/usr/bin/env bash
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/ars}
DEPLOY_USER=${DEPLOY_USER:-deploy}

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo DOMAIN=racing.example.com ./setup-vps.sh" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

if [ -z "$(swapon --show --noheadings)" ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
touch "/home/$DEPLOY_USER/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"

if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow 443/udp
  ufw --force enable
fi

install -d -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR" "$APP_DIR/backups"

if [ ! -f "$APP_DIR/.env" ]; then
  : "${DOMAIN:?set DOMAIN, e.g. DOMAIN=racing.example.com}"
  : "${DISCORD_WEBHOOK_URL:?set DISCORD_WEBHOOK_URL to the Discord channel webhook that receives alerts}"
  cat > "$APP_DIR/.env" <<ENV
DOMAIN=$DOMAIN
IMAGE_TAG=latest
REGISTRY=${REGISTRY:-ghcr.io/aacnsilva/animal-racing-social}

POSTGRES_PASSWORD=$(openssl rand -hex 24)
DB_SERVICE_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
SCRIPT_KEYS=k1:$(openssl rand -hex 32)
SCRIPT_KEY_ID=k1

BOOTSTRAP_ADMINS=${BOOTSTRAP_ADMINS:-}
OAUTH_GOOGLE_CLIENT_ID=
OAUTH_GOOGLE_CLIENT_SECRET=
OAUTH_GITHUB_CLIENT_ID=
OAUTH_GITHUB_CLIENT_SECRET=

REPLAY_RETENTION_HOURS=24
ODDS_RUNS_PRERACE=3000
ODDS_RUNS_LIVE=1500
ODDS_THREADS=2

GRAFANA_ADMIN_PASSWORD=$(openssl rand -hex 16)
DISCORD_WEBHOOK_URL=$DISCORD_WEBHOOK_URL
TRACE_SAMPLE_PERCENT=25
METRICS_RETENTION=30d
LOGS_RETENTION=14d
TRACE_RETENTION=168h
ENV
  chown "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  echo "Wrote $APP_DIR/.env with generated secrets. Add OAuth client ids/secrets and BOOTSTRAP_ADMINS. Grafana: https://$DOMAIN/grafana (user admin, password GRAFANA_ADMIN_PASSWORD)."
fi

CRON_LINE="17 3 * * * cd $APP_DIR && ./backup.sh >> $APP_DIR/backups/backup.log 2>&1"
( crontab -u "$DEPLOY_USER" -l 2>/dev/null | grep -v 'backup.sh' ; echo "$CRON_LINE" ) | crontab -u "$DEPLOY_USER" -

echo "VPS ready. Add the CI public key to /home/$DEPLOY_USER/.ssh/authorized_keys and point DNS for the domain at this server."
