# MANUEL_OPS — TransLog Pro

Manuel opérationnel **production**. Tout ce qu'il faut pour installer, debugger, modifier, rollback et restaurer la stack.

---

## 0. Vue d'ensemble

```
                                    INTERNET
                                       │
                                  ┌────▼────┐
                                  │  LWS DNS  │  (zone dsyann.info)
                                  └────┬─────┘
                                       │ délégation NS pour translog.dsyann.info
                                       │
                                  ┌────▼────────────────────┐
                                  │   VPS 72.61.108.160      │  Hostinger KVM 8GB
                                  │                          │
                                  │  ┌────────────────────┐ │
                                  │  │ Caddy (Docker)     │ │  80, 443, 443/udp
                                  │  │ - DNS-01 wildcard  │ │  reverse proxy unique
                                  │  │ - HTTP-01 gmp/etc  │ │
                                  │  └─────┬──────────────┘ │
                                  │        │                │
                                  │  ┌─────┴─────┬──────────┤
                                  │  │           │          │
                                  │  │ TransLog  │  GMP     │
                                  │  │ stack     │  stack   │
                                  │  │ (Swarm)   │  (Easy.) │
                                  │  └───────────┴──────────┘
                                  │                          │
                                  │  ┌──────────────────┐   │
                                  │  │ BIND9 (53/udp+tcp)│   │  authoritative
                                  │  │ → translog.dsyann │   │  *.translog.* records
                                  │  └──────────────────┘   │
                                  └──────────────────────────┘
```

**Stack TransLog (Swarm)** : Caddy · BIND9 · PostgreSQL+PostGIS · PgBouncer · Redis · MinIO · Vault · API NestJS · Web Vite/nginx

**Stack gmp (Easypanel)** : préexistant, on coexiste sans toucher (proxied via Caddy après cutover).

---

## 1. Install from scratch (VPS vierge)

> Pré-requis : Ubuntu 24.04, Docker + Docker Compose, accès root, Easypanel installé (mais **OK** sans).

### 1.1 — Préparer le VPS

```bash
# 1. Cloner le repo
git clone https://github.com/<owner>/TranslogPro.git /opt/TranslogPro
cd /opt/TranslogPro/infra/prod

# 2. Pré-flight (vérifie kernel, RAM, ports, firewall)
bash scripts/01-preflight.sh

# 3. Générer .env.prod (secrets aléatoires)
bash scripts/02-gen-secrets.sh

# 4. Importer les certs Easypanel existants (pour gmp coexistence)
bash scripts/03-import-certs.sh
```

### 1.2 — Configurer DNS (chez ton registrar)

Pour `*.translog.dsyann.info` (NS delegation) :
| Type | Host | Valeur |
|---|---|---|
| NS | `translog.dsyann.info.` | `ns1.translog.dsyann.info.` |
| NS | `translog.dsyann.info.` | `ns2.translog.dsyann.info.` |
| A | `ns1.translog.dsyann.info.` | `72.61.108.160` |
| A | `ns2.translog.dsyann.info.` | `72.61.108.160` |

### 1.3 — Configurer le super-admin (optionnel, peut se faire après)

Édite `infra/prod/.env.prod` :
```
PLATFORM_SUPERADMIN_EMAIL="toi@exemple.com"
PLATFORM_SUPERADMIN_NAME="Ton Nom"
PLATFORM_SUPERADMIN_PASSWORD="MotDePasseFort2026!"
```

### 1.4 — Lancer le déploiement

```bash
bash scripts/04-deploy.sh
```

Le script s'arrête à l'**étape 7** si Vault n'est pas initialisé. Suis les instructions :

```bash
# Init (1 fois)
docker exec -it translog_vault.1.<id> vault operator init
# → Conserve les 5 unseal keys + root token (coffre-fort impératif)

# Édite .env.prod
sed -i 's/^VAULT_TOKEN=.*/VAULT_TOKEN=hvs.<root_token>/' .env.prod

# Unseal (3 keys, à chaque restart Vault)
docker exec -it translog_vault.1.<id> vault operator unseal <key1>
docker exec -it translog_vault.1.<id> vault operator unseal <key2>
docker exec -it translog_vault.1.<id> vault operator unseal <key3>

# Re-lance le script (idempotent — reprend où ça s'est arrêté)
bash scripts/04-deploy.sh
```

À la fin, tu as :
- `https://translog.dsyann.info` — landing publique
- `https://admin.translog.dsyann.info` — admin plateforme (login)
- `https://api.translog.dsyann.info` — API publique
- `https://<tenant>.translog.dsyann.info` — portails tenant

---

## 2. Architecture interne

### 2.1 — Réseaux Docker

| Network | Driver | Purpose |
|---|---|---|
| `translog_net` | overlay (attachable) | TransLog stack interne |
| `easypanel-gmp` | overlay external | Caddy → gmp_* |
| `easypanel` | overlay external | Caddy → easypanel UI |

### 2.2 — Volumes critiques (à backup)

| Volume | Contenu | Backup ? |
|---|---|---|
| `translog_postgres_data` | Toutes les données | **OUI quotidien** |
| `translog_minio_data` | Documents tenant (signatures, PDF) | **OUI quotidien** |
| `translog_vault_data` | Secrets chiffrés (raft) | **OUI** + unseal keys offline |
| `translog_caddy_data` | Certs Let's Encrypt | OUI (sinon re-acquire) |
| `translog_redis_data` | Sessions + cache (régénérables) | NON nécessaire |
| `translog_bind9_cache` | Cache DNS local | NON |

### 2.3 — Secrets dans Vault (KV-v2 path `secret/`)

| Path | Champs | Critique au boot ? |
|---|---|---|
| `platform/redis` | HOST, PORT, PASSWORD | **OUI** (eventbus) |
| `platform/db` | DATABASE_URL | **OUI** (Prisma onModuleInit) |
| `platform/app` | APP_SECRET | **OUI** (better-auth) |
| `platform/minio` | ENDPOINT, PORT, ACCESS_KEY, SECRET_KEY, USE_SSL | **OUI** (MinioService) |
| `platform/captcha/turnstile` | SECRET_KEY | Optionnel (CAPTCHA) |
| `platform/email/smtp` | HOST, PORT, USER, PASS, FROM_EMAIL | Optionnel (envoi mail) |
| `platform/payments/*` | Tokens providers (Paystack, MTN, etc.) | Optionnel |
| `tenants/<id>/hmac` | KEY (tickets QR) | Auto-créé au signup |

---

## 3. Debug par couche

### 3.1 — DNS

```bash
# Apex
dig +short translog.dsyann.info @72.61.108.160     # depuis VPS (notre BIND9)
dig +short translog.dsyann.info @8.8.8.8           # public Google → propagation OK ?

# Tenant
dig +short xyz.translog.dsyann.info @72.61.108.160 # doit retourner 72.61.108.160

# Trace complète (qui répond pour cette zone ?)
dig +trace translog.dsyann.info

# Si timeout → bind9 down ou UFW bloque 53/udp
docker service logs translog_bind9 --since 5m | tail -20
ufw status | grep 53
```

**Erreur courante : journal `.jnl` qui empêche reload du file**
```bash
docker service scale translog_bind9=0
sleep 3
rm -f /opt/TranslogPro/infra/prod/bind9/zones/translog.db.jnl
docker service scale translog_bind9=1
```

### 3.2 — TLS / Caddy

```bash
# Domaines + certs en mémoire
CADDY_CID=$(docker ps --filter "label=com.docker.swarm.service.name=translog_caddy" -q | head -1)
docker exec $CADDY_CID caddy adapt --config /etc/caddy/Caddyfile 2>&1 | grep -oE '"[a-z*.-]+\.dsyann\.info"' | sort -u

# Logs cert acquisition
docker exec $CADDY_CID tail -100 /var/log/caddy/caddy.log | grep -iE "certificate obtained|error"

# Reload sans restart
docker exec $CADDY_CID caddy reload --config /etc/caddy/Caddyfile
```

**Erreur courante : bind mount stale après rsync**
```bash
docker service scale translog_caddy=0
sleep 3
docker service scale translog_caddy=1
```

**Erreur courante : `endpoint not found` (Compose+Swarm mix)** — si tu vois ça, c'est qu'on a des containers stand-alone sur overlay : convertir tout en Swarm.

### 3.3 — API NestJS

```bash
# Logs récents
docker service logs translog_api --since 10m | tail -50

# Logs erreurs
docker service logs translog_api --since 1h 2>&1 | grep -iE "error|fail|denied" | tail -20

# Container actuel
API_CID=$(docker ps --filter "label=com.docker.swarm.service.name=translog_api" -q | head -1)
docker logs $API_CID --tail 50

# Health
curl -k https://api.translog.dsyann.info/health/live
```

**Erreurs courantes :**
- `permission denied` Vault → policy translog-api ; refresh AppRole : restart api
- `Authentication failed` Postgres → `app_runtime` mal créé : étape 5 du deploy
- `EMAIL_PROVIDER=console interdit` → `EMAIL_PROVIDER=smtp` dans .env.prod
- `Cannot find module dist/main.js` → Dockerfile CMD : `dist/src/main.js`

### 3.4 — Postgres

```bash
ADMIN_PWD=$(grep '^POSTGRES_APP_ADMIN_PASSWORD=' /opt/TranslogPro/infra/prod/.env.prod | cut -d= -f2)

# Connexion psql admin
docker run --rm -it --network translog_net -e PGPASSWORD="$ADMIN_PWD" \
    postgres:16-alpine psql -h postgres -U app_admin -d translog

# Lister les rôles
\du

# Tester le rôle runtime via pgbouncer
RUNTIME_PWD=$(grep '^POSTGRES_APP_RUNTIME_PASSWORD=' /opt/TranslogPro/infra/prod/.env.prod | cut -d= -f2)
docker run --rm --network translog_net -e PGPASSWORD="$RUNTIME_PWD" \
    postgres:16-alpine psql -h pgbouncer -U app_runtime -d translog -c "SELECT current_user"

# Compter les tenants / users
docker run --rm --network translog_net -e PGPASSWORD="$ADMIN_PWD" \
    postgres:16-alpine psql -h postgres -U app_admin -d translog -c \
    "SELECT 'tenants' AS t, COUNT(*) FROM tenants UNION SELECT 'users', COUNT(*) FROM users;"
```

### 3.5 — Vault

```bash
TOKEN=$(grep '^VAULT_TOKEN=' /opt/TranslogPro/infra/prod/.env.prod | cut -d= -f2)
VAULT_CID=$(docker ps --filter "label=com.docker.swarm.service.name=translog_vault" -q | head -1)

# Status
docker exec $VAULT_CID vault status

# Si scellé après restart → unseal
docker exec -it $VAULT_CID vault operator unseal <key1>  # 3 fois

# Lister les secrets
docker exec -e VAULT_TOKEN=$TOKEN $VAULT_CID vault kv list secret/platform/

# Lire un secret
docker exec -e VAULT_TOKEN=$TOKEN $VAULT_CID vault kv get secret/platform/redis

# Re-stocker (kv-v2 = clé/valeurs multiples)
docker exec -e VAULT_TOKEN=$TOKEN $VAULT_CID vault kv put secret/platform/redis \
    HOST=redis PORT=6379 PASSWORD=newpassword

# Policy actuelle
docker exec -e VAULT_TOKEN=$TOKEN $VAULT_CID vault policy read translog-api

# Test AppRole login
ROLE_ID=$(grep '^VAULT_ROLE_ID=' /opt/TranslogPro/infra/prod/.env.prod | cut -d= -f2)
SECRET_ID=$(grep '^VAULT_SECRET_ID=' /opt/TranslogPro/infra/prod/.env.prod | cut -d= -f2)
docker exec $VAULT_CID vault write auth/approle/login role_id=$ROLE_ID secret_id=$SECRET_ID
```

### 3.6 — Web (frontend nginx)

```bash
# wget /health depuis le container (doit retourner 200 OK)
WEB_CID=$(docker ps --filter "label=com.docker.swarm.service.name=translog_web" -q | head -1)
docker exec $WEB_CID wget -qO- http://127.0.0.1/health

# Vérifier la config Vite baked
docker run --rm --entrypoint sh translog_web:1.0.0 -c '
grep -ro "translog\.dsyann\.info" /usr/share/nginx/html/assets/*.js | wc -l
'
# Doit retourner ≥ 2 (hits dans index + PublicSignup)
```

---

## 4. Modifications courantes

### 4.1 — Changer un secret dans Vault

```bash
TOKEN=$(grep '^VAULT_TOKEN=' .env.prod | cut -d= -f2)
VAULT_CID=$(docker ps --filter "label=com.docker.swarm.service.name=translog_vault" -q | head -1)

# Mettre à jour
docker exec -e VAULT_TOKEN=$TOKEN $VAULT_CID vault kv put secret/platform/email/smtp \
    HOST=smtp.gmail.com PORT=587 USER=ton@gmail.com PASS='app_pwd' \
    SECURE=false FROM_EMAIL=noreply@translog.dsyann.info FROM_NAME='TransLog Pro'

# Restart api pour invalider le cache (cache TTL 5 min sinon)
docker service update --force translog_api
```

### 4.2 — Ajouter un nouveau domaine (ex: support.translog.dsyann.info)

`*.translog.dsyann.info` est déjà dans le wildcard cert, **rien à faire côté DNS**. Juste éditer Caddyfile :

```caddyfile
*.translog.dsyann.info {
    @support host support.translog.dsyann.info
    handle @support {
        reverse_proxy support_service:8080
    }
    # ... reste inchangé
}
```

```bash
rsync -avz infra/prod/caddy/Caddyfile root@72.61.108.160:/opt/TranslogPro/infra/prod/caddy/
ssh root@72.61.108.160 "docker service scale translog_caddy=0; sleep 3; docker service scale translog_caddy=1"
```

### 4.3 — Changer le password super-admin plateforme

```bash
docker run --rm \
    --network translog_net \
    -e DATABASE_URL="postgresql://app_admin:${POSTGRES_APP_ADMIN_PASSWORD}@postgres:5432/translog" \
    -e PLATFORM_SUPERADMIN_EMAIL="toi@exemple.com" \
    -e PLATFORM_SUPERADMIN_NAME="Ton Nom" \
    -e PLATFORM_SUPERADMIN_PASSWORD="NouveauPass2026!" \
    translog_api:1.0.0 \
    npx tsx prisma/seeds/platform-init.seed.ts
```

### 4.4 — Forcer le change-password pour un utilisateur

```bash
docker run --rm --network translog_net -e PGPASSWORD="$POSTGRES_APP_ADMIN_PASSWORD" \
    postgres:16-alpine psql -h postgres -U app_admin -d translog -c \
    "UPDATE users SET \"mustChangePassword\"=true WHERE email='user@x.com';"
```

### 4.5 — Mettre à jour le code (release)

```bash
# Sur le Mac
git pull origin main
rsync -avz --exclude='.env.prod' --exclude='node_modules' \
    /Users/dsyann/TranslogPro/ root@72.61.108.160:/opt/TranslogPro/

# Sur le VPS
cd /opt/TranslogPro/infra/prod
bash scripts/04-deploy.sh
```

Ou via GitHub Actions CI/CD : push tag `v1.x` → déploie automatiquement.

---

## 5. Rollback

### 5.1 — Cutover raté (Caddy ne démarre pas)

```bash
docker service scale translog_caddy=0
docker service scale easypanel-traefik=1
sleep 5
curl -kI https://app.dsyann.info     # gmp restauré
```

### 5.2 — Bug applicatif (régression API)

```bash
# Liste des images disponibles
docker images | grep translog_api

# Rollback à l'image précédente (tag par version, ex: 1.0.0 → 0.9.0)
docker service update --image translog_api:0.9.0 translog_api
```

### 5.3 — Tear down complet (urgence)

```bash
docker stack rm translog
docker service scale easypanel-traefik=1   # gmp reprend
# Puis bash scripts/04-deploy.sh quand prêt à redeploy
```

---

## 6. Backup & restore

### 6.1 — Backup manuel (sera automatisé via cron 02:00)

```bash
TS=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR=/var/backups/translog/$TS
mkdir -p $BACKUP_DIR

# Postgres
docker run --rm --network translog_net -e PGPASSWORD="$POSTGRES_APP_ADMIN_PASSWORD" \
    -v $BACKUP_DIR:/backup \
    postgres:16-alpine pg_dump -h postgres -U app_admin -d translog -Fc -f /backup/translog.dump

# MinIO (mc en interne)
docker exec $(docker ps --filter "label=com.docker.swarm.service.name=translog_minio" -q | head -1) \
    mc mirror /data /backup/minio  # à adapter avec mc alias

# Vault snapshot (raft backend)
docker exec -e VAULT_TOKEN=$VAULT_TOKEN $VAULT_CID \
    vault operator raft snapshot save /tmp/vault.snap
docker cp $VAULT_CID:/tmp/vault.snap $BACKUP_DIR/vault.snap

# Caddy data (certs)
docker run --rm -v translog_caddy_data:/data -v $BACKUP_DIR:/backup alpine \
    tar czf /backup/caddy_data.tar.gz -C /data .

echo "Backup OK : $BACKUP_DIR"
```

### 6.2 — Restore Postgres

```bash
docker run --rm --network translog_net -e PGPASSWORD="$POSTGRES_APP_ADMIN_PASSWORD" \
    -v $BACKUP_DIR:/backup \
    postgres:16-alpine pg_restore -h postgres -U app_admin -d translog \
        --clean --if-exists /backup/translog.dump
```

### 6.3 — Restore Vault snapshot

```bash
docker cp $BACKUP_DIR/vault.snap $VAULT_CID:/tmp/vault.snap
docker exec -e VAULT_TOKEN=$VAULT_TOKEN $VAULT_CID \
    vault operator raft snapshot restore /tmp/vault.snap
```

---

## 7. Cheat sheet

```bash
# Status complet
docker stack ps translog
docker service ls

# Logs en live
docker service logs translog_api -f
docker service logs translog_caddy -f

# Restart un service (pickup nouvelle image ou env)
docker service update --force translog_api

# Force remount bind mount (Caddyfile, BIND9 zones)
docker service scale translog_caddy=0; sleep 3; docker service scale translog_caddy=1

# Vault unseal (à chaque restart Vault)
docker exec -it $(docker ps -q -f label=com.docker.swarm.service.name=translog_vault) \
    vault operator unseal

# Rebuild + redeploy complet
cd /opt/TranslogPro/infra/prod && bash scripts/04-deploy.sh

# Rollback urgence
bash scripts/rollback.sh
```

---

## 8. Sécurité — checklist trimestrielle

- [ ] Rotate APP_SECRET (Vault `secret/platform/app`) + restart api
- [ ] Rotate Vault unseal keys (`vault operator rekey`)
- [ ] Rotate Vault root token (`vault token revoke <ancien>`)
- [ ] Rotate Postgres app_runtime + app_admin passwords
- [ ] Rotate MinIO ROOT_USER + ROOT_PASSWORD
- [ ] Rotate TSIG_SECRET (BIND9 dynamic updates)
- [ ] Vérifier CA Let's Encrypt renewal (Caddy auto, mais log alert)
- [ ] `npm audit fix --force` backend + frontend
- [ ] Backup vault snapshot offline (USB / coffre)
- [ ] Test restore sur VPS staging

---

## 9. Quand ça plante

1. **Lis les logs** : `docker service logs translog_<service> --since 10m | tail -50`
2. **Status** : `docker stack ps translog --no-trunc`
3. **Healthchecks** : `docker inspect <container> --format='{{.State.Health}}'`
4. **Rollback** : `bash scripts/rollback.sh` (gmp restauré, infra TransLog stoppée)
5. **Re-deploy** : `bash scripts/04-deploy.sh` (idempotent, reprend où ça s'est arrêté)

Si bloqué : ce manuel + relire la conversation Claude qui a buildé l'infra le 2026-04-25.
