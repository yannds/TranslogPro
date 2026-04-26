#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════
# rotate-secrets.sh — Rotation trimestrielle des secrets critiques
#
# Rotate (avec --force pour confirmer) :
#   - POSTGRES_APP_RUNTIME_PASSWORD (Postgres role + Vault + .env.prod)
#   - MINIO_ROOT_PASSWORD            (MinIO env + Vault + .env.prod)
#   - VAULT_SECRET_ID                (AppRole regénération via Vault)
#
# Skip volontairement (rotation manuelle dédiée) :
#   - APP_SECRET    : invalide TOUTES les sessions actives (déconnecte les users)
#                     → planifier maintenance + annonce préalable
#   - POSTGRES_APP_ADMIN_PASSWORD : prisma db push casserait, nécessite update CI
#   - TSIG_SECRET   : casse les DNS-01 ACME en cours, à coordonner avec un cert
#                     renewal LE manuel
#   - Vault unseal keys : `vault operator rekey` interactif, garder le user en boucle
#
# Usage :
#   bash scripts/rotate-secrets.sh --dry-run   # preview, génère aucun secret
#   bash scripts/rotate-secrets.sh --force     # apply
#
# Backup : ancien .env.prod et anciens secrets exportés dans
#   /root/security-backups/rotate-$(date +%Y%m%d-%H%M)/
#
# Cron suggested :
#   # Tous les 90 jours à 03:00 UTC un dimanche
#   0 3 1 */3 0 cd /opt/TranslogPro/infra/prod && ./scripts/rotate-secrets.sh --force
# ═════════════════════════════════════════════════════════════════════════════

set -euo pipefail
cd "$(dirname "$0")/.."

DRY=0
FORCE=0
for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY=1 ;;
        --force)   FORCE=1 ;;
        *) echo "Unknown arg: $arg"; exit 1 ;;
    esac
done

if [ "$DRY" -eq 0 ] && [ "$FORCE" -eq 0 ]; then
    echo "⚠️  Refuse d'exécuter sans --dry-run ou --force"
    echo "   Utilise --dry-run d'abord pour voir ce qui sera changé."
    exit 1
fi

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()    { echo -e "${GREEN}✔${NC} $1"; }
warn()  { echo -e "${YELLOW}⚠${NC} $1"; }
fail()  { echo -e "${RED}✘ $1${NC}"; exit 1; }

[ "$EUID" -eq 0 ] || fail "root required"
[ -f .env.prod ] || fail ".env.prod absent"

set -a; . ./.env.prod; set +a

STAMP=$(date +%Y%m%d-%H%M)
BACKUP_DIR="/root/security-backups/rotate-$STAMP"
mkdir -p "$BACKUP_DIR"
cp .env.prod "$BACKUP_DIR/.env.prod.before"
chmod 600 "$BACKUP_DIR/.env.prod.before"

if [ "$DRY" -eq 1 ]; then
    warn "DRY RUN — aucune modification ne sera appliquée"
fi

# Helper : récupère container ID Swarm dynamique
swarm_cid() { docker ps --filter "label=com.docker.swarm.service.name=translog_$1" -q | head -1; }

# Helper : update une variable dans .env.prod (idempotent, atomic)
env_set() {
    local key="$1" val="$2"
    sed -i "/^${key}=/d" .env.prod
    echo "${key}=${val}" >> .env.prod
}

# ─── 1. POSTGRES_APP_RUNTIME_PASSWORD ────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════"
echo "[1/3] Rotate POSTGRES_APP_RUNTIME_PASSWORD"
echo "═══════════════════════════════════════════"

NEW_PG_RUNTIME=$(openssl rand -hex 32)
echo "Old: ${POSTGRES_APP_RUNTIME_PASSWORD:0:8}…(masked)"
echo "New: ${NEW_PG_RUNTIME:0:8}…(masked)"

if [ "$DRY" -eq 0 ]; then
    PG_CID=$(swarm_cid postgres)
    [ -n "$PG_CID" ] || fail "Postgres container introuvable"

    # 1.1 — UPDATE rôle Postgres avec nouveau pass
    docker exec -i \
        -e PGPASSWORD="${POSTGRES_APP_ADMIN_PASSWORD}" \
        "$PG_CID" \
        psql -U app_admin -d translog -c \
        "ALTER ROLE app_runtime PASSWORD '${NEW_PG_RUNTIME}';" > /dev/null
    ok "Rôle app_runtime mis à jour"

    # 1.2 — Update Vault secret/platform/db
    VAULT_CID=$(swarm_cid vault)
    docker exec -e VAULT_TOKEN="$VAULT_TOKEN" "$VAULT_CID" \
        vault kv put secret/platform/db \
        DATABASE_URL="postgresql://app_runtime:${NEW_PG_RUNTIME}@pgbouncer:5432/translog" > /dev/null
    ok "Vault secret/platform/db mis à jour"

    # 1.3 — Update .env.prod
    env_set POSTGRES_APP_RUNTIME_PASSWORD "$NEW_PG_RUNTIME"
    ok ".env.prod mis à jour"

    # 1.4 — Restart pgbouncer pour qu'il authentifie avec le nouveau pass
    docker service update --force translog_pgbouncer > /dev/null
    sleep 5
    ok "pgbouncer redémarré"

    # 1.5 — Restart api pour qu'il re-fetch le secret depuis Vault
    docker service update --force translog_api > /dev/null
    sleep 15
    ok "API redémarrée"
else
    warn "[DRY] Rôle Postgres + Vault + .env.prod + restart pgbouncer + api"
fi

# ─── 2. MINIO_ROOT_PASSWORD ──────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════"
echo "[2/3] Rotate MINIO_ROOT_PASSWORD"
echo "═══════════════════════════════════════════"

NEW_MINIO=$(openssl rand -hex 32)
echo "Old: ${MINIO_ROOT_PASSWORD:0:8}…(masked)"
echo "New: ${NEW_MINIO:0:8}…(masked)"

if [ "$DRY" -eq 0 ]; then
    # 2.1 — Update .env.prod (MinIO le pickup au restart via env)
    env_set MINIO_ROOT_PASSWORD "$NEW_MINIO"

    # 2.2 — Update Vault secret/platform/minio
    docker exec -e VAULT_TOKEN="$VAULT_TOKEN" "$VAULT_CID" \
        vault kv put secret/platform/minio \
        ENDPOINT=minio PORT=9000 \
        ACCESS_KEY="$MINIO_ROOT_USER" \
        SECRET_KEY="$NEW_MINIO" \
        USE_SSL=false > /dev/null
    ok "Vault secret/platform/minio mis à jour"

    # 2.3 — Force update du service (re-pull env vars depuis docker-stack)
    docker service update --force translog_minio > /dev/null
    sleep 10
    ok "MinIO redémarré"

    # 2.4 — Restart api pour re-fetch
    docker service update --force translog_api > /dev/null
    sleep 15
    ok "API redémarrée"
else
    warn "[DRY] .env.prod + Vault + restart minio + api"
fi

# ─── 3. VAULT_SECRET_ID (AppRole regen) ──────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════"
echo "[3/3] Rotate VAULT_SECRET_ID"
echo "═══════════════════════════════════════════"

if [ "$DRY" -eq 0 ]; then
    NEW_SECRET_ID=$(docker exec -e VAULT_TOKEN="$VAULT_TOKEN" "$VAULT_CID" \
        vault write -f -format=json auth/approle/role/translog-api/secret-id \
        | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['secret_id'])")
    env_set VAULT_SECRET_ID "$NEW_SECRET_ID"
    ok "VAULT_SECRET_ID rotaté"

    # API restart pour utiliser le nouveau secret_id
    docker service update --force translog_api > /dev/null
    sleep 15
    ok "API redémarrée"
else
    warn "[DRY] vault write -f auth/approle/role/translog-api/secret-id + restart api"
fi

# ─── Healthcheck final ───────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════"
echo "Healthcheck final"
echo "═══════════════════════════════════════════"

if [ "$DRY" -eq 0 ]; then
    sleep 5
    HTTP=$(curl -kI -o /dev/null -w "%{http_code}" -m 15 https://api.translog.dsyann.info/health/live 2>/dev/null || echo 000)
    if [ "$HTTP" = "200" ]; then
        ok "API opérationnelle"
    else
        fail "API ne répond plus (HTTP $HTTP) — RESTORE : cp $BACKUP_DIR/.env.prod.before .env.prod && bash scripts/04-deploy.sh"
    fi
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo "${GREEN}🔐 Rotation OK${NC}"
echo "  Backup : $BACKUP_DIR"
echo "  Prochaine rotation prévue : $(date -d '+90 days' +%Y-%m-%d 2>/dev/null || date -v+90d +%Y-%m-%d)"
echo "════════════════════════════════════════════════════════════"
