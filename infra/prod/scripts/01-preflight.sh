#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════
# 01-preflight.sh — Vérifications AVANT le cutover production.
#
# Idempotent : rejouable à volonté. Aucun service TransLog installé encore.
# À lancer EN ROOT sur le VPS depuis le répertoire infra/prod/.
# ═════════════════════════════════════════════════════════════════════════════

set -euo pipefail
cd "$(dirname "$0")/.."

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✔${NC} $1"; }
fail() { echo -e "${RED}✘${NC} $1"; exit 1; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }

echo "══════════════════════════════════════════════════════════════════"
echo "  TransLog Pro — PRÉFLIGHT (aucune action destructrice ici)"
echo "══════════════════════════════════════════════════════════════════"

# ─── 1. Sanity root / Docker / Compose ───────────────────────────────────────
[ "$EUID" -eq 0 ] || fail "Ce script doit tourner en root"
command -v docker >/dev/null 2>&1 || fail "Docker absent"
docker compose version >/dev/null 2>&1 || fail "docker compose plugin absent"
ok "root + Docker + compose OK"

# ─── 2. Network easypanel-gmp attachable ─────────────────────────────────────
attachable=$(docker network inspect easypanel-gmp -f '{{.Attachable}}' 2>/dev/null || echo "missing")
[ "$attachable" = "true" ] || fail "easypanel-gmp absent ou non-attachable (résultat: $attachable)"
ok "easypanel-gmp attachable=true"

# ─── 3. acme.json Traefik Easypanel accessible ───────────────────────────────
ACME_JSON="/etc/easypanel/traefik/acme.json"
[ -s "$ACME_JSON" ] || fail "acme.json Traefik absent ou vide ($ACME_JSON)"
ok "acme.json trouvé ($(du -h $ACME_JSON | cut -f1))"

# ─── 4. Ports 80/443/53 : vérifier qui écoute ────────────────────────────────
listens=$(ss -tlnp 2>/dev/null | grep -E ':(80|443|53) ' || true)
if echo "$listens" | grep -q "docker-proxy"; then
    ok "80/443 tenus par Traefik Easypanel (normal, on le remplace au cutover)"
else
    warn "80/443 pas tenus par docker-proxy — vérifier manuellement :\n$listens"
fi

if echo "$listens" | grep -q "127.0.0.53:53\|127.0.0.54:53"; then
    warn "systemd-resolved tient 127.0.0.53:53 — il faut désactiver le stub listener"
    echo ""
    read -rp "→ Désactiver maintenant DNSStubListener (modification /etc/systemd/resolved.conf) ? [y/N] " confirm
    if [[ "$confirm" =~ ^[Yy]$ ]]; then
        backup="/etc/systemd/resolved.conf.bak.$(date +%s)"
        cp /etc/systemd/resolved.conf "$backup"
        ok "Backup: $backup"

        if grep -q '^#\?DNSStubListener=' /etc/systemd/resolved.conf; then
            sed -i 's/^#\?DNSStubListener=.*/DNSStubListener=no/' /etc/systemd/resolved.conf
        else
            echo 'DNSStubListener=no' >> /etc/systemd/resolved.conf
        fi

        # Remplace /etc/resolv.conf symlink (qui pointait vers le stub 127.0.0.53)
        # par un lien vers le resolv.conf réel de systemd-resolved.
        rm -f /etc/resolv.conf
        ln -sf /run/systemd/resolve/resolv.conf /etc/resolv.conf

        systemctl restart systemd-resolved
        sleep 2
        ok "systemd-resolved stub désactivé, resolv.conf relié au resolver réel"
    else
        fail "Cutover impossible tant que port 53 est pris par systemd-resolved"
    fi
else
    ok "Port 53 libre (systemd-resolved stub déjà désactivé)"
fi

# ─── 5. Ressources (pas de 'tight' non prévu) ────────────────────────────────
ram_free_mb=$(free -m | awk '/^Mem:/ {print $7}')
disk_free_gb=$(df -BG / | awk 'NR==2 {gsub("G",""); print $4}')
[ "$ram_free_mb" -ge 3000 ] || warn "RAM libre=${ram_free_mb}MB (recommandé >3GB)"
[ "$disk_free_gb" -ge 20 ] || fail "Disk libre=${disk_free_gb}GB (minimum 20GB requis)"
ok "Ressources : ${ram_free_mb}MB RAM libre, ${disk_free_gb}GB disk libre"

# ─── 6. DNS — propagation NS depuis Internet ────────────────────────────────
echo ""
echo "Vérification propagation NS (peut échouer si DNS pas encore propagé) :"
ns_check=$(dig +short +time=5 NS translog.dsyann.info @1.1.1.1 2>/dev/null || true)
if [ -z "$ns_check" ]; then
    warn "NS translog.dsyann.info non-propagé depuis 1.1.1.1 (attendre 1-24h)"
    warn "Le cutover peut quand même se faire, certs wildcard échoueront tant que DNS pas propagé"
else
    ok "NS propagés : $(echo "$ns_check" | tr '\n' ' ')"
fi

# Glue records
glue_check=$(dig +short +time=5 A ns1.translog.dsyann.info @1.1.1.1 2>/dev/null || true)
[ -z "$glue_check" ] && warn "Glue A ns1 non-propagé" || ok "Glue A ns1 = $glue_check"

# ─── 7. .env.prod présent (avant de build) ──────────────────────────────────
if [ ! -f .env.prod ]; then
    warn ".env.prod absent — exécute ./scripts/02-gen-secrets.sh avant 04-deploy.sh"
else
    # Sanity : tous les REPLACE_* doivent être remplacés
    replaced=$(grep -c 'REPLACE_WITH' .env.prod || true)
    [ "$replaced" -eq 0 ] || fail ".env.prod contient encore $replaced placeholders REPLACE_WITH_*"
    ok ".env.prod valide (aucun placeholder)"
fi

# ─── 8. Updates système pending → recommander reboot ────────────────────────
if [ -f /var/run/reboot-required ]; then
    warn "System restart required (patches sécu en attente). Reboote AVANT le cutover."
fi

echo ""
echo "══════════════════════════════════════════════════════════════════"
echo -e "${GREEN}  ✔ Préflight OK — tu peux enchaîner 02-gen-secrets.sh puis 04-deploy.sh${NC}"
echo "══════════════════════════════════════════════════════════════════"
