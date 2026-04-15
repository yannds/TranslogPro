#!/usr/bin/env bash
# ============================================================
# TransLog Pro — Script de démarrage autonome (self-healing)
#
# Usage :
#   chmod +x scripts/dev.sh && ./scripts/dev.sh
#
# 100 % autonome — installe, configure et lance tout :
#   Homebrew · Docker Desktop · Node 20 · mc
#   PostgreSQL · PgBouncer · Redis · Vault · MinIO
#   RLS policies · Prisma migrations · IAM seed
#   Buckets MinIO · API NestJS · Frontend Vite
# ============================================================

set -e
cd "$(dirname "$0")/.."

# ─── Couleurs ────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅ $1${NC}"; }
info() { echo -e "${CYAN}ℹ  $1${NC}"; }
warn() { echo -e "${YELLOW}⚠  $1${NC}"; }
fail() { echo -e "${RED}❌ $1${NC}"; exit 1; }
step() { echo -e "\n${BOLD}${CYAN}▶ $1${NC}"; }

VAULT_ADDR=http://localhost:8200
VAULT_TOKEN=dev-root-token

echo ""
echo -e "${CYAN}══════════════════════════════════════════${NC}"
echo -e "${CYAN}   TransLog Pro — Démarrage Développement  ${NC}"
echo -e "${CYAN}══════════════════════════════════════════${NC}"
echo ""

# ─── Détection OS ────────────────────────────────────────────
OS="$(uname -s)"
ARCH="$(uname -m)"
[ "$OS" != "Darwin" ] && fail "Ce script est conçu pour macOS. Linux : utiliser Docker Engine + nvm."

# ═══════════════════════════════════════════════════════════════
# BLOC 0 — Nettoyage des instances précédentes
# ═══════════════════════════════════════════════════════════════
step "0/14 · Nettoyage des instances précédentes"

# API NestJS
if [ -f /tmp/translog-api.pid ]; then
  OLD_PID=$(cat /tmp/translog-api.pid)
  if kill -0 "$OLD_PID" 2>/dev/null; then
    info "Arrêt API précédente (PID $OLD_PID)..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 1
  fi
  rm -f /tmp/translog-api.pid
fi

# Frontend Vite
if [ -f /tmp/translog-frontend.pid ]; then
  OLD_PID=$(cat /tmp/translog-frontend.pid)
  if kill -0 "$OLD_PID" 2>/dev/null; then
    info "Arrêt Frontend précédent (PID $OLD_PID)..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 1
  fi
  rm -f /tmp/translog-frontend.pid
fi

# Fallback : tuer tout process encore sur les ports applicatifs
for PORT in 3000 3001 5173; do
  PIDS=$(lsof -ti :$PORT 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    info "Port $PORT encore occupé — libération forcée..."
    echo "$PIDS" | xargs kill -9 2>/dev/null || true
  fi
done

ok "Instances précédentes arrêtées"

# ═══════════════════════════════════════════════════════════════
# BLOC 1 — Outils système
# ═══════════════════════════════════════════════════════════════

# ─── 1. Homebrew ─────────────────────────────────────────────
step "1/14 · Homebrew"
if ! command -v brew >/dev/null 2>&1; then
  info "Installation de Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [ "$ARCH" = "arm64" ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
    grep -q "brew shellenv" "$HOME/.zprofile" 2>/dev/null || \
      echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$HOME/.zprofile"
  else
    eval "$(/usr/local/bin/brew shellenv)"
    grep -q "brew shellenv" "$HOME/.zprofile" 2>/dev/null || \
      echo 'eval "$(/usr/local/bin/brew shellenv)"' >> "$HOME/.zprofile"
  fi
  ok "Homebrew installé"
else
  ok "Homebrew $(brew --version | head -1)"
fi

# ─── 2. Docker Desktop ───────────────────────────────────────
step "2/14 · Docker Desktop"
if ! command -v docker >/dev/null 2>&1; then
  info "Installation de Docker Desktop (peut prendre 3-5 min)..."
  brew install --cask docker
  ok "Docker Desktop installé"
fi

if ! docker info >/dev/null 2>&1; then
  info "Démarrage de Docker Desktop..."
  open -a Docker
  info "Attente du daemon Docker (max 120s)..."
  RETRIES=60
  until docker info >/dev/null 2>&1; do
    RETRIES=$((RETRIES - 1))
    [ $RETRIES -le 0 ] && fail "Docker daemon ne répond pas — vérifier Docker Desktop."
    printf "."; sleep 2
  done
  echo ""
fi
ok "Docker daemon actif"

# Docker Compose v2 ou v1
COMPOSE="docker compose"
docker compose version >/dev/null 2>&1 || {
  brew install docker-compose 2>/dev/null || true
  COMPOSE="docker-compose"
}

# ─── 3. Node.js ≥ 20 ─────────────────────────────────────────
step "3/14 · Node.js ≥ 20"
NEED_NODE=false
if ! command -v node >/dev/null 2>&1; then
  NEED_NODE=true
else
  NODE_MAJOR=$(node --version | cut -d. -f1 | tr -d 'v')
  [ "$NODE_MAJOR" -lt 20 ] && NEED_NODE=true
fi

if $NEED_NODE; then
  info "Installation de Node.js 20..."
  brew install node@20
  NODE20_BIN="$(brew --prefix node@20)/bin"
  export PATH="$NODE20_BIN:$PATH"
  grep -q "node@20" "$HOME/.zshrc" 2>/dev/null || \
    echo "export PATH=\"$NODE20_BIN:\$PATH\"" >> "$HOME/.zshrc"
fi
ok "Node.js $(node --version)"

# ─── 4. mc (MinIO Client) ────────────────────────────────────
step "4/14 · MinIO Client (mc)"
if ! command -v mc >/dev/null 2>&1; then
  info "Installation de mc..."
  brew install minio/stable/mc 2>/dev/null || \
    brew install minio-mc 2>/dev/null || \
    warn "mc non installable — fallback via container Docker"
fi
command -v mc >/dev/null 2>&1 && ok "mc $(mc --version 2>&1 | head -1 | awk '{print $3}')" || warn "mc absent (fallback actif)"

# ═══════════════════════════════════════════════════════════════
# BLOC 2 — Dépendances npm
# ═══════════════════════════════════════════════════════════════

step "5/14 · Dépendances npm"

[ ! -d "node_modules" ] || [ "package.json" -nt "node_modules/.package-lock.json" ] && {
  info "npm ci (racine)..."
  npm ci --silent
}
ok "node_modules/ racine"

[ ! -d "frontend/node_modules" ] || [ "frontend/package.json" -nt "frontend/node_modules/.package-lock.json" ] && {
  info "npm ci (frontend)..."
  (cd frontend && npm ci --silent)
}
ok "frontend/node_modules/"

# ═══════════════════════════════════════════════════════════════
# BLOC 3 — Services Docker
# ═══════════════════════════════════════════════════════════════

step "6/14 · Démarrage containers Docker"
info "postgres · pgbouncer · redis · vault · minio"
$COMPOSE up -d postgres pgbouncer redis vault minio
ok "Containers lancés"

# ─── 7. Attendre PostgreSQL ──────────────────────────────────
step "7/14 · PostgreSQL"

# Phase 1 : pg_isready (socket OK)
RETRIES=40
until $COMPOSE exec -T postgres pg_isready -U app_user -d translog >/dev/null 2>&1; do
  RETRIES=$((RETRIES - 1)); [ $RETRIES -le 0 ] && fail "PostgreSQL ne répond pas (pg_isready)"
  printf "."; sleep 2
done

# Phase 2 : vraie requête SQL — attend que les init scripts (01-rls.sql, 02-indexes.sql)
# aient terminé leurs GRANT. pg_isready passe AVANT que ces scripts finissent.
RETRIES=30
until $COMPOSE exec -T postgres psql -U app_user -d translog -c "SELECT 1" >/dev/null 2>&1; do
  RETRIES=$((RETRIES - 1)); [ $RETRIES -le 0 ] && fail "PostgreSQL : connexion refusée après pg_isready"
  printf "."; sleep 2
done
echo ""; ok "PostgreSQL prêt (connexion SQL vérifiée)"

# ─── 8. Attendre Redis ───────────────────────────────────────
step "8/14 · Redis"
RETRIES=15
until $COMPOSE exec -T redis redis-cli -a redis_password ping >/dev/null 2>&1; do
  RETRIES=$((RETRIES - 1)); [ $RETRIES -le 0 ] && fail "Redis ne répond pas"
  printf "."; sleep 2
done
echo ""; ok "Redis prêt"

# ─── 9. Vault + vault-init ───────────────────────────────────
step "9/14 · Vault + secrets"

$COMPOSE up -d vault-init 2>/dev/null || true

info "Attente Vault..."
RETRIES=40
until curl -sf -H "X-Vault-Token: $VAULT_TOKEN" "$VAULT_ADDR/v1/sys/health" >/dev/null 2>&1; do
  RETRIES=$((RETRIES - 1)); [ $RETRIES -le 0 ] && fail "Vault ne répond pas sur $VAULT_ADDR"
  printf "."; sleep 2
done
echo ""

info "Attente vault-init (chargement des secrets, max 3 min)..."
RETRIES=90
until docker inspect --format='{{.State.Status}}' translog-vault-init 2>/dev/null | grep -q "exited"; do
  RETRIES=$((RETRIES - 1))
  if [ $RETRIES -le 0 ]; then
    warn "vault-init pas terminé après 3 min — le patch localhost sera appliqué quand même"
    break
  fi
  printf "."; sleep 2
done
# Vérifier le code de sortie : 0 = succès, autre = échec
EXIT_CODE=$(docker inspect --format='{{.State.ExitCode}}' translog-vault-init 2>/dev/null || echo "0")
[ "$EXIT_CODE" != "0" ] && warn "vault-init a échoué (exit $EXIT_CODE) — secrets partiels, le patch corrigera" || true
echo ""

# ─── PATCH CRITIQUE : réécrire les secrets Vault avec des URL localhost ───────
# Les URL dans infra/vault/init.sh utilisent les hostnames Docker internes
# (pgbouncer, redis, minio) qui ne sont PAS résolvables depuis l'hôte macOS.
# On les réécrit ici avec les hostnames localhost + ports exposés.
# ─────────────────────────────────────────────────────────────────────────────
info "Patch Vault : remplacement des hostnames Docker par localhost..."

vault_put() {
  curl -sf -X POST \
    -H "X-Vault-Token: $VAULT_TOKEN" \
    -H "Content-Type: application/json" \
    "$VAULT_ADDR/v1/secret/data/$1" \
    -d "{\"data\": $2}" >/dev/null
}

# DB — pgbouncer:5432 → localhost:5433 / postgres:5432 → localhost:5434
# (5432 est réservé par PostgreSQL Homebrew sur la machine de dev)
vault_put "platform/db" '{
  "DATABASE_URL":        "postgresql://app_user:app_password@localhost:5433/translog?schema=public",
  "DATABASE_URL_DIRECT": "postgresql://app_user:app_password@localhost:5434/translog?schema=public"
}'

# Redis — redis:6379 → localhost:6379
vault_put "platform/redis" '{
  "HOST":     "localhost",
  "PORT":     "6379",
  "PASSWORD": "redis_password"
}'

# MinIO — minio:9000 → localhost:9000
vault_put "platform/minio" '{
  "ENDPOINT":   "localhost",
  "PORT":       "9000",
  "ACCESS_KEY": "minioadmin",
  "SECRET_KEY": "minioadmin123",
  "USE_SSL":    "false"
}'

# Auth — normalisation des paths (init.sh écrit platform/app, bootstrap écrit platform/auth)
# On écrit aux deux chemins pour compatibilité totale
JWT_SECRET="dev-jwt-secret-$(date +%s)"
AUTH_SECRET="dev-auth-secret-$(date +%s)"

vault_put "platform/app" "{
  \"JWT_SECRET\":         \"$JWT_SECRET\",
  \"BETTER_AUTH_SECRET\": \"$AUTH_SECRET\"
}"

vault_put "platform/auth" "{
  \"SECRET\":     \"$AUTH_SECRET\",
  \"JWT_SECRET\": \"$JWT_SECRET\"
}"

ok "Vault secrets patchés (localhost URLs + auth normalisé)"

# ═══════════════════════════════════════════════════════════════
# BLOC 4 — Base de données
# ═══════════════════════════════════════════════════════════════

step "10/14 · Prisma — migrations"

# Lire DATABASE_URL_DIRECT depuis Vault (maintenant localhost)
DATABASE_URL=$(curl -sf -H "X-Vault-Token: $VAULT_TOKEN" \
  "$VAULT_ADDR/v1/secret/data/platform/db" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['data']['DATABASE_URL_DIRECT'])" 2>/dev/null \
  || echo "postgresql://app_user:app_password@localhost:5432/translog?schema=public")

export DATABASE_URL
info "Connexion : ${DATABASE_URL%%@*}@***"

info "Génération du client Prisma..."
set +e
GENERATE_OUT=$(npx prisma generate 2>&1)
GENERATE_EXIT=$?
set -e
echo "$GENERATE_OUT" | grep -vE "^$|Prisma schema|Generated|hint:|warn:|Update available|major update|pris\.ly|Run the following|npm i " || true
[ $GENERATE_EXIT -ne 0 ] && fail "prisma generate a échoué (exit $GENERATE_EXIT) — voir l'erreur ci-dessus"
ok "Client Prisma généré"

info "Synchronisation du schéma DB (prisma db push)..."
# db push est idempotent : crée les tables manquantes, ne détruit pas les données existantes.
# Préféré à migrate deploy car le projet n'a pas de fichiers de migration.
set +e
PUSH_OUT=$(npx prisma db push --accept-data-loss 2>&1)
PUSH_EXIT=$?
set -e

echo "$PUSH_OUT" | grep -vE "^$|pris\.ly|tip-|Tip:|warn - The" || true

if [ $PUSH_EXIT -ne 0 ]; then
  warn "prisma db push a échoué (exit $PUSH_EXIT) — retry dans 5s..."
  sleep 5
  set +e
  npx prisma db push --accept-data-loss 2>&1
  PUSH_EXIT2=$?
  set -e
  [ $PUSH_EXIT2 -ne 0 ] && fail "db push échoué — voir l'erreur ci-dessus"
fi
ok "Migrations appliquées"

# ─── RLS v2 (nouvelles tables) ───────────────────────────────
# 02-rls-new-tables.sql n'est pas dans docker-entrypoint-initdb.d
# (il doit s'exécuter APRÈS prisma migrate, pas avant).
# On l'applique ici via psql.
info "Application des RLS v2 (nouvelles tables)..."
$COMPOSE exec -T postgres psql -U app_user -d translog \
  -f /dev/stdin < infra/sql/02-rls-new-tables.sql >/dev/null 2>&1 \
  && ok "RLS v2 appliquées" \
  || warn "RLS v2 skip (déjà appliquées ou non-bloquant)"

# ─── 11. Seed IAM ────────────────────────────────────────────
step "11/14 · Seed IAM"
if npx ts-node --project tsconfig.json prisma/seeds/iam.seed.ts 2>/dev/null; then
  ok "Seed IAM terminé"
else
  warn "Seed IAM skip (données existantes)"
fi

# ─── Dev Seed : utilisateurs de test ─────────────────────────
if npx ts-node --project tsconfig.json prisma/seeds/dev.seed.ts 2>/dev/null; then
  ok "Dev seed terminé (superadmin + tenant1/tenant2 — password: Admin1234!)"
else
  warn "Dev seed skip (utilisateurs déjà créés)"
fi

# ═══════════════════════════════════════════════════════════════
# BLOC 5 — MinIO
# ═══════════════════════════════════════════════════════════════

step "12/14 · MinIO — buckets"

info "Attente MinIO healthcheck..."
RETRIES=20
until curl -sf http://localhost:9000/minio/health/live >/dev/null 2>&1; do
  RETRIES=$((RETRIES - 1)); [ $RETRIES -le 0 ] && { warn "MinIO :9000 inaccessible"; break; }
  printf "."; sleep 2
done
echo ""

BUCKETS="translog-docs translog-photos"

if command -v mc >/dev/null 2>&1; then
  mc alias set translog-dev http://localhost:9000 minioadmin minioadmin123 --quiet 2>/dev/null || true
  for BUCKET in $BUCKETS; do
    mc mb --ignore-existing "translog-dev/$BUCKET" 2>/dev/null \
      && ok "Bucket '$BUCKET' prêt" \
      || warn "Bucket '$BUCKET' déjà existant"
  done
else
  # Fallback : mc dans le container MinIO lui-même
  $COMPOSE exec -T minio sh -c \
    "mc alias set local http://localhost:9000 minioadmin minioadmin123 --quiet 2>/dev/null; \
     mc mb --ignore-existing local/translog-docs local/translog-photos 2>/dev/null" 2>/dev/null \
    && ok "Buckets créés (via mc container)" \
    || warn "Buckets à créer manuellement : http://localhost:9001 (minioadmin / minioadmin123)"
fi

# ═══════════════════════════════════════════════════════════════
# BLOC 6 — Démarrage applicatif
# ═══════════════════════════════════════════════════════════════

step "13/14 · API NestJS (hot-reload)"

# Tuer l'instance précédente si le port est occupé
PREV=$(lsof -ti :3000 2>/dev/null || true)
[ -n "$PREV" ] && { info "Libération port 3000..."; echo "$PREV" | xargs kill 2>/dev/null || true; sleep 1; }

VAULT_ADDR=$VAULT_ADDR \
VAULT_TOKEN=$VAULT_TOKEN \
NODE_ENV=development \
npm run start:dev > /tmp/translog-api.log 2>&1 &
API_PID=$!
echo "$API_PID" > /tmp/translog-api.pid

info "Attente API (max 300s)..."
RETRIES=150
until curl -sf http://localhost:3000/health/live >/dev/null 2>&1 || \
      grep -q "running on port 3000" /tmp/translog-api.log 2>/dev/null; do
  RETRIES=$((RETRIES - 1))
  if [ $RETRIES -le 0 ]; then
    warn "API pas encore prête après 300s. Dernières lignes de log :"
    echo "──────────────────────────────────────────────────────"
    tail -20 /tmp/translog-api.log 2>/dev/null || echo "(log vide)"
    echo "──────────────────────────────────────────────────────"
    warn "Continuer quand même (tail -f /tmp/translog-api.log pour suivre — la compilation peut prendre >2min)"
    break
  fi
  printf "."; sleep 2
done
echo ""; ok "API NestJS démarrée (PID $API_PID)"

step "14/14 · Frontend Vite (hot-reload)"

PREV=$(lsof -ti :5173 2>/dev/null || true)
[ -n "$PREV" ] && { info "Libération port 5173..."; echo "$PREV" | xargs kill 2>/dev/null || true; sleep 1; }

(cd frontend && npm run dev > /tmp/translog-frontend.log 2>&1) &
FRONTEND_PID=$!
echo "$FRONTEND_PID" > /tmp/translog-frontend.pid

RETRIES=15
until grep -q "Local:" /tmp/translog-frontend.log 2>/dev/null; do
  RETRIES=$((RETRIES - 1)); [ $RETRIES -le 0 ] && { warn "Vite pas encore prêt — logs : tail -f /tmp/translog-frontend.log"; break; }
  printf "."; sleep 1
done
echo ""; ok "Frontend Vite démarré (PID $FRONTEND_PID)"

# ═══════════════════════════════════════════════════════════════
# Résumé
# ═══════════════════════════════════════════════════════════════

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

# ─── Trap Ctrl+C ─────────────────────────────────────────────
cleanup() {
  echo ""
  info "Arrêt des processus..."
  kill "$(cat /tmp/translog-api.pid 2>/dev/null)" 2>/dev/null || true
  kill "$(cat /tmp/translog-frontend.pid 2>/dev/null)" 2>/dev/null || true
  ok "Processus arrêtés. Containers Docker actifs (./scripts/stop.sh --docker pour tout arrêter)."
}
trap cleanup EXIT INT TERM

wait
