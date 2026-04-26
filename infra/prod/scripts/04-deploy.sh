#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════
# 04-deploy.sh — Déploiement TransLog Pro production AUTONOME
#
# Du serveur vierge (avec Easypanel/gmp coexistants) à la prod fonctionnelle.
# Idempotent : rejouable à volonté.
#
# Pauses MANUELLES inévitables (par design sécurité) :
#   1. vault operator init   (génère 5 unseal keys + root token)
#   2. vault operator unseal (3× après chaque restart Vault)
#   → Le script s'arrête avec instructions, tu reprends après.
#
# Usage :
#   bash scripts/04-deploy.sh
#
# Variables optionnelles dans .env.prod :
#   PLATFORM_SUPERADMIN_EMAIL, PLATFORM_SUPERADMIN_NAME, PLATFORM_SUPERADMIN_PASSWORD
#     → Si présentes, seed automatique d'un super-admin plateforme.
# ═════════════════════════════════════════════════════════════════════════════

set -euo pipefail
cd "$(dirname "$0")/.."   # → infra/prod/

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()     { echo -e "${GREEN}✔${NC} $1"; }
fail()   { echo -e "${RED}✘ $1${NC}"; exit 1; }
warn()   { echo -e "${YELLOW}⚠${NC} $1"; }
header() { echo ""; echo "═══════════════════════════════════════════════════════════"; echo "  $1"; echo "═══════════════════════════════════════════════════════════"; }

STACK_NAME="translog"
COMPOSE_FILE="docker-compose.prod.yml"   # build only
STACK_FILE="docker-stack.prod.yml"        # deploy
OBS_STACK_NAME="translog-obs"
OBS_STACK_FILE="observability/docker-stack.observability.yml"

# ─── 0. Sanity ──────────────────────────────────────────────────────────────
header "[0/12] Sanity checks"

[ "$EUID" -eq 0 ] || fail "root required"
[ -f .env.prod ]   || fail ".env.prod absent — run 02-gen-secrets.sh first"
[ -f $STACK_FILE ] || fail "$STACK_FILE absent"

# Charge .env.prod dans le shell pour substitution Swarm + var locales
set -a; . ./.env.prod; set +a

# Init Swarm si pas actif (Easypanel l'a fait, mais sécurité)
if ! docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null | grep -q active; then
    docker swarm init --advertise-addr 127.0.0.1 || fail "Swarm init failed"
    ok "Docker Swarm initialisé"
fi
ok "Sanity OK"

# ─── 1. Permissions BIND9 + drop journal stale ──────────────────────────────
header "[1/12] BIND9 zones permissions + drop journal stale"

# Sans 777 → bind user (UID 100) ne peut pas écrire le journal .jnl → updates TSIG fail
chmod -R 777 ./bind9/zones 2>/dev/null || true

# Drop journal stale (sinon BIND9 préfère le journal au file → records apex/wildcard ignorés)
if [ -f ./bind9/zones/translog.db.jnl ]; then
    rm -f ./bind9/zones/translog.db.jnl
    ok "BIND9 journal stale supprimé"
else
    ok "BIND9 zones permissions OK (pas de journal résiduel)"
fi

# Smart reload BIND9 — flag lu en step 4 pour éviter restart inutile (DNSSEC
# perdrait les RRSIG en mémoire, devrait re-signer toute la zone).
mkdir -p /var/run/translog
NEW_BIND_MD5=$(md5sum ./bind9/named.conf ./bind9/zones/translog.db 2>/dev/null | md5sum | awk '{print $1}')
PREV_BIND_MD5=$(cat /var/run/translog/bind9.md5 2>/dev/null || echo "")
BIND_NEEDS_RELOAD=0
if [ "$NEW_BIND_MD5" != "$PREV_BIND_MD5" ]; then
    BIND_NEEDS_RELOAD=1
fi
echo "$NEW_BIND_MD5" > /var/run/translog/bind9.md5

# ─── 2. Build images (api + web + caddy) ─────────────────────────────────────
header "[2/12] Build images"

# CI/CD : SKIP_BUILD=1 → images viennent déjà de GHCR (pull + tag localement avant deploy)
if [ "${SKIP_BUILD:-0}" = "1" ]; then
    warn "SKIP_BUILD=1 — images supposées présentes (CI/CD GHCR)"
else
    # Web : --build-arg explicit (Vite ne lit pas .env.prod via compose, faut forcer)
    docker build \
        --build-arg VITE_PLATFORM_BASE_DOMAIN="${PLATFORM_BASE_DOMAIN}" \
        --build-arg VITE_API_URL="${PUBLIC_APP_URL}" \
        -f ../../frontend/Dockerfile.prod \
        -t translog_web:1.0.0 \
        ../../frontend/ 2>&1 | tail -3 || fail "Web build failed"

    # API + Caddy via compose (build context différent)
    docker compose --env-file .env.prod -f $COMPOSE_FILE build --pull api caddy 2>&1 | tail -3 \
        || fail "API/Caddy build failed"
fi

# Vérification présence images (que SKIP_BUILD ou pas)
for img in translog_api:1.0.0 translog_web:1.0.0 prod-caddy:latest; do
    docker image inspect "$img" >/dev/null 2>&1 || fail "Image manquante : $img — pull GHCR + retag (cf. CI/CD) ou unset SKIP_BUILD"
done
ok "Images OK : translog_api, translog_web, prod-caddy"

# ─── 3. Cleanup compose résiduel + bridge + services orphelins ─────────────
header "[3/12] Cleanup ancien Compose + bridge + services orphelins"

docker compose --env-file .env.prod -f $COMPOSE_FILE down --remove-orphans 2>/dev/null || true

# Si translog_net existe en mode bridge, le supprimer (sera recréé en overlay par stack)
if docker network inspect translog_net >/dev/null 2>&1; then
    if [ "$(docker network inspect translog_net --format '{{.Driver}}')" != "overlay" ]; then
        docker network rm translog_net 2>/dev/null || true
        ok "Ancien bridge translog_net supprimé"
    fi
fi

# Auto-heal : tout service ${STACK_NAME}_* qui n'a pas le label
# `com.docker.stack.namespace=${STACK_NAME}` est orphelin (créé hors stack
# ou laissé après un stack rm partiel — observé après reboot Docker via
# unattended-upgrades). `docker stack deploy` refuse alors de prendre la
# main et plante avec "name conflicts with an existing object". On les
# supprime ici, le deploy stack recrée à l'identique juste après.
ORPHANS=$(docker service ls --format '{{.Name}}' 2>/dev/null | grep "^${STACK_NAME}_" || true)
for svc in $ORPHANS; do
    label=$(docker service inspect "$svc" --format '{{ index .Spec.Labels "com.docker.stack.namespace" }}' 2>/dev/null || echo "")
    if [ "$label" != "$STACK_NAME" ]; then
        warn "Service orphelin détecté : $svc (label=\"$label\") → drop avant deploy"
        docker service rm "$svc" >/dev/null 2>&1 || true
    fi
done

ok "Cleanup OK"

# ─── 4. Deploy stack Swarm ───────────────────────────────────────────────────
header "[4/13] Deploy Swarm stack"

# Pré-création du réseau d'observabilité (référencé `external: true` par
# Caddy de la stack applicative ET par la stack obs). Idempotent : si déjà
# créé, on ne fait rien. Cassé le poulet/œuf entre les deux stacks.
if ! docker network inspect translog_obs_net >/dev/null 2>&1; then
    docker network create --driver overlay --attachable translog_obs_net >/dev/null
    ok "Réseau translog_obs_net créé (overlay attachable)"
else
    ok "Réseau translog_obs_net déjà présent"
fi

docker stack deploy \
    -c $STACK_FILE \
    --resolve-image=never \
    --with-registry-auth \
    $STACK_NAME || fail "Stack deploy failed"
ok "Stack $STACK_NAME déployé"

# ─── 4b. Deploy observability stack (Lot 1 — Prometheus/Grafana/Loki) ───────
header "[4b/13] Deploy observability stack"

if [ -f "$OBS_STACK_FILE" ]; then
    # GRAFANA_ADMIN_PASSWORD : fallback sur APP_SECRET si pas défini (acceptable
    # car APP_SECRET est déjà un secret robuste dans .env.prod). Préférable :
    # ajouter une var dédiée GRAFANA_ADMIN_PASSWORD dans .env.prod.
    if [ -z "${GRAFANA_ADMIN_PASSWORD:-}" ]; then
        # Génère un mdp aléatoire si absent + persiste dans .env.prod (idempotent)
        if ! grep -q '^GRAFANA_ADMIN_PASSWORD=' .env.prod; then
            GP=$(openssl rand -hex 24)
            echo "GRAFANA_ADMIN_PASSWORD=$GP" >> .env.prod
            warn "GRAFANA_ADMIN_PASSWORD généré et écrit dans .env.prod"
        fi
        set -a; . ./.env.prod; set +a
    fi

    docker stack deploy \
        -c "$OBS_STACK_FILE" \
        --resolve-image=always \
        $OBS_STACK_NAME || fail "Stack observability deploy failed"
    ok "Stack $OBS_STACK_NAME déployé (Prometheus + Grafana + Loki + exporters)"

    # Restart Caddy si la stack applicative tournait déjà (premier deploy obs)
    # → Caddy doit picker le réseau translog_obs_net pour atteindre grafana:3000.
    if docker service inspect ${STACK_NAME}_caddy >/dev/null 2>&1; then
        # Vérifie si Caddy est déjà sur translog_obs_net
        on_obs_net=$(docker service inspect ${STACK_NAME}_caddy \
            --format '{{range .Spec.TaskTemplate.Networks}}{{.Target}} {{end}}' 2>/dev/null \
            | grep -c translog_obs_net || true)
        if [ "$on_obs_net" -eq 0 ]; then
            warn "Caddy pas encore sur translog_obs_net → docker service update --force"
            docker service update --network-add translog_obs_net ${STACK_NAME}_caddy >/dev/null 2>&1 || \
                docker service update --force ${STACK_NAME}_caddy >/dev/null 2>&1 || true
        fi
    fi
else
    warn "$OBS_STACK_FILE introuvable — skip stack observability"
fi

# Smart reload BIND9 si named.conf ou zone changé (sinon DNSSEC perdrait les
# RRSIG en mémoire et devrait re-signer toute la zone).
if [ "$BIND_NEEDS_RELOAD" -eq 1 ]; then
    warn "BIND9 config/zone changé → force update"
    docker service update --force ${STACK_NAME}_bind9 >/dev/null 2>&1 || true
else
    ok "BIND9 config/zone identique — skip reload (RRSIG préservés)"
fi

# Attente services infra healthy
echo "Wait infra services (postgres/redis/minio/bind9) healthy — max 180s..."
START_TS=$(date +%s)
healthy_count=0
while true; do
    healthy_count=0
    for svc in postgres redis minio bind9; do
        cid=$(docker ps --filter "label=com.docker.swarm.service.name=${STACK_NAME}_${svc}" -q 2>/dev/null | head -1)
        if [ -n "${cid:-}" ]; then
            status=$(docker inspect --format='{{.State.Health.Status}}' "$cid" 2>/dev/null || echo none)
            [ "$status" = healthy ] && healthy_count=$((healthy_count + 1))
        fi
    done
    [ "$healthy_count" -ge 4 ] && break
    elapsed=$(($(date +%s) - START_TS))
    if [ "$elapsed" -gt 180 ]; then
        warn "Timeout 3min — $healthy_count/4 healthy. Continue (peut converger)."
        break
    fi
    sleep 5
done
ok "Infra healthy ($healthy_count/4)"

# ─── 5. Postgres : role app_runtime + grants ────────────────────────────────
header "[5/12] Postgres role app_runtime"

docker run --rm -i --network translog_net \
    -e PGPASSWORD="${POSTGRES_APP_ADMIN_PASSWORD}" \
    postgres:16-alpine \
    psql -h postgres -p 5432 -U app_admin -d translog \
    -v runtime_pass="${POSTGRES_APP_RUNTIME_PASSWORD}" <<'EOF' || fail "app_runtime role failed"
-- Idempotent : DROP IF EXISTS gère legacy app_user ou re-run
DROP ROLE IF EXISTS app_runtime;
CREATE ROLE app_runtime LOGIN PASSWORD :'runtime_pass'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;

GRANT CONNECT ON DATABASE translog TO app_runtime;
GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_runtime;

ALTER DEFAULT PRIVILEGES FOR ROLE app_admin IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE app_admin IN SCHEMA public
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE app_admin IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO app_runtime;
EOF
ok "Role app_runtime créé/mis à jour"

# ─── 6. Migrations Prisma + seeds IAM/plans ──────────────────────────────────
header "[6/12] Migrations Prisma + seeds initiaux"

DBURL_ADMIN="postgresql://app_admin:${POSTGRES_APP_ADMIN_PASSWORD}@postgres:5432/translog"

docker run --rm \
    --network translog_net \
    -e DATABASE_URL="$DBURL_ADMIN" \
    translog_api:1.0.0 \
    npx prisma db push --skip-generate --accept-data-loss=false || fail "Prisma db push failed"
ok "Schema Prisma appliqué"

docker run --rm \
    --network translog_net \
    -e DATABASE_URL="$DBURL_ADMIN" \
    translog_api:1.0.0 \
    npx tsx prisma/seeds/iam.seed.ts || fail "Seed IAM failed"
ok "IAM seedé (permissions/roles/workflows)"

docker run --rm \
    --network translog_net \
    -e DATABASE_URL="$DBURL_ADMIN" \
    translog_api:1.0.0 \
    npx tsx prisma/seeds/plans.seed.ts || fail "Seed plans failed"
ok "Plans seedés (Starter/Growth/Enterprise)"

# ─── 7. Vault : init detection + AppRole + secrets seedés ────────────────────
header "[7/12] Vault — AppRole + secrets boot"

VAULT_CID=$(docker ps --filter "label=com.docker.swarm.service.name=${STACK_NAME}_vault" -q | head -1)
[ -n "$VAULT_CID" ] || fail "Container Vault introuvable"

# Détection : Vault initialisé ?
if [ -z "${VAULT_TOKEN:-}" ] || [ "$VAULT_TOKEN" = "REPLACE_AFTER_VAULT_INIT" ]; then
    warn "Vault PAS INITIALISÉ. Lance manuellement :"
    echo ""
    echo "  docker exec -it $VAULT_CID vault operator init"
    echo "  → Conserve les 5 unseal keys + root token (coffre-fort impératif)"
    echo "  → Édite .env.prod : VAULT_TOKEN=<root_token>"
    echo "  → Unseal : docker exec -it $VAULT_CID vault operator unseal <key1>"
    echo "             docker exec -it $VAULT_CID vault operator unseal <key2>"
    echo "             docker exec -it $VAULT_CID vault operator unseal <key3>"
    echo "  → Re-lance ce script : bash scripts/04-deploy.sh"
    exit 0
fi

# Détection : Vault scellé ?
sealed=$(docker exec $VAULT_CID vault status -format=json 2>/dev/null | jq -r '.sealed' || echo true)
if [ "$sealed" = true ]; then
    warn "Vault SCELLÉ. Unseal manuel :"
    echo "  docker exec -it $VAULT_CID vault operator unseal <key1>  (3×)"
    echo "  Puis re-lance ce script."
    exit 0
fi
ok "Vault initialisé + unsealed"

# Setup AppRole + KV-v2 + Transit (idempotent)
docker exec -e VAULT_TOKEN=$VAULT_TOKEN $VAULT_CID vault auth enable approle 2>&1 | grep -v already 1>/dev/null || true
docker exec -e VAULT_TOKEN=$VAULT_TOKEN $VAULT_CID vault secrets enable -path=secret kv-v2 2>&1 | grep -v already 1>/dev/null || true
docker exec -e VAULT_TOKEN=$VAULT_TOKEN $VAULT_CID vault secrets enable transit 2>&1 | grep -v already 1>/dev/null || true

# Policy translog-api (étendue secret/* + transit/* + pki/issue/*)
docker exec -e VAULT_TOKEN=$VAULT_TOKEN $VAULT_CID sh -c 'cat > /tmp/translog-api.hcl <<POLICY
path "secret/*"          { capabilities = ["create","read","update","delete","list","patch"] }
path "transit/encrypt/*" { capabilities = ["update"] }
path "transit/decrypt/*" { capabilities = ["update"] }
path "transit/keys/*"    { capabilities = ["create","read","update","list"] }
path "pki/issue/*"       { capabilities = ["update"] }
POLICY
vault policy write translog-api /tmp/translog-api.hcl' >/dev/null 2>&1

# Role
docker exec -e VAULT_TOKEN=$VAULT_TOKEN $VAULT_CID vault write auth/approle/role/translog-api \
    token_policies="translog-api" token_ttl=1h token_max_ttl=4h >/dev/null 2>&1

# AppRole credentials → .env.prod (rotate à chaque deploy si pas présents)
NEW_ROLE_ID=$(docker exec -e VAULT_TOKEN=$VAULT_TOKEN $VAULT_CID vault read -format=json auth/approle/role/translog-api/role-id 2>/dev/null | jq -r '.data.role_id')
if [ "${VAULT_ROLE_ID:-}" != "$NEW_ROLE_ID" ] || [ -z "${VAULT_SECRET_ID:-}" ]; then
    NEW_SECRET_ID=$(docker exec -e VAULT_TOKEN=$VAULT_TOKEN $VAULT_CID vault write -f -format=json auth/approle/role/translog-api/secret-id | jq -r '.data.secret_id')
    sed -i '/^VAULT_ROLE_ID=/d; /^VAULT_SECRET_ID=/d' .env.prod
    echo "VAULT_ROLE_ID=$NEW_ROLE_ID" >> .env.prod
    echo "VAULT_SECRET_ID=$NEW_SECRET_ID" >> .env.prod
    set -a; . ./.env.prod; set +a
    ok "AppRole credentials écrits dans .env.prod"
fi

# APP_SECRET stable : génère si absent
if [ -z "${APP_SECRET:-}" ]; then
    APP_SECRET=$(openssl rand -hex 32)
    sed -i '/^APP_SECRET=/d' .env.prod
    echo "APP_SECRET=$APP_SECRET" >> .env.prod
    set -a; . ./.env.prod; set +a
fi

# Seed Vault secrets requis au boot API (sans, l'API crash en startup)
docker exec -e VAULT_TOKEN=$VAULT_TOKEN $VAULT_CID vault kv put secret/platform/redis \
    HOST=redis PORT=6379 PASSWORD="$REDIS_PASSWORD" >/dev/null

docker exec -e VAULT_TOKEN=$VAULT_TOKEN $VAULT_CID vault kv put secret/platform/db \
    DATABASE_URL="postgresql://app_runtime:${POSTGRES_APP_RUNTIME_PASSWORD}@pgbouncer:5432/translog" >/dev/null

docker exec -e VAULT_TOKEN=$VAULT_TOKEN $VAULT_CID vault kv put secret/platform/app \
    APP_SECRET="$APP_SECRET" >/dev/null

docker exec -e VAULT_TOKEN=$VAULT_TOKEN $VAULT_CID vault kv put secret/platform/minio \
    ENDPOINT=minio PORT=9000 \
    ACCESS_KEY="$MINIO_ROOT_USER" SECRET_KEY="$MINIO_ROOT_PASSWORD" USE_SSL=false >/dev/null

ok "Vault AppRole + policy + 4 secrets boot seedés"

# ─── 8. Force restart API + Web pour pickup nouveau code ────────────────────
# Avec --resolve-image=never et un tag local fixe (translog_web:1.0.0 / translog_api:1.0.0),
# Swarm ne détecte aucun changement de spec lors d'un re-tag → la task continue à
# tourner sur l'ancien digest. Force update explicite pour remplacer la task.
header "[8/12] Restart API + Web"

docker service update --force ${STACK_NAME}_api >/dev/null
docker service update --force ${STACK_NAME}_web >/dev/null
sleep 30
ok "API + Web restart OK (pick up new image digest + Vault credentials)"

# ─── 9. Seed super-admin plateforme (optionnel, dépend de .env.prod) ────────
header "[9/12] Seed super-admin plateforme"

if [ -z "${PLATFORM_SUPERADMIN_PASSWORD:-}" ]; then
    warn "PLATFORM_SUPERADMIN_PASSWORD pas dans .env.prod — skip seed super-admin"
    warn "Pour seed plus tard, ajoute dans .env.prod :"
    echo "  PLATFORM_SUPERADMIN_EMAIL=\"toi@example.com\""
    echo "  PLATFORM_SUPERADMIN_NAME=\"Ton Nom\""
    echo "  PLATFORM_SUPERADMIN_PASSWORD=\"PassFort2026!\""
    echo "  Puis re-lance ce script (idempotent)."
else
    docker run --rm \
        --network translog_net \
        -e DATABASE_URL="$DBURL_ADMIN" \
        -e PLATFORM_SUPERADMIN_EMAIL="${PLATFORM_SUPERADMIN_EMAIL:-admin@example.com}" \
        -e PLATFORM_SUPERADMIN_NAME="${PLATFORM_SUPERADMIN_NAME:-Super Admin}" \
        -e PLATFORM_SUPERADMIN_PASSWORD="${PLATFORM_SUPERADMIN_PASSWORD}" \
        translog_api:1.0.0 \
        npx tsx prisma/seeds/platform-init.seed.ts || fail "Super-admin seed failed"
    ok "Super-admin plateforme créé/mis à jour"
fi

# ─── 10. CUTOVER : stop Easypanel-traefik, scale up Caddy ───────────────────
header "[10/12] CUTOVER (downtime ~30s sur gmp si Caddyfile change)"

# Stop Easypanel Traefik
if docker service ls --filter "name=easypanel-traefik" -q 2>/dev/null | grep -q .; then
    docker service scale easypanel-traefik=0 >/dev/null
    sleep 5
    ok "Easypanel Traefik scaled à 0 (libère 80/443)"
fi

# Smart reload Caddy : on ne scale 0/1 (= ~10s downtime apex) QUE si le
# Caddyfile a réellement changé depuis le dernier deploy. Sinon Caddy continue
# à servir avec sa config en mémoire (déjà rechargée à chaque reload Caddy
# qui détecte un fichier modifié — mais en pratique, le reload du bind mount
# nécessite le scale 0/1 pour pickup les modifs récentes). Le tag md5 est
# stocké dans /var/run/translog/caddyfile.md5 (volatile, recréé après reboot).
mkdir -p /var/run/translog
NEW_CADDY_MD5=$(md5sum ./caddy/Caddyfile 2>/dev/null | awk '{print $1}')
PREV_CADDY_MD5=$(cat /var/run/translog/caddyfile.md5 2>/dev/null || echo "")
if [ "$NEW_CADDY_MD5" != "$PREV_CADDY_MD5" ] || ! docker ps --filter "label=com.docker.swarm.service.name=${STACK_NAME}_caddy" -q | grep -q .; then
    # Caddy : scale=0/1 force remount du Caddyfile (bind mount peut être stale après rsync)
    warn "Caddyfile changé ou Caddy down → scale 0/1"
    docker service scale ${STACK_NAME}_caddy=0 >/dev/null 2>&1 || true
    sleep 3
    docker service scale ${STACK_NAME}_caddy=1 >/dev/null
    echo "$NEW_CADDY_MD5" > /var/run/translog/caddyfile.md5
else
    ok "Caddyfile identique (md5=${NEW_CADDY_MD5:0:8}…) — skip scale, Caddy continue à tourner"
fi

# Wait Caddy healthy avec retry sur scheduler bug
echo "Wait Caddy healthy (max 120s)..."
CADDY_START=$(date +%s)
SCHEDULER_RETRIES=0
while true; do
    cid=$(docker ps --filter "label=com.docker.swarm.service.name=${STACK_NAME}_caddy" -q | head -1)
    if [ -n "${cid:-}" ]; then
        status=$(docker inspect --format='{{.State.Health.Status}}' "$cid" 2>/dev/null || echo none)
        [ "$status" = healthy ] && break
    else
        # Scheduler bug : "no suitable node" → re-scale
        if [ "$SCHEDULER_RETRIES" -lt 3 ]; then
            sleep 10
            docker service scale ${STACK_NAME}_caddy=0 >/dev/null
            sleep 3
            docker service scale ${STACK_NAME}_caddy=1 >/dev/null
            SCHEDULER_RETRIES=$((SCHEDULER_RETRIES + 1))
            warn "Scheduler retry $SCHEDULER_RETRIES/3"
        fi
    fi
    elapsed=$(($(date +%s) - CADDY_START))
    if [ "$elapsed" -gt 120 ]; then
        warn "Caddy timeout — ROLLBACK : restart Easypanel Traefik"
        docker service scale ${STACK_NAME}_caddy=0 >/dev/null
        docker service scale easypanel-traefik=1 >/dev/null 2>&1 || true
        fail "Caddy never healthy — gmp restauré via Traefik"
    fi
    sleep 3
done
ok "Caddy up (TLS wildcard *.translog.dsyann.info acquis automatiquement)"

# ─── 11. Healthchecks externes ──────────────────────────────────────────────
header "[11/12] Healthchecks externes"

sleep 5

for d in translog.dsyann.info admin.translog.dsyann.info api.translog.dsyann.info app.dsyann.info api.dsyann.info panel.dsyann.info grafana.translog.dsyann.info; do
    code=$(curl -kI -o /dev/null -w "%{http_code}" -m 15 https://${d}/ 2>/dev/null || echo 000)
    if [ "$code" = "200" ] || [ "$code" = "404" ] || [ "$code" = "302" ]; then
        ok "https://${d}/ → HTTP $code"
    else
        warn "https://${d}/ → HTTP $code (à vérifier)"
    fi
done

# ─── 12. Post-deploy : UFW + cron backup ────────────────────────────────────
header "[12/12] Post-deploy hardening"

if command -v ufw >/dev/null; then
    ufw --force enable >/dev/null 2>&1 || true
    for port in 22 80 443 53; do
        ufw allow $port/tcp >/dev/null 2>&1 || true
    done
    ufw allow 443/udp >/dev/null 2>&1 || true   # HTTP/3
    ufw allow 53/udp  >/dev/null 2>&1 || true
    ok "UFW : 22/80/443/53 ouverts"
fi

CRON_LINE="0 2 * * * cd $(pwd) && ./scripts/backup.sh >> /var/log/translog-backup.log 2>&1"
crontab -l 2>/dev/null | grep -v 'translog-backup' | (cat; echo "$CRON_LINE") | crontab - 2>/dev/null && \
    ok "Cron backup quotidien 02:00 UTC"

echo ""
echo "════════════════════════════════════════════════════════════"
echo -e "${GREEN}🚀 DÉPLOIEMENT OK — ${STACK_NAME} stack en prod${NC}"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "Endpoints :"
echo "  https://translog.dsyann.info         — Landing publique SaaS"
echo "  https://admin.translog.dsyann.info   — Plateforme admin (login)"
echo "  https://api.translog.dsyann.info     — API publique cross-tenant"
echo "  https://<tenant>.translog.dsyann.info — Tenants (PortailVoyageur)"
echo "  https://app.dsyann.info              — gmp frontend (proxy Caddy)"
echo "  https://api.dsyann.info              — gmp backend (proxy Caddy)"
echo "  https://panel.dsyann.info            — Easypanel UI (proxy Caddy)"
echo "  https://grafana.translog.dsyann.info — Grafana (mdp dans .env.prod : GRAFANA_ADMIN_PASSWORD)"
echo ""
echo "Observabilité :"
echo "  docker stack ps $STACK_NAME       — Status tasks"
echo "  docker service ls                 — Tous les services"
echo "  docker service logs ${STACK_NAME}_api -f"
echo "  docker service logs ${STACK_NAME}_caddy -f"
echo ""
echo "Modifications :"
echo "  rsync infra/prod/ + .github/workflows/deploy.yml (CI/CD)"
echo "  ou re-lance ./scripts/04-deploy.sh manuellement (idempotent)"
echo ""
echo "Rollback : bash scripts/rollback.sh"
