#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════
# 03-import-traefik-certs.sh — Extrait les certs de Traefik Easypanel (acme.json)
#                              et les pré-charge dans le volume Caddy storage.
#
# But : éviter la re-émission inutile des 8 certs gmp au cutover.
#       Caddy utilisera les certs existants, renouvellera au prochain cycle
#       (dans ~60 jours) via HTTP-01 qu'il gère désormais sur 80/443.
#
# Format Caddy : /data/caddy/certificates/<issuer>/<domain>/<domain>.{crt,key,json}
# Format Traefik : JSON avec Certificate (PEM b64) et Key (PEM b64).
# ═════════════════════════════════════════════════════════════════════════════

set -euo pipefail
cd "$(dirname "$0")/.."

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✔${NC} $1"; }
fail() { echo -e "${RED}✘${NC} $1"; exit 1; }

ACME_JSON="${ACME_JSON:-/etc/easypanel/traefik/acme.json}"
[ -s "$ACME_JSON" ] || fail "acme.json introuvable ($ACME_JSON)"

command -v jq >/dev/null 2>&1 || fail "jq requis — apt install -y jq"

# Crée le volume Caddy si pas encore là (pas déployé)
VOLUME="translog_caddy_data"
if ! docker volume inspect "$VOLUME" >/dev/null 2>&1; then
    docker volume create "$VOLUME"
    ok "Volume $VOLUME créé"
fi

# Monte le volume dans un container temporaire busybox pour y écrire
TMP_CTR=$(docker create --rm -v "$VOLUME:/data" busybox sleep 3600)
docker start "$TMP_CTR" >/dev/null

cleanup() { docker rm -f "$TMP_CTR" >/dev/null 2>&1 || true; }
trap cleanup EXIT

ISSUER_DIR="/data/caddy/certificates/acme-v02.api.letsencrypt.org-directory"
docker exec "$TMP_CTR" mkdir -p "$ISSUER_DIR"

imported=0
skipped=0

# Traefik stocke les certs dans .letsencrypt.Certificates (nom du resolver)
# ou .default.Certificates selon config. On essaie les deux.
for resolver in letsencrypt default; do
    count=$(jq -r ".[\"${resolver}\"].Certificates // [] | length" "$ACME_JSON")
    [ "$count" = "0" ] && continue

    echo "Résolver Traefik : $resolver ($count certs)"

    # Pour chaque cert, on extrait domain, cert (PEM b64), key (PEM b64)
    while IFS= read -r encoded; do
        domain=$(echo "$encoded" | jq -r '.domain.main')
        cert_b64=$(echo "$encoded" | jq -r '.certificate')
        key_b64=$(echo "$encoded" | jq -r '.key')

        [ "$domain" = "null" ] && continue
        [ -z "$cert_b64" ] || [ "$cert_b64" = "null" ] && { skipped=$((skipped+1)); continue; }

        # Crée le sous-répertoire Caddy pour ce domaine
        dom_dir="$ISSUER_DIR/$domain"
        docker exec "$TMP_CTR" mkdir -p "$dom_dir"

        # Injecte cert + key (base64 → PEM)
        echo "$cert_b64" | base64 -d | docker exec -i "$TMP_CTR" sh -c "cat > $dom_dir/${domain}.crt"
        echo "$key_b64"  | base64 -d | docker exec -i "$TMP_CTR" sh -c "cat > $dom_dir/${domain}.key"

        # Metadata JSON Caddy (permissions + issuer identification)
        docker exec "$TMP_CTR" sh -c "cat > $dom_dir/${domain}.json" <<EOF
{"sans":["$domain"],"issuer_data":{"url":"https://acme-v02.api.letsencrypt.org/directory"}}
EOF

        ok "importé : $domain"
        imported=$((imported+1))
    done < <(jq -c ".[\"${resolver}\"].Certificates[]" "$ACME_JSON")
done

echo ""
echo "Résumé : ${imported} cert(s) importé(s), ${skipped} vide(s) ignoré(s)"

[ "$imported" -gt 0 ] || fail "Aucun cert importé — vérifie manuellement le acme.json"

ok "Pré-chargement Caddy terminé — prêt pour 04-deploy.sh"
