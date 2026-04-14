#!/usr/bin/env bash
# ============================================================
# TransLog Pro — Script de démarrage dev (one-shot)
#
# Usage :
#   chmod +x scripts/dev.sh
#   ./scripts/dev.sh
#
# Ce que ça fait :
#   1. Vérifie les prérequis (Docker, Node, npm)
#   2. Démarre les services Docker (Postgres, Redis, Vault, MinIO)
#   3. Attend que Vault soit initialisé (vault-init one-shot)
#   4. Lance les migrations Prisma
#   5. Génère le client Prisma
#   6. Seed IAM (rôles, permissions, super admin)
#   7. Lance l'API NestJS en hot-reload (background)
#   8. Lance le frontend Vite en hot-reload (background)
#   9. Affiche les URLs
#
# Pour arrêter proprement : Ctrl+C ou ./scripts/stop.sh
# ============================================================

set -e
cd "$(dirname "$0")/.."

# ─── Couleurs ────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅ $1${NC}"; }
info() { echo -e "${CYAN}ℹ  $1${NC}"; }
warn() { echo -e "${YELLOW}⚠  $1${NC}"; }
fail() { echo -e "${RED}❌ $1${NC}"; exit 1; }

echo ""
echo -e "${CYAN}══════════════════════════════════════════${NC}"
echo -e "${CYAN}   TransLog Pro — Démarrage Développement  ${NC}"
echo -e "${CYAN}══════════════════════════════════════════${NC}"
echo ""

# ─── 1. Prérequis ─────────────────────────────────────────────
info "Vérification des prérequis..."

command -v docker      >/dev/null 2>&1 || fail "Docker non installé. Installer Docker Desktop : https://docs.docker.com/get-docker/"
command -v docker-compose >/dev/null 2>&1 || docker compose version >/dev/null 2>&1 || fail "Docker Compose non trouvé"
command -v node        >/dev/null 2>&1 || fail "Node.js non installé. Utiliser nvm : https://github.com/nvm-sh/nvm"
command -v npm         >/dev/null 2>&1 || fail "npm non installé"

NODE_VERSION=$(node --version | cut -d. -f1 | tr -d 'v')
if [ "$NODE_VERSION" -lt 20 ]; then
  fail "Node.js >= 20 requis (version actuelle: $(node --version)). Faire: nvm use 20"
fi

docker info >/dev/null 2>&1 || fail "Docker daemon non démarré. Lancer Docker Desktop puis réessayer."

ok "Prérequis OK (Node $(node --version))"

# ─── 2. Dépendances npm ───────────────────────────────────────
info "Installation des dépendances npm..."

if [ ! -d "node_modules" ]; then
  npm ci --silent
  ok "node_modules/ installé (racine)"
else
  ok "node_modules/ déjà présent (racine)"
fi

if [ ! -d "frontend/node_modules" ]; then
  (cd frontend && npm ci --silent)
  ok "frontend/node_modules/ installé"
else
  ok "frontend/node_modules/ déjà présent"
fi

# ─── 3. Services Docker ───────────────────────────────────────
info "Démarrage des services Docker (postgres, redis, vault, minio)..."

# Utiliser 'docker compose' (v2) ou 'docker-compose' (v1)
COMPOSE="docker compose"
docker compose version >/dev/null 2>&1 || COMPOSE="docker-compose"

# Démarrer sans l'API (on la lance en dev hot-reload en dehors de Docker)
$COMPOSE up -d postgres pgbouncer redis vault minio

ok "Services Docker démarrés"

# ─── 4. Attendre PostgreSQL ───────────────────────────────────
info "Attente de PostgreSQL..."
RETRIES=30
until $COMPOSE exec -T postgres pg_isready -U app_user -d translog >/dev/null 2>&1; do
  RETRIES=$((RETRIES - 1))
  [ $RETRIES -le 0 ] && fail "PostgreSQL ne répond pas après 30 tentatives"
  sleep 2
done
ok "PostgreSQL prêt"

# ─── 5. Attendre Redis ────────────────────────────────────────
info "Attente de Redis..."
RETRIES=15
until $COMPOSE exec -T redis redis-cli -a redis_password ping >/dev/null 2>&1; do
  RETRIES=$((RETRIES - 1))
  [ $RETRIES -le 0 ] && fail "Redis ne répond pas après 15 tentatives"
  sleep 2
done
ok "Redis prêt"

# ─── 6. Attendre Vault + vault-init ──────────────────────────
info "Attente de Vault (peut prendre 10-15s au premier démarrage)..."

# Démarrer vault-init si pas encore fait
$COMPOSE up -d vault-init 2>/dev/null || true

RETRIES=40
until $COMPOSE exec -T vault vault status >/dev/null 2>&1; do
  RETRIES=$((RETRIES - 1))
  [ $RETRIES -le 0 ] && fail "Vault ne répond pas"
  sleep 2
done
ok "Vault prêt"

# Attendre que vault-init se termine (one-shot container)
info "Attente de vault-init (chargement des secrets)..."
RETRIES=30
until [ "$($COMPOSE ps vault-init --format '{{.Status}}' 2>/dev/null | grep -c 'Exited')" -gt 0 ]; do
  RETRIES=$((RETRIES - 1))
  [ $RETRIES -le 0 ] && warn "vault-init ne s'est pas terminé — les secrets devront être chargés manuellement"
  sleep 2
done
ok "vault-init terminé (secrets chargés)"

# ─── 7. Prisma ────────────────────────────────────────────────
info "Génération du client Prisma..."
# Récupérer DATABASE_URL depuis Vault pour les migrations
VAULT_ADDR=http://localhost:8200
VAULT_TOKEN=dev-root-token
DATABASE_URL=$(curl -sf -H "X-Vault-Token: $VAULT_TOKEN" \
  "$VAULT_ADDR/v1/secret/data/platform/db" 2>/dev/null \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['data']['DATABASE_URL_DIRECT'])" 2>/dev/null \
  || echo "postgresql://app_user:app_password@localhost:5432/translog?schema=public")

export DATABASE_URL
npx prisma generate --silent
ok "Client Prisma généré"

info "Application des migrations Prisma..."
npx prisma migrate deploy 2>&1 | tail -5
ok "Migrations Prisma appliquées"

# ─── 8. Seed IAM ──────────────────────────────────────────────
info "Seed IAM (rôles, permissions, super admin)..."
if npx ts-node --project tsconfig.json prisma/seeds/iam.seed.ts 2>/dev/null; then
  ok "Seed IAM terminé"
else
  warn "Seed IAM skipped (déjà existant ou erreur — non bloquant)"
fi

# ─── 9. MinIO — création du bucket ───────────────────────────
info "Configuration MinIO (bucket 'translog-docs')..."
sleep 3  # Laisser MinIO démarrer complètement
# Utiliser mc si disponible, sinon skip
if command -v mc >/dev/null 2>&1; then
  mc alias set translog-dev http://localhost:9000 minioadmin minioadmin123 --quiet 2>/dev/null || true
  mc mb translog-dev/translog-docs --quiet 2>/dev/null || true
  mc mb translog-dev/translog-photos --quiet 2>/dev/null || true
  ok "Buckets MinIO créés"
else
  warn "mc (MinIO Client) non installé — créer les buckets via http://localhost:9001 (minioadmin/minioadmin123)"
fi

# ─── 10. Lancer API NestJS ────────────────────────────────────
info "Démarrage de l'API NestJS (hot-reload)..."

VAULT_ADDR=http://localhost:8200 \
VAULT_TOKEN=dev-root-token \
NODE_ENV=development \
npm run start:dev > /tmp/translog-api.log 2>&1 &
API_PID=$!
echo "$API_PID" > /tmp/translog-api.pid

# Attendre que l'API soit prête
info "Attente de l'API NestJS (port 3000)..."
RETRIES=60
until curl -sf http://localhost:3000/health >/dev/null 2>&1 || \
      grep -q "Application is running" /tmp/translog-api.log 2>/dev/null; do
  RETRIES=$((RETRIES - 1))
  [ $RETRIES -le 0 ] && {
    warn "API NestJS pas encore prête — voir /tmp/translog-api.log"
    break
  }
  sleep 2
done
ok "API NestJS démarrée (PID $API_PID)"

# ─── 11. Lancer Frontend Vite ─────────────────────────────────
info "Démarrage du frontend Vite (port 5173)..."

(cd frontend && npm run dev > /tmp/translog-frontend.log 2>&1) &
FRONTEND_PID=$!
echo "$FRONTEND_PID" > /tmp/translog-frontend.pid

sleep 3  # Laisser Vite démarrer
ok "Frontend Vite démarré (PID $FRONTEND_PID)"

# ─── 12. Résumé ───────────────────────────────────────────────
echo ""
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo -e "${GREEN}   TransLog Pro — En ligne !               ${NC}"
echo -e "${GREEN}══════════════════════════════════════════${NC}"
echo ""
echo -e "  ${CYAN}🌐 Interface admin${NC}    → http://localhost:5173"
echo -e "  ${CYAN}🔌 API REST${NC}           → http://localhost:3000"
echo -e "  ${CYAN}🔌 WebSocket${NC}          → ws://localhost:3001"
echo -e "  ${CYAN}🗄  Prisma Studio${NC}      → npm run db:studio"
echo -e "  ${CYAN}📦 MinIO Console${NC}      → http://localhost:9001  (minioadmin / minioadmin123)"
echo -e "  ${CYAN}🔐 Vault UI${NC}           → http://localhost:8200  (token: dev-root-token)"
echo ""
echo -e "  ${YELLOW}📋 Logs API${NC}           → tail -f /tmp/translog-api.log"
echo -e "  ${YELLOW}📋 Logs Frontend${NC}      → tail -f /tmp/translog-frontend.log"
echo ""
echo -e "  ${RED}Arrêt propre${NC}          → ./scripts/stop.sh  (ou Ctrl+C)"
echo ""

# ─── 13. Trap Ctrl+C ─────────────────────────────────────────
cleanup() {
  echo ""
  info "Arrêt des processus..."
  kill "$(cat /tmp/translog-api.pid 2>/dev/null)" 2>/dev/null || true
  kill "$(cat /tmp/translog-frontend.pid 2>/dev/null)" 2>/dev/null || true
  ok "Processus arrêtés. Les containers Docker continuent (./scripts/stop.sh pour tout arrêter)."
}
trap cleanup EXIT INT TERM

# Attendre en gardant le terminal
wait
