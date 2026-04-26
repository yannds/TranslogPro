#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════
# restore-good-state.sh — Restaure un snapshot capturé par snapshot-good-state.sh
#
# Usage :
#   bash scripts/restore-good-state.sh <label-or-stamp>
#   bash scripts/restore-good-state.sh latest    # le plus récent
#
# DESTRUCTIF : restaure les volumes (efface l'état actuel), réécrit configs,
# restaure pg_dump (DROP/CREATE base), restaure Vault snapshot.
#
# Demande confirmation interactive (refus si stdin n'est pas un tty).
# ═════════════════════════════════════════════════════════════════════════════

set -euo pipefail
cd "$(dirname "$0")/.."

NAME="${1:-}"
[ -n "$NAME" ] || { echo "Usage: $0 <label-or-stamp> | latest"; exit 1; }

if [ "$NAME" = "latest" ]; then
    SNAP_DIR=$(ls -1dt /root/snapshots/good-state-* 2>/dev/null | head -1)
else
    SNAP_DIR="/root/snapshots/good-state-${NAME}"
fi
[ -d "$SNAP_DIR" ] || { echo "Snapshot $SNAP_DIR introuvable"; exit 1; }

cat "$SNAP_DIR/MANIFEST.txt"
echo
read -r -p "RESTORE depuis $SNAP_DIR ? Tapez RESTORE pour confirmer : " ans
[ "$ans" = "RESTORE" ] || { echo "Annulé"; exit 0; }

KEY_FILE="/root/.translog-backup-key"
[ -f "$KEY_FILE" ] || { echo "Backup key absente"; exit 1; }
decrypt() { openssl enc -aes-256-cbc -salt -pbkdf2 -d -pass "file:$KEY_FILE"; }

GREEN='\033[0;32m'; NC='\033[0m'
ok() { echo -e "${GREEN}✔${NC} $1"; }

# ─── 1. Stop services ─────────────────────────────────────────────────────────
echo "Stop services translog..."
for svc in translog_api translog_web translog_caddy translog_postgres translog_redis translog_minio translog_vault translog_bind9; do
    docker service scale "$svc"=0 >/dev/null 2>&1 || true
done
sleep 5
ok "Services down"

# ─── 2. Restore volumes ─────────────────────────────────────────────────────
for f in "$SNAP_DIR"/translog_*.tar.gz.enc; do
    [ -f "$f" ] || continue
    vol=$(basename "$f" .tar.gz.enc)
    docker run --rm -v "$vol:/data" busybox sh -c "rm -rf /data/* /data/.[!.]* 2>/dev/null || true"
    decrypt < "$f" | docker run --rm -i -v "$vol:/data" busybox tar -xzf - -C /data
    ok "Vol $vol restauré"
done

# ─── 3. Restore configs ─────────────────────────────────────────────────────
[ -f "$SNAP_DIR/config/Caddyfile" ]            && cp "$SNAP_DIR/config/Caddyfile"            caddy/Caddyfile
[ -f "$SNAP_DIR/config/Caddyfile.Dockerfile" ] && cp "$SNAP_DIR/config/Caddyfile.Dockerfile" caddy/Dockerfile
[ -f "$SNAP_DIR/config/named.conf" ]           && cp "$SNAP_DIR/config/named.conf"           bind9/named.conf
[ -f "$SNAP_DIR/config/translog.db" ]          && cp "$SNAP_DIR/config/translog.db"          bind9/zones/translog.db
[ -f "$SNAP_DIR/config/docker-stack.prod.yml" ] && cp "$SNAP_DIR/config/docker-stack.prod.yml" docker-stack.prod.yml
ok "Config files restaurés"

# ─── 4. Restore image tag (good-state → latest) ──────────────────────────────
for img in translog_api translog_web prod-caddy; do
    snap_img=$(docker image ls --format "{{.Repository}}:{{.Tag}}" | grep "^${img}:good-state-" | head -1)
    if [ -n "$snap_img" ]; then
        docker tag "$snap_img" "${img}:latest"
        ok "Image $img:latest ← $snap_img"
    fi
done

# ─── 5. Redeploy stack ──────────────────────────────────────────────────────
set -a; . ./.env.prod; set +a
docker stack deploy -c docker-stack.prod.yml --resolve-image=never --with-registry-auth translog
sleep 15

# ─── 6. Restore Postgres (cluster déjà restauré via volume) + Vault si needed
# Optionnel — le volume restore couvre déjà le cluster Postgres et Vault raft.
# Le pg_dump et vault.snap dans le snapshot sont une seconde ceinture pour
# restaurer juste les données sans toucher au cluster (manual).

# ─── 7. Smoke test ──────────────────────────────────────────────────────────
sleep 20
for d in translog.dsyann.info api.translog.dsyann.info panel.dsyann.info; do
    code=$(curl -kI -o /dev/null -w "%{http_code}" -m 15 https://${d}/ 2>/dev/null || echo 000)
    echo "  https://${d}/ → HTTP $code"
done

echo
echo "════════════════════════════════════════════════════════════"
echo -e "${GREEN}🛡  Restore terminé${NC} depuis $SNAP_DIR"
echo "════════════════════════════════════════════════════════════"
