#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# TransLog Pro — Restauration /etc/hosts à l'identique du backup
# ═══════════════════════════════════════════════════════════════════
# Restaure /etc/hosts à partir de /etc/hosts.translog.backup
# (la copie faite par dev-up.sh AVANT la première modification).
#
# Use case : tu veux effacer toute trace — pas juste le bloc TRANSLOG DEV,
# mais revenir EXACTEMENT au fichier d'origine.
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info() { echo -e "${BLUE}ℹ${NC}  $*"; }
ok()   { echo -e "${GREEN}✓${NC}  $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
fail() { echo -e "${RED}✗${NC}  $*" >&2; exit 1; }

HOSTS_FILE="/etc/hosts"
HOSTS_BACKUP="/etc/hosts.translog.backup"

[[ -f "$HOSTS_BACKUP" ]] || fail "Backup introuvable : $HOSTS_BACKUP. Rien à restaurer."

# Sécurité : snapshot l'état courant juste avant restauration (au cas où).
snapshot="/etc/hosts.before-restore.$(date +%Y%m%d-%H%M%S)"
info "Snapshot de l'état courant → $snapshot (sudo requis)…"
sudo cp "$HOSTS_FILE" "$snapshot"
ok "Snapshot créé"

info "Restauration de /etc/hosts depuis $HOSTS_BACKUP (sudo requis)…"
sudo cp "$HOSTS_BACKUP" "$HOSTS_FILE"
ok "/etc/hosts restauré à l'état original"

echo ""
ok "Terminé."
echo "  → Backup d'origine conservé : $HOSTS_BACKUP"
echo "  → Snapshot avant restore    : $snapshot"
echo "  → Pour ré-appliquer dev     : ./scripts/dev-up.sh"
