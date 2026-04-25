#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════
# 02-gen-secrets.sh — Génère .env.prod + tsig.key BIND9 avec secrets aléatoires
#
# Idempotent : ne réécrit PAS un .env.prod existant (pour éviter de perdre
# les credentials Vault après init). Supprime manuellement si tu veux
# repartir de zéro.
# ═════════════════════════════════════════════════════════════════════════════

set -euo pipefail
cd "$(dirname "$0")/.."

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok() { echo -e "${GREEN}✔${NC} $1"; }

if [ -f .env.prod ]; then
    echo -e "${RED}.env.prod existe déjà — avorte (protection anti-écrasement).${NC}"
    echo "Pour repartir de zéro : mv .env.prod .env.prod.backup.$(date +%s) && ./scripts/02-gen-secrets.sh"
    exit 1
fi

# ─── Générateur de secrets ──────────────────────────────────────────────────
rnd32() { openssl rand -base64 32 | tr -d '\n=+/' | head -c 32; }
rnd48() { openssl rand -base64 48 | tr -d '\n=+/' | head -c 48; }
# TSIG : base64 sans padding sur 32 bytes HMAC
tsig_secret() { openssl rand -base64 32 | tr -d '\n'; }

# Copie le template et remplace les placeholders
cp .env.prod.example .env.prod
chmod 600 .env.prod

# Tous les REPLACE_WITH_RANDOM_32B → nouveau secret 32B
while grep -q 'REPLACE_WITH_RANDOM_32B' .env.prod; do
    sed -i "0,/REPLACE_WITH_RANDOM_32B/{s/REPLACE_WITH_RANDOM_32B/$(rnd32)/}" .env.prod
done
while grep -q 'REPLACE_WITH_RANDOM_48B' .env.prod; do
    sed -i "0,/REPLACE_WITH_RANDOM_48B/{s/REPLACE_WITH_RANDOM_48B/$(rnd48)/}" .env.prod
done

# TSIG : séparé (format base64 avec = à la fin accepté)
TSIG=$(tsig_secret)
sed -i "s|REPLACE_WITH_GENERATED_BASE64_32B|${TSIG}|" .env.prod
ok ".env.prod généré (chmod 600)"

# ─── BIND9 : génère /bind9/zones/tsig.key avec la même clé ──────────────────
cat > bind9/zones/tsig.key <<EOF
key "translog-acme." {
    algorithm hmac-sha256;
    secret "${TSIG}";
};
EOF
chmod 644 bind9/zones/tsig.key
ok "bind9/zones/tsig.key généré (utilisable par BIND9 ET Caddy via TSIG_SECRET env)"

# ─── VAULT_TOKEN reste REPLACE_AFTER_VAULT_INIT ─────────────────────────────
# Ce champ est rempli APRÈS le premier démarrage Vault via `vault operator init`
# Voir runbooks/CUTOVER.md §4 pour la procédure.
echo ""
echo -e "${YELLOW}⚠ VAULT_TOKEN reste à REPLACE_AFTER_VAULT_INIT${NC}"
echo "   Sera rempli après le premier 'vault operator init' (étape §4 du runbook)"
echo ""

# ─── Récap + audit ──────────────────────────────────────────────────────────
echo "Secrets générés dans .env.prod :"
grep -E '^(POSTGRES|REDIS|MINIO|PLATFORM_BOOTSTRAP|DOMAIN_CHECK|TSIG)_' .env.prod | cut -d= -f1 | sed 's/^/   /'

echo ""
ok "02-gen-secrets.sh terminé — enchaîne avec 03-import-traefik-certs.sh"
echo ""
echo "🔐 IMPORTANT : backup de .env.prod maintenant (password manager, coffre-fort)."
echo "             Sans ces secrets, la DB est inaccessible."
