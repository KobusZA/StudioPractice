#!/usr/bin/env bash
# Install StudioPractice on the AlmaLinux demo host as the only site.
# gp-fnx.com, empty database, nginx in front of a localhost Node process.
# Does not print the database password. Does not touch sshd.
set -euo pipefail

APP_ROOT=/opt/studiopractice
ENV_FILE="$APP_ROOT/server/.env"
DOMAIN=gp-fnx.com
PG_VER=16
PSQL="/usr/pgsql-${PG_VER}/bin/psql"

log() { printf '\n== %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[[ $(id -u) -eq 0 ]] || die "run as root"
[[ -f "$APP_ROOT/server/src/server.js" && -d "$APP_ROOT/web" ]] || die "missing $APP_ROOT/server and $APP_ROOT/web"

. /etc/os-release
[[ "${ID:-}" == "almalinux" || "${ID:-}" == "rhel" || "${ID:-}" == "rocky" ]] || die "expected AlmaLinux, got ${ID:-unknown}"
[[ "${VERSION_ID%%.*}" == "8" ]] || die "expected EL 8, got ${VERSION_ID:-unknown}"

public_ip=$(hostname -I | awk '{print $1}')
dns_ip=$(getent ahostsv4 "$DOMAIN" | awk '{print $1; exit}')
[[ -n "$dns_ip" ]] || die "$DOMAIN does not resolve"
[[ "$dns_ip" == "$public_ip" ]] || die "$DOMAIN resolves to $dns_ip, this host is $public_ip"

log "renew the existing certificate before nginx is replaced"
dnf install -y epel-release
dnf install -y certbot python3-certbot-nginx
if [[ -f /etc/letsencrypt/renewal/${DOMAIN}.conf ]]; then
  certbot renew --cert-name "$DOMAIN" --force-renewal --non-interactive
else
  certbot certonly --webroot -w /var/www/html -d "$DOMAIN" \
    --non-interactive --agree-tos --register-unsafely-without-email
fi
[[ -f /etc/letsencrypt/live/${DOMAIN}/fullchain.pem ]] || die "certificate was not issued"

log "stop the processes this host was already running"
for unit in docker.service docker.socket containerd.service caddy.service mariadb.service mysqld.service mysql.service; do
  systemctl disable --now "$unit" 2>/dev/null || true
done
if command -v pm2 >/dev/null; then
  pm2 kill || true
fi
while read -r unit; do
  [[ -n "$unit" ]] || continue
  if systemctl cat "$unit" 2>/dev/null | grep -q '/root/serv'; then
    systemctl disable --now "$unit" || true
  fi
done < <(systemctl list-unit-files --type=service --no-legend | awk '{print $1}')
if [[ -f /etc/rc.d/rc.local ]]; then
  sed -i 's|^\([^#].*/root/serv.*\)$|# stopped by studiopractice install: \1|' /etc/rc.d/rc.local
fi
for cron in /var/spool/cron/root /etc/crontab; do
  [[ -f "$cron" ]] || continue
  sed -i 's|^\([^#].*/root/serv.*\)$|# stopped by studiopractice install: \1|' "$cron"
done
# Whatever is still bound to the app port. sshd and nginx are not on 8080.
if ss -ltn | awk '{print $4}' | grep -q ':8080$'; then
  ss -ltnp | sed -n 's/.*:8080 .*pid=\([0-9]*\).*/\1/p' | sort -u | while read -r pid; do
    kill "$pid" || true
  done
  sleep 1
fi

log "install Node 22 beside the system Node 18"
if ! /usr/local/bin/node -v 2>/dev/null | grep -q '^v22\.'; then
  work=$(mktemp -d)
  curl -fsSL -o "$work/SHASUMS256.txt" https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt
  tarball=$(awk '/linux-x64\.tar\.xz$/ {print $2; exit}' "$work/SHASUMS256.txt")
  [[ -n "$tarball" ]] || die "could not find a Node 22 linux-x64 tarball"
  curl -fsSL -o "$work/$tarball" "https://nodejs.org/dist/latest-v22.x/$tarball"
  (cd "$work" && grep "  $tarball\$" SHASUMS256.txt | sha256sum -c -)
  tar -xJf "$work/$tarball" -C /usr/local --strip-components=1
  rm -rf "$work"
fi
/usr/local/bin/node -v

log "install Postgres ${PG_VER}"
dnf install -y "https://download.postgresql.org/pub/repos/yum/reporpms/EL-8-x86_64/pgdg-redhat-repo-latest.noarch.rpm"
dnf -qy module disable postgresql || true
dnf install -y "postgresql${PG_VER}-server" "postgresql${PG_VER}"
if [[ ! -f /var/lib/pgsql/${PG_VER}/data/PG_VERSION ]]; then
  "/usr/pgsql-${PG_VER}/bin/postgresql-${PG_VER}-setup" initdb
fi
systemctl enable --now "postgresql-${PG_VER}"

id studiopractice >/dev/null 2>&1 || useradd --system --home-dir "$APP_ROOT" --shell /sbin/nologin studiopractice

if [[ ! -f "$ENV_FILE" ]]; then
  pw=$(openssl rand -hex 24)
  if runuser -u postgres -- "$PSQL" -tAc "SELECT 1 FROM pg_roles WHERE rolname='studiopractice'" | grep -q 1; then
    runuser -u postgres -- "$PSQL" -v ON_ERROR_STOP=1 -c "ALTER ROLE studiopractice PASSWORD '${pw}'"
  else
    runuser -u postgres -- "$PSQL" -v ON_ERROR_STOP=1 -c "CREATE ROLE studiopractice LOGIN PASSWORD '${pw}'"
  fi
  if ! runuser -u postgres -- "$PSQL" -tAc "SELECT 1 FROM pg_database WHERE datname='studiopractice'" | grep -q 1; then
    runuser -u postgres -- "$PSQL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE studiopractice OWNER studiopractice"
  fi
  cat > "$ENV_FILE" <<EOF
DATABASE_URL=postgres://studiopractice:${pw}@127.0.0.1:5432/studiopractice
NODE_ENV=production
PORT=8080
HOST=127.0.0.1
COOKIE_SECURE=1
ALLOWED_ORIGINS=
TRUST_PROXY=1
OPENAI_API_KEY=
EOF
  chown root:studiopractice "$ENV_FILE"
  chmod 640 "$ENV_FILE"
else
  log "keeping existing $ENV_FILE"
fi

log "install the app"
chown -R studiopractice:studiopractice "$APP_ROOT"
# .env stays root:studiopractice so the process can read it and a casual edit
# does not require handing the user write on the secret.
chown root:studiopractice "$ENV_FILE"
chmod 640 "$ENV_FILE"
runuser -u studiopractice -- /usr/local/bin/npm ci --omit=dev --cache "$APP_ROOT/.npm-cache" --prefix "$APP_ROOT/server"

cat > /etc/systemd/system/studiopractice.service <<'EOF'
[Unit]
Description=StudioPractice
After=network.target postgresql-16.service
Requires=postgresql-16.service

[Service]
Type=simple
User=studiopractice
Group=studiopractice
WorkingDirectory=/opt/studiopractice
ExecStart=/usr/local/bin/node server/src/server.js
Restart=on-failure
RestartSec=3
StartLimitIntervalSec=60
StartLimitBurst=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now studiopractice

log "nginx for ${DOMAIN}"
mkdir -p /root/disabled-configs /var/www/html
for old in /etc/nginx/conf.d/gp-fnx.com.conf /etc/nginx/conf.d/pon-3001.conf; do
  [[ -f "$old" ]] || continue
  mv "$old" "/root/disabled-configs/$(basename "$old")"
done
cat > /etc/nginx/conf.d/studiopractice.conf <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
    location / {
        return 301 https://${DOMAIN}\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 180s;
    }
}
EOF
if ! nginx -t; then
  for old in gp-fnx.com.conf pon-3001.conf; do
    [[ -f "/root/disabled-configs/$old" ]] || continue
    mv "/root/disabled-configs/$old" "/etc/nginx/conf.d/$old"
  done
  rm -f /etc/nginx/conf.d/studiopractice.conf
  die "nginx config was rejected and the previous site files were put back"
fi
if [[ $(getenforce 2>/dev/null || echo Disabled) != "Disabled" ]]; then
  setsebool -P httpd_can_network_connect 1
fi
systemctl enable --now nginx
systemctl reload nginx

log "check"
sleep 1
systemctl is-active --quiet studiopractice || die "studiopractice did not stay up; journalctl -u studiopractice"
code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/ || true)
[[ "$code" == "302" ]] || die "localhost:8080 returned ${code}, expected 302"
session=$(curl -fsS http://127.0.0.1:8080/api/auth/session)
[[ "$session" == *'"signedIn":false'* ]] || die "session check returned: $session"
curl -fsS --resolve "${DOMAIN}:443:127.0.0.1" "https://${DOMAIN}/api/auth/session" >/dev/null

printf '\nReady at https://%s/\n' "$DOMAIN"
printf 'Add the OpenAI key on the server, then restart:\n'
printf '  edit %s   (OPENAI_API_KEY=)\n' "$ENV_FILE"
printf '  systemctl restart studiopractice\n'
printf 'The database password is already in that file. /root/serv, MySQL data, and Docker images were left on disk; their services are stopped.\n'
