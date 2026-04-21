#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# TransLog Pro — Setup dev prod-like (macOS)
# ═══════════════════════════════════════════════════════════════════
# Ce script :
#   1. Installe mkcert (via brew) + trust la CA dans le keychain macOS
#   2. Génère les certs wildcard *.translog.test
#   3. Sauvegarde /etc/hosts puis ajoute les entrées tenants
#   4. Lance le stack Docker (infra + Caddy)
#   5. Applique les migrations Prisma + seed dev
#
# Idempotent : relancer ce script est sûr, il skippe ce qui est déjà fait.
#
# Pour annuler : ./scripts/dev-down.sh        (arrêt + nettoyage hosts)
# Pour restaurer /etc/hosts à neuf : ./scripts/dev-restore-hosts.sh
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

# Se placer à la racine du projet quel que soit le cwd de l'appelant.
# Tous les chemins relatifs qui suivent sont ainsi stables :
#   docker-compose.yml, infra/caddy/certs, infra/sql/..., prisma/seeds/..., .env
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR/.."

# Source unique de vérité pour PLATFORM_BASE_DOMAIN, ADMIN_SUBDOMAIN.
# Override possible via env avant d'appeler ce script.
# shellcheck disable=SC1091
source "$SCRIPT_DIR/dev.config.sh"

# ─── Couleurs ─────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info() { echo -e "${BLUE}ℹ${NC}  $*"; }
ok()   { echo -e "${GREEN}✓${NC}  $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
fail() { echo -e "${RED}✗${NC}  $*" >&2; exit 1; }

# ─── Config ───────────────────────────────────────────────────────
HOSTS_FILE="/etc/hosts"
HOSTS_BACKUP="/etc/hosts.translog.backup"
BEGIN_MARKER="# === TRANSLOG DEV BEGIN (managed by dev-up.sh — remove with dev-down.sh) ==="
END_MARKER="# === TRANSLOG DEV END ==="
CERT_DIR="infra/caddy/certs"

# HOSTNAMES est calculée DYNAMIQUEMENT après le seed DB (plus de liste en dur).
# Défaut utilisé AVANT que la DB existe : apex + admin subdomain.
# Les slugs tenants seront ajoutés par resolve_hostnames() post-seed.
HOSTNAMES=(
  "$PLATFORM_BASE_DOMAIN"
  "$ADMIN_SUBDOMAIN.$PLATFORM_BASE_DOMAIN"
)

# Lit les slugs tenants depuis la DB et les ajoute à HOSTNAMES.
# Appelé APRÈS le seed Prisma (donc après que les tenants existent).
resolve_hostnames() {
  local slugs
  if ! slugs=$(docker exec translog-postgres psql -U app_user -d translog \
      -t -A -c "SELECT slug FROM tenants ORDER BY slug" 2>/dev/null); then
    warn "Impossible de lire les tenants depuis la DB — HOSTNAMES reste minimal."
    return
  fi
  while IFS= read -r slug; do
    [[ -n "$slug" ]] && HOSTNAMES+=("$slug.$PLATFORM_BASE_DOMAIN")
  done <<< "$slugs"
}

# ─── Pré-check ────────────────────────────────────────────────────
[[ "$(uname)" == "Darwin" ]] || fail "Ce script est destiné à macOS."
[[ -f docker-compose.yml ]]  || fail "Racine projet introuvable (docker-compose.yml absent après cd)."
command -v docker >/dev/null 2>&1 || fail "Docker Desktop requis (docker command manquante)."
docker info >/dev/null 2>&1 || fail "Docker Desktop n'est pas lancé."

# ─── 0. Nettoyage des anciens process Node (API + Vite) ──────────
# Libère les ports 3000/3001 (API NestJS + WebSocket) et 5173 (Vite)
# pour éviter EADDRINUSE au relancement. Idempotent — skippe si aucun
# process trouvé. Aligné sur le BLOC 0 de scripts/dev.sh.
for pidfile in /tmp/translog-api.pid /tmp/translog-frontend.pid; do
  if [[ -f "$pidfile" ]]; then
    old_pid=$(cat "$pidfile" 2>/dev/null || echo "")
    if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
      info "Arrêt process précédent (PID $old_pid, $(basename "$pidfile" .pid))…"
      kill "$old_pid" 2>/dev/null || true
      sleep 1
    fi
    rm -f "$pidfile"
  fi
done
for port in 3000 3001 5173; do
  pids=$(lsof -ti :"$port" 2>/dev/null || true)
  if [[ -n "$pids" ]]; then
    info "Port $port occupé — libération forcée (PIDs: $(echo "$pids" | tr '\n' ' '))…"
    echo "$pids" | xargs kill -9 2>/dev/null || true
  fi
done
ok "Ports applicatifs libres (3000/3001/5173)"

# ─── 1. mkcert ────────────────────────────────────────────────────
if ! command -v mkcert >/dev/null 2>&1; then
  info "Installation de mkcert (via Homebrew)…"
  command -v brew >/dev/null 2>&1 || fail "Homebrew requis. https://brew.sh"
  brew install mkcert nss
  ok "mkcert installé"
else
  ok "mkcert déjà présent"
fi

# ─── 2. Trust CA mkcert ───────────────────────────────────────────
# mkcert -install est idempotent (détecte la CA déjà présente).
info "Vérification de la CA mkcert dans le keychain…"
mkcert -install
ok "CA mkcert trustée (keychain macOS)"

# ─── 3. Génération des certs ──────────────────────────────────────
mkdir -p "$CERT_DIR"
if [[ ! -f "$CERT_DIR/dev.crt" || ! -f "$CERT_DIR/dev.key" ]]; then
  info "Génération des certs wildcard *.${PLATFORM_BASE_DOMAIN}…"
  mkcert \
    -cert-file "$CERT_DIR/dev.crt" \
    -key-file  "$CERT_DIR/dev.key" \
    "*.$PLATFORM_BASE_DOMAIN" "$PLATFORM_BASE_DOMAIN" localhost 127.0.0.1 ::1
  ok "Certs générés → $CERT_DIR/dev.{crt,key}"
else
  ok "Certs déjà présents"
fi

# ─── 4. Backup /etc/hosts ─────────────────────────────────────────
# La modification effective est faite en étape 7 (après seed DB) pour
# pouvoir y injecter la liste DYNAMIQUE des slugs tenants.
if [[ ! -f "$HOSTS_BACKUP" ]]; then
  info "Sauvegarde de /etc/hosts → $HOSTS_BACKUP (sudo requis)…"
  sudo cp "$HOSTS_FILE" "$HOSTS_BACKUP"
  ok "Backup créé"
else
  ok "Backup /etc/hosts déjà présent ($HOSTS_BACKUP)"
fi

# ─── 5. Stack Docker ──────────────────────────────────────────────
info "Démarrage du stack Docker (infra + Caddy)…"
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d \
  postgres pgbouncer redis vault vault-init minio caddy

info "Attente de PostgreSQL…"
for i in $(seq 1 60); do
  if docker exec translog-postgres pg_isready -U app_user -d translog >/dev/null 2>&1; then
    ok "PostgreSQL prêt"; break
  fi
  sleep 1
  [[ "$i" == "60" ]] && fail "Timeout PostgreSQL après 60s"
done

# ─── 6. Schéma Prisma + Seed ──────────────────────────────────────
# Le projet utilise `prisma db push` (schema-first), PAS `prisma migrate`.
# Pas de dossier prisma/migrations/ — toute évolution passe par le schema +
# éventuels scripts SQL idempotents dans infra/sql/ pour les data migrations.
if [[ -f .env ]]; then
  info "Application du schéma Prisma (db push)…"
  npx prisma db push --skip-generate --accept-data-loss
  npx prisma generate
  ok "Schéma synchronisé + client Prisma généré"

  info "Seed dev (tenants, users, rôles)…"
  npx ts-node prisma/seeds/dev.seed.ts
  ok "Seed terminé"

  # Migration SQL de schéma Phase 1 (email unique par tenant, Account.tenantId,
  # TenantDomain table). Idempotent — safe en ré-exécution.
  info "Migration SQL Phase 1 (schéma multi-tenant, idempotent)…"
  docker exec -i translog-postgres psql -U app_user -d translog \
    < infra/sql/03-multi-tenant-isolation-phase1.sql >/dev/null
  ok "Schéma Phase 1 appliqué"

  # Seed tenant_domains shell-templated sur $PLATFORM_BASE_DOMAIN — 1 ligne
  # par tenant. TenantResolverService matchera ainsi via le header Host.
  info "Seed tenant_domains pour *.${PLATFORM_BASE_DOMAIN}…"
  "$SCRIPT_DIR/seed-tenant-domains.sh" >/dev/null
  ok "tenant_domains seedés ($PLATFORM_BASE_DOMAIN)"

  # Vault : clé HMAC d'impersonation (Phase 2 cross-subdomain).
  # vault-init (restart: "no") ne re-joue pas si déjà initialisé — on force
  # la présence de la clé ici pour garantir l'idempotence du setup.
  info "Vault : provision secret/platform/impersonation_key…"
  if docker exec -e VAULT_TOKEN=dev-root-token translog-vault \
      vault kv get secret/platform/impersonation_key >/dev/null 2>&1; then
    ok "Clé impersonation déjà présente"
  else
    docker exec -e VAULT_TOKEN=dev-root-token translog-vault \
      vault kv put secret/platform/impersonation_key \
      KEY="dev-imp-$(openssl rand -hex 32)" >/dev/null
    ok "Clé impersonation provisionnée"
  fi

  info "Vault : provision secret/platform/redis…"
  if docker exec -e VAULT_TOKEN=dev-root-token translog-vault \
      vault kv get secret/platform/redis >/dev/null 2>&1; then
    ok "Config Redis déjà présente"
  else
    docker exec -e VAULT_TOKEN=dev-root-token translog-vault \
      vault kv put secret/platform/redis \
      HOST="localhost" PORT="6379" PASSWORD="redis_password" >/dev/null
    ok "Config Redis provisionnée"
  fi
else
  warn ".env absent — skip migrations et seed. Crée .env puis relance."
fi

# ─── 7. /etc/hosts dynamique ──────────────────────────────────────
# Regénère le bloc TRANSLOG DEV à partir de la DB (apex + admin + tenants).
# Idempotent : on supprime l'ancien bloc s'il existe, on écrit le nouveau.
# Bénéfice : quand tu ajoutes un tenant via le seed, juste ./scripts/dev-up.sh
# et /etc/hosts est à jour sans toucher à aucune liste en dur.
resolve_hostnames
info "Mise à jour de /etc/hosts (${#HOSTNAMES[@]} entrées, sudo requis)…"
tmp="$(mktemp)"
awk -v b="$BEGIN_MARKER" -v e="$END_MARKER" '
  index($0, b) { skip=1; next }
  index($0, e) { skip=0; next }
  !skip { print }
' "$HOSTS_FILE" > "$tmp"
{
  cat "$tmp"
  echo ""
  echo "$BEGIN_MARKER"
  echo "# Pour retirer ces lignes : ./scripts/dev-down.sh  OU  supprimer ce bloc à la main."
  echo "# Domaine : $PLATFORM_BASE_DOMAIN (override via PLATFORM_BASE_DOMAIN=... ./scripts/dev-up.sh)"
  for h in "${HOSTNAMES[@]}"; do
    printf "127.0.0.1 %s\n" "$h"
  done
  echo "$END_MARKER"
} | sudo tee "$HOSTS_FILE" >/dev/null
rm -f "$tmp"
ok "/etc/hosts synchronisé"

# ─── 8. Instructions ──────────────────────────────────────────────
cat <<EOF

$(ok "Setup terminé ✨")

  ┌──────────────────────────────────────────────────────────────┐
  │ Dans 2 terminaux séparés (hot-reload) :                      │
  │                                                              │
  │   Terminal A :  npm run start:dev                            │
  │   Terminal B :  npm run dev --prefix frontend                │
  │                                                              │
  └──────────────────────────────────────────────────────────────┘

  Puis dans Edge :

    Fenêtre 1 (normale)   → https://trans-express.$PLATFORM_BASE_DOMAIN/login
                            admin@tenant1.dev  /  Admin1234!

    Fenêtre 2 (InPrivate) → https://citybus-congo.$PLATFORM_BASE_DOMAIN/login
                            admin@tenant2.dev  /  Admin1234!

    Fenêtre 3             → https://horizon-voyages.$PLATFORM_BASE_DOMAIN/login
                            admin@tenant3.dev  /  Admin1234!

    Fenêtre 4             → https://dsexpress.$PLATFORM_BASE_DOMAIN/login
                            zoec@ds.cg  /  Admin1234!

    Super-admin           → https://$ADMIN_SUBDOMAIN.$PLATFORM_BASE_DOMAIN/login
                            superadmin@translogpro.io  /  Admin1234!

  Configuration centralisée :
    Domaine plateforme    : $PLATFORM_BASE_DOMAIN
    Admin subdomain       : $ADMIN_SUBDOMAIN
    → source de vérité    : scripts/dev.config.sh
    → override temporaire : PLATFORM_BASE_DOMAIN=xxx ./scripts/dev-up.sh

  Pour arrêter            : ./scripts/dev-down.sh
  Pour tout désinstaller  : ./scripts/dev-down.sh --full
  Restaurer /etc/hosts    : ./scripts/dev-restore-hosts.sh

EOF
