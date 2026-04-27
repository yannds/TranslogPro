# Custom Caddy build avec :
#   - rfc2136 (DNS-01 via BIND9 local TSIG, wildcard cert *.translog.dsyann.info)
#   - caddy-crowdsec-bouncer (Lot 2 — middleware HTTP qui interroge la LAPI
#     CrowdSec sur chaque requête. En mode simulation par défaut, n'enforce
#     rien — observe seulement. Doc : docs/manuals/admin-infra/observability.md §6)
# Image finale <60 MB.
#
# Pinning à `caddy:2-builder` (latest 2.x) parce que :
#   - rfc2136 v1.0.0+ nécessite Go ≥1.24 (présent dans Caddy 2.9+)
#   - 2.8-builder utilise Go 1.23.4 → incompatible

FROM caddy:2-builder AS builder

RUN xcaddy build \
    --with github.com/caddy-dns/rfc2136 \
    --with github.com/hslatman/caddy-crowdsec-bouncer/http \
    --with github.com/hslatman/caddy-crowdsec-bouncer/layer4

FROM caddy:2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy

# Vérifications plugins chargés (fail-fast si build cassé)
RUN caddy list-modules | grep -q "dns.providers.rfc2136" || (echo "FATAL: rfc2136 plugin missing" && exit 1)
RUN caddy list-modules | grep -q "http.handlers.crowdsec" || (echo "FATAL: crowdsec http handler missing" && exit 1)
RUN caddy list-modules | grep -q "crowdsec" || (echo "FATAL: crowdsec module missing" && exit 1)

# ⚠️ Caddy non-root tenté en V5-D mais TLS internal error — Caddy 2.x ne
# génère pas de tls_connection_policies en runtime quand user=1000 sur cette
# image, alors que `caddy validate` passe. Bug inconnu (peut-être lié au
# storage / acquisition cert au boot avec uid mismatch). Reverté en root.
# Conservé : user `caddy` (uid 1000) créé pour usage futur quand bug sera
# tracé/corrigé. Activer en V6 avec `USER 1000:1000` + cap_add NET_BIND_SERVICE
# en docker-stack.prod.yml + chown volumes 1000:1000.
RUN addgroup -g 1000 caddy && adduser -u 1000 -G caddy -S -D caddy
