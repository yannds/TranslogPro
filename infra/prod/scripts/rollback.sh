#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════
# rollback.sh — Restauration ultra-rapide si le cutover Swarm pose problème.
#
# Mode Swarm (depuis 2026-04-25) :
#   1. Stop Caddy uniquement (libère 80/443)
#   2. Restart easypanel-traefik (scale=1) — reprend 80/443 pour gmp
#   3. Garde le reste de la stack TransLog up (pour ne pas perdre data en cours)
#
# Pour un teardown COMPLET de la stack TransLog :
#   docker stack rm translog
# ═════════════════════════════════════════════════════════════════════════════

set -uo pipefail
cd "$(dirname "$0")/.."

YELLOW='\033[1;33m'; GREEN='\033[0;32m'; NC='\033[0m'
echo -e "${YELLOW}⏮  ROLLBACK en cours...${NC}"

STACK_NAME="translog"

# ─── 1. Détection du mode (Swarm vs Compose) ────────────────────────────────
if docker service ls --filter "name=${STACK_NAME}_" --format '{{.Name}}' 2>/dev/null | grep -q "${STACK_NAME}_"; then
    MODE="swarm"
else
    MODE="compose"
fi

# ─── 2. Stop Caddy (libère 80/443) ──────────────────────────────────────────
if [ "$MODE" = "swarm" ]; then
    docker service scale ${STACK_NAME}_caddy=0 2>/dev/null || true
    echo "  → Caddy scaled à 0 (Swarm)"
else
    docker compose --env-file .env.prod -f docker-compose.prod.yml stop caddy api web 2>/dev/null || true
    docker rm -f translog_caddy translog_api translog_web 2>/dev/null || true
    echo "  → Caddy/api/web stoppés (Compose)"
fi

# ─── 3. Restart Traefik Easypanel (scale=1) ─────────────────────────────────
if docker service ls --filter "name=easypanel-traefik" -q 2>/dev/null | grep -q .; then
    docker service scale easypanel-traefik=1 2>/dev/null || true
    echo "  → easypanel-traefik scaled à 1"
else
    echo "  ⚠ Service easypanel-traefik introuvable — restaurer via Easypanel UI"
fi

# ─── 4. Vérification que gmp répond ─────────────────────────────────────────
sleep 5
gmp_status=$(curl -ksI -o /dev/null -w "%{http_code}" https://app.dsyann.info -m 10 2>/dev/null || echo "000")
if [ "$gmp_status" = "200" ]; then
    echo "  ✓ gmp app.dsyann.info répond (HTTP 200)"
else
    echo "  ⚠ gmp HTTP=$gmp_status — vérifier easypanel-traefik via UI"
fi

# ─── 5. Reste de la stack conservé ──────────────────────────────────────────
echo "  → Infra TransLog (postgres/redis/minio/vault/bind9 + api/web) conservée"
if [ "$MODE" = "swarm" ]; then
    echo "    (teardown complet : docker stack rm $STACK_NAME)"
else
    echo "    (teardown complet : docker compose -f docker-compose.prod.yml down -v)"
fi

echo ""
echo -e "${GREEN}✔ Rollback terminé${NC}"
echo ""
echo "État :"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | head -25
