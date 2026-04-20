#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# TransLog Pro — Sync rapide /etc/hosts ↔ tenants en DB (macOS)
# ═══════════════════════════════════════════════════════════════════
# Usage :
#   ./scripts/dev-sync-hosts.sh           # sync (sudo requis)
#   ./scripts/dev-sync-hosts.sh --dry-run # affiche le bloc sans l'écrire
#
# À quoi ça sert :
#   Quand tu crées un tenant via le wizard public (/signup) APRÈS avoir
#   lancé dev-up.sh, son slug n'est pas encore dans /etc/hosts — donc
#   `https://<slug>.translog.test/login` ne résout pas.
#   Ce script re-lit la DB et régénère juste le bloc TRANSLOG DEV.
#
# Différence avec dev-up.sh :
#   dev-up.sh fait TOUT (mkcert, certs, docker, seed, hosts…).
#   dev-sync-hosts.sh fait UNIQUEMENT l'étape 7 (hosts). C'est rapide.
#
# Idempotent : mêmes marqueurs que dev-up.sh / dev-down.sh, donc le
# cleanup dev-down.sh retire le bloc comme d'habitude.
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR/.."

# shellcheck disable=SC1091
source "$SCRIPT_DIR/dev.config.sh"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info() { echo -e "${BLUE}ℹ${NC}  $*"; }
ok()   { echo -e "${GREEN}✓${NC}  $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
fail() { echo -e "${RED}✗${NC}  $*" >&2; exit 1; }

HOSTS_FILE="/etc/hosts"
BEGIN_MARKER="# === TRANSLOG DEV BEGIN (managed by dev-up.sh — remove with dev-down.sh) ==="
END_MARKER="# === TRANSLOG DEV END ==="

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

[[ "$(uname)" == "Darwin" ]] || fail "Script destiné à macOS."
command -v docker >/dev/null 2>&1 || fail "Docker requis."
docker info >/dev/null 2>&1 || fail "Docker Desktop n'est pas lancé."

# ─── Lecture des slugs depuis la DB ────────────────────────────────
if ! docker exec translog-postgres pg_isready -U app_user -d translog >/dev/null 2>&1; then
  fail "Container translog-postgres indisponible. Lance d'abord ./scripts/dev-up.sh"
fi

HOSTNAMES=(
  "$PLATFORM_BASE_DOMAIN"
  "$ADMIN_SUBDOMAIN.$PLATFORM_BASE_DOMAIN"
)

slugs=$(docker exec translog-postgres psql -U app_user -d translog \
  -t -A -c "SELECT slug FROM tenants ORDER BY slug" 2>/dev/null) \
  || fail "Impossible de lire les tenants depuis la DB."

# Filtre : on ignore les tenants jetables Playwright/E2E (cf. ALLOWED_PREFIXES
# dans scripts/cleanup-e2e-tenants.ts) et le slug interne plateforme.
# Ces tenants sont créés/détruits en boucle par la CI — ne pas polluer /etc/hosts.
is_skipped() {
  case "$1" in
    pw-saas-*|pw-a-*|pw-e2e-*|e2e-*|__platform__) return 0 ;;
    *) return 1 ;;
  esac
}

skipped=0
while IFS= read -r slug; do
  [[ -z "$slug" ]] && continue
  if is_skipped "$slug"; then skipped=$((skipped + 1)); continue; fi
  HOSTNAMES+=("$slug.$PLATFORM_BASE_DOMAIN")
done <<< "$slugs"

[[ "$skipped" -gt 0 ]] && info "Filtrés : $skipped tenant(s) E2E/plateforme ignoré(s)."

info "Bloc calculé (${#HOSTNAMES[@]} entrées) :"
for h in "${HOSTNAMES[@]}"; do echo "    127.0.0.1 $h"; done

# ─── Dry-run : on s'arrête là ──────────────────────────────────────
if [[ "$DRY_RUN" == "1" ]]; then
  warn "Dry-run — /etc/hosts NON modifié."
  exit 0
fi

# ─── Écriture idempotente ──────────────────────────────────────────
info "Mise à jour de /etc/hosts (sudo requis)…"
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
  echo "# Domaine : $PLATFORM_BASE_DOMAIN"
  for h in "${HOSTNAMES[@]}"; do
    printf "127.0.0.1 %s\n" "$h"
  done
  echo "$END_MARKER"
} | sudo tee "$HOSTS_FILE" >/dev/null
rm -f "$tmp"

ok "/etc/hosts synchronisé (${#HOSTNAMES[@]} hosts)"
