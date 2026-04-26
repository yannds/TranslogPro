# Custom Caddy build with rfc2136 DNS plugin (pour DNS-01 via BIND9 local TSIG).
# Image finale <50 MB.
#
# Pinning à `caddy:2-builder` (latest 2.x) parce que :
#   - rfc2136 v1.0.0+ nécessite Go ≥1.24 (présent dans Caddy 2.9+)
#   - 2.8-builder utilise Go 1.23.4 → incompatible

FROM caddy:2-builder AS builder

RUN xcaddy build \
    --with github.com/caddy-dns/rfc2136

FROM caddy:2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy

# Vérification plugin chargé (fail-fast si build cassé)
RUN caddy list-modules | grep -q "dns.providers.rfc2136" || (echo "FATAL: rfc2136 plugin missing" && exit 1)

# Hardening : tourne en non-root (uid 1000). NET_BIND_SERVICE requis pour
# bind 80/443 (cap_add dans docker-stack.prod.yml). Volumes /data /config
# /var/log/caddy doivent être chown 1000:1000 sur le host avant deploy.
RUN addgroup -g 1000 caddy && adduser -u 1000 -G caddy -S -D caddy
USER 1000:1000
