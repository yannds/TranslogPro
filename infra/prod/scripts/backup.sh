#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════
# backup.sh — Backup quotidien DB + MinIO + Vault + Caddy certs.
#
# Chiffré AES-256-CBC avec passphrase depuis /root/.translog-backup-key.
# Rétention locale 7j, rétention distante (si rclone configuré) 30j.
# Lancé via cron à 02:00 UTC (configuré par 04-deploy.sh).
# ═════════════════════════════════════════════════════════════════════════════

set -euo pipefail
cd "$(dirname "$0")/.."

set -a; . ./.env.prod; set +a

BACKUP_DIR="/var/backups/translog"
STAMP=$(date +%Y%m%d-%H%M)
KEY_FILE="/root/.translog-backup-key"

mkdir -p "$BACKUP_DIR"

# Génère la passphrase de chiffrement si absente
if [ ! -f "$KEY_FILE" ]; then
    openssl rand -base64 48 > "$KEY_FILE"
    chmod 600 "$KEY_FILE"
    echo "⚠ Nouvelle clé de backup générée : $KEY_FILE"
    echo "⚠ SAUVEGARDE-LA (password manager) — sans elle les backups sont illisibles."
fi

encrypt() {
    openssl enc -aes-256-cbc -salt -pbkdf2 -pass "file:$KEY_FILE"
}

# ─── 1. Postgres dump ───────────────────────────────────────────────────────
echo "→ Dump Postgres..."
docker exec translog_postgres pg_dump -U app_admin -F c -Z 9 translog | encrypt > "$BACKUP_DIR/db-${STAMP}.pgdump.enc"
echo "  ✔ $(du -h $BACKUP_DIR/db-${STAMP}.pgdump.enc | cut -f1)"

# ─── 2. MinIO mirror (tar compressé + chiffré) ──────────────────────────────
echo "→ Dump MinIO..."
docker run --rm \
    --volumes-from translog_minio \
    -v "$BACKUP_DIR:/backup" \
    busybox tar -czf - -C /data . | encrypt > "$BACKUP_DIR/minio-${STAMP}.tar.gz.enc"
echo "  ✔ $(du -h $BACKUP_DIR/minio-${STAMP}.tar.gz.enc | cut -f1)"

# ─── 3. Vault raft snapshot ─────────────────────────────────────────────────
if [ -n "${VAULT_TOKEN:-}" ] && [ "${VAULT_TOKEN}" != "REPLACE_AFTER_VAULT_INIT" ]; then
    echo "→ Snapshot Vault..."
    docker exec -e VAULT_TOKEN="${VAULT_TOKEN}" translog_vault \
        vault operator raft snapshot save /tmp/vault-snapshot.bin
    docker cp translog_vault:/tmp/vault-snapshot.bin /tmp/vault-snapshot.bin
    encrypt < /tmp/vault-snapshot.bin > "$BACKUP_DIR/vault-${STAMP}.snap.enc"
    rm -f /tmp/vault-snapshot.bin
    echo "  ✔ $(du -h $BACKUP_DIR/vault-${STAMP}.snap.enc | cut -f1)"
fi

# ─── 4. Caddy data (certs Let's Encrypt — critique) ─────────────────────────
echo "→ Backup Caddy certs..."
docker run --rm \
    --volumes-from translog_caddy \
    -v "$BACKUP_DIR:/backup" \
    busybox tar -czf - -C /data . | encrypt > "$BACKUP_DIR/caddy-${STAMP}.tar.gz.enc"
echo "  ✔ $(du -h $BACKUP_DIR/caddy-${STAMP}.tar.gz.enc | cut -f1)"

# ─── 5. Rétention locale 7j ─────────────────────────────────────────────────
find "$BACKUP_DIR" -type f -name '*.enc' -mtime +7 -delete
echo "→ Nettoyage (>7 jours)"

# ─── 6. Upload distant (si rclone configuré) ────────────────────────────────
if command -v rclone >/dev/null && rclone listremotes | grep -q "^remote:"; then
    rclone copy "$BACKUP_DIR" remote:translog-backups/ --filter "+ *${STAMP}*" --filter "- *" 2>&1 || true
    echo "→ Upload distant OK"
else
    echo "→ rclone absent — backup local uniquement. Configure rclone pour offsite."
fi

echo ""
echo "✔ Backup ${STAMP} terminé. Restore : scripts/restore.sh <STAMP>"
