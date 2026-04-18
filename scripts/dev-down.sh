#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# TransLog Pro — Arrêt + nettoyage dev
# ═══════════════════════════════════════════════════════════════════
# Par défaut (mode "disable") :
#   - Stoppe les containers Docker (volumes préservés — la DB reste)
#   - Retire le bloc TRANSLOG DEV de /etc/hosts
#   - Garde mkcert installé + les certs (c'est 3 fichiers, zéro impact)
#
# Avec --full (mode "uninstall total") :
#   - Supprime les volumes Docker (DB vidée — perte de données)
#   - Supprime les certs locaux
#   - Désinstalle la CA mkcert du keychain macOS
#
# Pour restaurer /etc/hosts strictement à l'identique du backup :
#   ./scripts/dev-restore-hosts.sh
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

# Se placer à la racine du projet quel que soit le cwd de l'appelant.
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR/.."

# Source unique de vérité (symétrique de dev-up.sh).
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
CERT_DIR="infra/caddy/certs"

FULL=0
if [[ "${1:-}" == "--full" ]]; then
  FULL=1
fi

[[ -f docker-compose.yml ]] || fail "Racine projet introuvable (docker-compose.yml absent après cd)."

# ─── 1. Stop containers ───────────────────────────────────────────
if [[ "$FULL" == "1" ]]; then
  warn "Mode --full : suppression des volumes Docker (DB sera vidée)."
  info "docker compose down -v…"
  docker compose -f docker-compose.yml -f docker-compose.dev.yml down -v
  ok "Containers + volumes supprimés"
else
  info "Arrêt des containers (volumes préservés)…"
  docker compose -f docker-compose.yml -f docker-compose.dev.yml down
  ok "Containers arrêtés"
fi

# ─── 2. Nettoyer /etc/hosts ───────────────────────────────────────
if grep -qF "$BEGIN_MARKER" "$HOSTS_FILE"; then
  info "Retrait du bloc TRANSLOG DEV de /etc/hosts (sudo requis)…"
  # sed -i '' sur BSD/macOS ; on filtre via awk pour être plus robuste.
  tmp="$(mktemp)"
  awk -v b="$BEGIN_MARKER" -v e="$END_MARKER" '
    index($0, b) { skip=1; next }
    index($0, e) { skip=0; next }
    !skip { print }
  ' "$HOSTS_FILE" > "$tmp"
  sudo cp "$tmp" "$HOSTS_FILE"
  rm -f "$tmp"
  ok "Bloc retiré de /etc/hosts"
else
  ok "Aucun bloc TRANSLOG DEV dans /etc/hosts"
fi

# ─── 3. Mode --full : certs + mkcert CA ───────────────────────────
if [[ "$FULL" == "1" ]]; then
  if [[ -f "$CERT_DIR/dev.crt" || -f "$CERT_DIR/dev.key" ]]; then
    info "Suppression des certs locaux…"
    rm -f "$CERT_DIR/dev.crt" "$CERT_DIR/dev.key"
    ok "Certs supprimés"
  fi

  if command -v mkcert >/dev/null 2>&1; then
    info "Désinstallation de la CA mkcert du keychain macOS…"
    mkcert -uninstall || warn "mkcert -uninstall a échoué (peut-être déjà désinstallé)"
    ok "CA mkcert désinstallée"
  fi

  warn "mkcert binaire gardé (brew uninstall mkcert si tu veux virer aussi)."
fi

echo ""
ok "Nettoyage terminé."
if [[ "$FULL" != "1" ]]; then
  echo "  → Relance avec ./scripts/dev-up.sh pour repartir."
  echo "  → Utilise --full pour tout désinstaller (CA + certs + volumes DB)."
fi
