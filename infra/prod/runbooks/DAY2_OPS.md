# Runbook — Opérations quotidiennes (Day 2 Ops)

## 1. Backups — vérification hebdomadaire

### Test de restauration (à faire 1× par mois)

```bash
# Liste les backups
ls -lh /var/backups/translog/

# Test : décrypte + restore sur une DB jetable
docker run --rm -it --network translog_net \
    -v /var/backups/translog:/backup:ro \
    -v /root/.translog-backup-key:/key:ro \
    postgres:16-alpine \
    sh -c 'openssl enc -d -aes-256-cbc -pbkdf2 -pass file:/key -in /backup/db-YYYYMMDD-HHMM.pgdump.enc | pg_restore -h translog_postgres -U app_admin -d postgres --create --no-owner'
```

### Rétention

- Local : 7 jours (automatique)
- Remote (rclone → Hostinger Storage Box, ou S3) : 30 jours
- Config rclone :
  ```bash
  rclone config   # → new remote : Hostinger Storage Box SFTP
  ```

## 2. Rotation des secrets

### Tous les 6 mois

- **TSIG_SECRET (BIND9 ↔ Caddy)** :
  ```bash
  NEW_SECRET=$(openssl rand -base64 32 | tr -d '\n')
  sed -i "s|TSIG_SECRET=.*|TSIG_SECRET=${NEW_SECRET}|" infra/prod/.env.prod
  sed -i "s|secret \".*\"|secret \"${NEW_SECRET}\"|" infra/prod/bind9/zones/tsig.key
  docker compose -f infra/prod/docker-compose.prod.yml restart bind9 caddy
  ```

- **Postgres passwords** (plus délicat) : créer nouveaux passwords, mettre à jour `.env.prod`, restart tous les services qui consomment pgbouncer.

### Tous les 3 mois

- **VAULT_TOKEN root** : `vault token revoke` ancien + `vault token create -policy=root` nouveau, update `.env.prod`, restart `api`.

- **`PLATFORM_BOOTSTRAP_KEY`** : ne change que si compromis (sinon usage unique bootstrap initial).

## 3. Monitoring (sans Grafana dédié pour MVP)

### Healthchecks docker intégrés

```bash
docker ps --format "table {{.Names}}\t{{.Status}}" | grep translog_
# Tous doivent être "healthy" (sauf vault = "unhealthy" tant que scellé — normal)
```

### Logs applicatifs

```bash
docker compose -f infra/prod/docker-compose.prod.yml logs -f api | grep -i error
docker compose -f infra/prod/docker-compose.prod.yml logs -f caddy | grep -i error
```

### Espace disque

```bash
df -h / /var/lib/docker
# Alerte si > 80%
```

### Certs Let's Encrypt — expiration

```bash
# Liste les certs stockés par Caddy (via admin API)
curl -s http://127.0.0.1:2019/config/apps/tls/certificates | jq .

# Vérif externe d'un sous-domaine tenant
openssl s_client -servername acme.translog.dsyann.info -connect acme.translog.dsyann.info:443 </dev/null 2>/dev/null \
    | openssl x509 -noout -dates
```

## 4. Ajout d'un nouveau tenant (runtime, sans redémarrage)

### Via UI admin (recommandé)

1. Login `https://translog-admin.dsyann.info` avec platform-admin
2. Section Platform → Tenants → New
3. Slug = sous-domaine (ex: `acme-corp`)
4. Le tenant devient accessible sur `https://acme-corp.translog.dsyann.info`
5. Premier hit → Caddy émet le cert via DNS-01 (~5s)

### Via API (scripting)

```bash
curl -X POST https://translog-api.dsyann.info/api/platform/tenants \
    -H "Authorization: Bearer <platform-admin-token>" \
    -d '{"slug": "acme-corp", "name": "Acme Corp", ...}'
```

## 5. Hardening continu

### Unattended-upgrades

```bash
apt install -y unattended-upgrades
dpkg-reconfigure --priority=low unattended-upgrades
```

### Fail2ban

```bash
apt install -y fail2ban
cat > /etc/fail2ban/jail.local <<EOF
[sshd]
enabled = true
maxretry = 3
bantime = 1h

[caddy-bad-auth]
enabled = true
port = http,https
filter = caddy-bad-auth
logpath = /var/lib/docker/volumes/translog_caddy_logs/_data/caddy.log
EOF

# Filtre custom pour repérer les 401/403 spam sur Caddy
cat > /etc/fail2ban/filter.d/caddy-bad-auth.conf <<EOF
[Definition]
failregex = "remote_ip":"<HOST>".*"status":(401|403)
ignoreregex =
EOF

systemctl enable --now fail2ban
```

### Audit sécurité trimestriel

```bash
# npm audit côté backend
cd /opt/TranslogPro && npm audit --production

# Scan secrets éventuellement commités
gitleaks detect --source . --verbose

# Scan CVE images Docker
docker scout cves translog_api:latest
```

## 6. Scaling / dimensionnement

### Si > 50 tenants actifs

- **RAM** : pass ≥ 16 Go (commence à 8 Go, monitore `docker stats`)
- **CPU** : 4 vCPU recommandés
- **Postgres** : migrer vers DB managée (Neon, Supabase, Hetzner Cloud Postgres)
- **MinIO** : clustérisé 4 nodes ou remplacé par S3 externe (Hetzner Object Storage, Scaleway)
- **Caddy** : OK mono-instance jusqu'à 10k req/s

### Horizontal scaling (v1.1+)

- Deploy en Docker Swarm mode avec `docker stack deploy`
- 3 nodes minimum pour le raft quorum Vault
- Load balancer externe (HAProxy) devant plusieurs Caddy

## 7. Incident response

### Les certs wildcard expirent et pas de renouvellement

```bash
# Vérifie que BIND9 répond
dig @127.0.0.1 translog-admin.translog.dsyann.info
dig @127.0.0.1 translog-admin.translog.dsyann.info +norec NS

# Vérifie propagation externe
dig @1.1.1.1 NS translog.dsyann.info

# Force renewal Caddy
docker exec translog_caddy caddy reload --config /etc/caddy/Caddyfile
```

### La DB est corrompue

```bash
# Snapshot immédiat
./scripts/backup.sh

# Restore depuis backup J-1
./scripts/restore.sh $(ls /var/backups/translog/db-*.pgdump.enc | tail -2 | head -1)
```

### Vault scellé après reboot VPS

Normal — 3 unseal keys requis manuellement (ou configurer auto-unseal plus tard) :

```bash
docker exec -it translog_vault vault operator unseal <KEY_1>
docker exec -it translog_vault vault operator unseal <KEY_2>
docker exec -it translog_vault vault operator unseal <KEY_3>
```

## 8. Metrics à surveiller (quand tu ajouteras Grafana plus tard)

- Postgres : connexions actives, locks, slow queries (>1s)
- Redis : memory used, keyspace misses
- MinIO : bucket size per tenant, request latency
- Caddy : TLS handshake duration, 4xx/5xx rate, cert expiration
- API : request latency p95/p99, error rate par endpoint, session count
- VPS : CPU, RAM, disk IO, disk free
