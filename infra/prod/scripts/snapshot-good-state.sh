#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════
# snapshot-good-state.sh — Snapshot complet "état OK connu"
#
# Capture tout ce qu'il faut pour restaurer l'infra à un état précis :
#   - Volumes Docker critiques (Caddy data/config/logs, Postgres, MinIO,
#     Vault, BIND9 zones, Redis)
#   - Fichiers config (Caddyfile, named.conf, docker-stack.prod.yml,
#     Dockerfile Caddy, .env.prod)
#   - Images Docker actuellement déployées (re-tag en good-state-<stamp>)
#   - État pg_dump complet
#   - Vault raft snapshot
#
# Usage :
#   bash scripts/snapshot-good-state.sh [label]
#
# Le label (optionnel) tag le snapshot — ex: bash ... pre-vague6
# Sans label : tag = timestamp.
#
# Restore :
#   bash scripts/restore-good-state.sh <label-or-stamp>
# ═════════════════════════════════════════════════════════════════════════════

set -euo pipefail
cd "$(dirname "$0")/.."

LABEL="${1:-}"
STAMP=$(date +%Y%m%d-%H%M)
SNAP_NAME="${LABEL:+${LABEL}-}${STAMP}"
SNAP_DIR="/root/snapshots/good-state-${SNAP_NAME}"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✔${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }

[ "$EUID" -eq 0 ] || { echo "root required"; exit 1; }
[ -f .env.prod ] || { echo ".env.prod absent"; exit 1; }

set -a; . ./.env.prod; set +a

mkdir -p "$SNAP_DIR"
echo "Snapshot good-state → $SNAP_DIR"

# Helper : récupère le container ID Swarm dynamique
swarm_cid() { docker ps --filter "label=com.docker.swarm.service.name=translog_$1" -q | head -1; }

# ─── 1. Volumes Docker (chiffrés AES-256 pour cohérence avec backup.sh) ──────
KEY_FILE="/root/.translog-backup-key"
[ -f "$KEY_FILE" ] || { echo "Backup key absente, lance backup.sh d'abord"; exit 1; }
encrypt() { openssl enc -aes-256-cbc -salt -pbkdf2 -pass "file:$KEY_FILE"; }

for vol in caddy_data caddy_config caddy_logs postgres_data minio_data vault_data vault_logs redis_data bind9_cache; do
    src="translog_${vol}"
    if docker volume inspect "$src" >/dev/null 2>&1; then
        docker run --rm -v "$src:/data" busybox tar -czf - -C /data . 2>/dev/null \
            | encrypt > "$SNAP_DIR/${src}.tar.gz.enc"
        ok "Vol $src → $(du -h "$SNAP_DIR/${src}.tar.gz.enc" | cut -f1)"
    fi
done

# ─── 2. Fichiers config (clear) ──────────────────────────────────────────────
mkdir -p "$SNAP_DIR/config"
cp caddy/Caddyfile "$SNAP_DIR/config/" 2>/dev/null
cp caddy/Dockerfile "$SNAP_DIR/config/Caddyfile.Dockerfile" 2>/dev/null
cp bind9/named.conf "$SNAP_DIR/config/" 2>/dev/null
cp bind9/zones/translog.db "$SNAP_DIR/config/" 2>/dev/null
cp docker-stack.prod.yml "$SNAP_DIR/config/" 2>/dev/null
cp .env.prod "$SNAP_DIR/config/.env.prod" 2>/dev/null
chmod 600 "$SNAP_DIR/config/.env.prod" 2>/dev/null
ok "Config files copiées"

# ─── 3. Images Docker — re-tag good-state-<label> ────────────────────────────
for img in translog_api translog_web prod-caddy; do
    if docker image inspect "${img}:latest" >/dev/null 2>&1; then
        new_tag="${img}:good-state-${SNAP_NAME}"
        docker tag "${img}:latest" "$new_tag"
        ok "Image tag : ${new_tag}"
    fi
done

# ─── 4. Postgres dump ────────────────────────────────────────────────────────
PG_CID=$(swarm_cid postgres)
if [ -n "$PG_CID" ]; then
    docker exec "$PG_CID" pg_dump -U app_admin -F c -Z 9 translog 2>/dev/null \
        | encrypt > "$SNAP_DIR/postgres.pgdump.enc"
    ok "Postgres dump → $(du -h "$SNAP_DIR/postgres.pgdump.enc" | cut -f1)"
fi

# ─── 5. Vault raft snapshot ──────────────────────────────────────────────────
if [ -n "${VAULT_TOKEN:-}" ] && [ "$VAULT_TOKEN" != "REPLACE_AFTER_VAULT_INIT" ]; then
    VAULT_CID=$(swarm_cid vault)
    if [ -n "$VAULT_CID" ]; then
        docker exec -e VAULT_TOKEN="$VAULT_TOKEN" "$VAULT_CID" \
            vault operator raft snapshot save /tmp/vault.snap >/dev/null 2>&1
        docker cp "$VAULT_CID:/tmp/vault.snap" /tmp/vault.snap
        encrypt < /tmp/vault.snap > "$SNAP_DIR/vault.snap.enc"
        rm -f /tmp/vault.snap
        ok "Vault snapshot → $(du -h "$SNAP_DIR/vault.snap.enc" | cut -f1)"
    fi
fi

# ─── 6. État Swarm + iptables (text dumps) ──────────────────────────────────
docker service ls > "$SNAP_DIR/state-services.txt"
docker service inspect translog_caddy translog_api translog_web translog_postgres translog_redis translog_minio translog_vault translog_bind9 > "$SNAP_DIR/state-services-spec.json" 2>/dev/null
iptables-save > "$SNAP_DIR/state-iptables.txt"
ok "État Swarm + iptables capturés"

# ─── 7. Manifest snapshot ────────────────────────────────────────────────────
cat > "$SNAP_DIR/MANIFEST.txt" << MANIFEST
TransLog Pro — snapshot good-state
Label    : ${LABEL:-(none)}
Stamp    : ${STAMP}
Hostname : $(hostname)
Date     : $(date -u +"%Y-%m-%dT%H:%M:%SZ")
Git HEAD : $(cd /opt/TranslogPro && git rev-parse --short HEAD 2>/dev/null || echo unknown)

Smoke test au moment du snapshot :
  translog.dsyann.info     : $(curl -ksI -o /dev/null -w "%{http_code}" --connect-timeout 3 "https://translog.dsyann.info/?cb=$(date +%s%N)" 2>/dev/null || echo 000)
  api.translog.dsyann.info : $(curl -ksI -o /dev/null -w "%{http_code}" --connect-timeout 3 "https://api.translog.dsyann.info/health/live?cb=$(date +%s%N)" 2>/dev/null || echo 000)
  panel.dsyann.info        : $(curl -ksI -o /dev/null -w "%{http_code}" --connect-timeout 3 "https://panel.dsyann.info/?cb=$(date +%s%N)" 2>/dev/null || echo 000)

Restore :
  bash /opt/TranslogPro/infra/prod/scripts/restore-good-state.sh ${SNAP_NAME}
MANIFEST

cat "$SNAP_DIR/MANIFEST.txt"
echo
echo "════════════════════════════════════════════════════════════"
echo -e "${GREEN}🛡  Snapshot OK${NC} : $SNAP_DIR"
echo "   Restore : bash scripts/restore-good-state.sh ${SNAP_NAME}"
echo "════════════════════════════════════════════════════════════"

# Rétention : on garde les 5 derniers labélisés + 7 derniers auto-stamp
ls -1dt /root/snapshots/good-state-* 2>/dev/null | tail -n +13 | xargs -r rm -rf 2>/dev/null
