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
- [ ] `apt-mark showhold` revue trimestrielle (notamment docker-ce, kernel) puis upgrade en fenêtre maintenance

### 8.1 — Hardening appliqué (audit 2026-04-25)

| ID | Action | Vérif |
|---|---|---|
| CRIT-1 | Port 3000 (Easypanel HTTP brut) bloqué via `iptables DOCKER-USER` (panel.dsyann.info HTTPS continue de marcher via Caddy) | `curl --connect-timeout 4 http://72.61.108.160:3000/` doit timeout ; `curl https://panel.dsyann.info/` doit 200 |
| CRIT-2 | `fail2ban` installé (jail SSH 3 essais / 600s / ban 1h) + `PermitRootLogin prohibit-password` + `X11Forwarding no` | `fail2ban-client status sshd` ; `grep -E "^(PermitRootLogin\|X11)" /etc/ssh/sshd_config` |
| HIGH-3 | Vault audit device file activé : `/vault/logs/audit.log` (HMAC-SHA256 sur tokens et secrets) | `vault audit list` non-vide |
| MED-8 | Permissions BIND9 zones : `750/640/600` au lieu de `777` | `ls -la /opt/TranslogPro/infra/prod/bind9/zones/` |
| MED-11 | Paquets non-Docker / non-kernel mis à jour (63 → 9 pendants, holds explicites) | `apt list --upgradable` < 15 |

### 8.2 — Pièges connus

⚠️ **`apt install iptables-persistent` désinstalle UFW automatiquement** (conflit Debian).
Sur Ubuntu 24.04, UFW pose un default INPUT=DROP via ses chains custom. Quand UFW est
désinstallé, ses chains disparaissent mais le default DROP reste, **et tout le trafic
entrant est bloqué** → SSH timeout → VPS isolé.

Recovery via console KVM Hostinger (`iptables -P INPUT ACCEPT && iptables -F INPUT &&
iptables -A INPUT ... && netfilter-persistent save`).

À l'avenir : préférer la console KVM pour modifier iptables, garder une session SSH
"filet" ouverte, ou utiliser `ufw allow/deny` au lieu d'iptables direct.

### 8.3 — Hardening Vague 2 appliqué (audit 2026-04-25)

| ID | Action | Vérif |
|---|---|---|
| MED-9 | Vault AppRole `secret_id_ttl=720h`, `secret_id_bound_cidrs=10.0.2.0/24`, `token_bound_cidrs=10.0.2.0/24` | `vault read auth/approle/role/translog-api` |
| MED-12 | CSP appliqué sur frontend (apex/admin/tenants) via snippet Caddy `(translog_headers)` | `curl -I` → header `content-security-policy` non vide |
| MED-7 | CAA records BIND9 (`@ IN CAA 0 issue "letsencrypt.org"` + iodef) — dans `bind9/zones/translog.db` | `dig CAA translog.dsyann.info` |
| MED-8 | BIND9 zones perms `750/640/600` ownership uid 53:53 (uid `bind` du container) | `ls -la bind9/zones/` |
| MED-10 | Caddy block `path /.env /.git* /.DS_Store /package.json ... /node_modules*` retourne 404 | `curl https://translog.dsyann.info/.env` → 404 |
| MED-13 | `pg_hba.conf` : `host all all 10.0.2.0/24 scram-sha-256` + `host all all 10.0.0.0/8 scram-sha-256` (au lieu de `host all all all`) | `docker exec ... cat /var/lib/postgresql/data/pg_hba.conf` |
| HIGH-5 | Containers non-root : Postgres uid=999, Redis uid=999, MinIO uid=1000 (Vault/Caddy/nginx → Vague 3 cap_add) | `docker exec $cid id` |
| HIGH-6 | Fix 2 tests security KO (`briefing-isolation`, `rls-tenant-isolation`) — mock `prisma.transact` + regex `PUBLIC_TENANT_PATHS` sans `/v1/` | `npm run test:security` 207/207 |

### 8.4 — Pièges connus Vague 2

⚠️ **Bind mount Caddyfile : `sed -i` casse le mount**

`sed -i` crée un nouveau fichier (rename atomic) → l'inode change → le bind mount Docker pointe sur l'ancien inode → le container voit l'ancienne version. Workaround :
```bash
sed 's/old/new/' file > /tmp/x && cat /tmp/x > file  # cat > preserve inode
```

⚠️ **Caddy reload via API : 403 origin**

`docker exec $CID caddy reload` peut échouer avec "client is not allowed to access from origin 'http://localhost:2019'". Force restart via `docker service scale translog_caddy=0; sleep 3; docker service scale translog_caddy=1`.

⚠️ **Vault non-root : `unable to set CAP_SETFCAP effective capability: Operation not permitted`**

Image Vault essaie de set capability au boot. Nécessite `cap_add: [IPC_LOCK, SETFCAP]` dans le docker-stack file (modif du source, pas via `docker service update`). Si tentative `docker service update --user 100`, le service crash et Swarm rollback automatiquement → **Vault devient sealed après chaque restart**, requiert unseal manuel avec les 3 keys.

⚠️ **Permission denied sur `/var/lib/bind/tsig.key`**

Le user `bind` dans le container BIND9 a uid=**53**, pas 1001. Quand on fait MED-8 (`chmod 600 + chown`), il faut `chown 53:53` (pas 1001). Sinon BIND9 crash en boot. Workaround : `chown 53:53 zones/*`.

⚠️ **`docker service update --force` en host port mode bloque sur "host-mode port already in use"**

Avec `mode: host` sur ports 80/443/53, Swarm ne peut pas tenter un rolling update (2 containers ne peuvent pas binder le même port host). Solution : `docker service scale X=0; sleep 3; docker service scale X=1`.

### 8.5 — Hardening Vague 3 — partiel (audit 2026-04-25)

| ID | Action | Vérif |
|---|---|---|
| V3-A | CSP `'unsafe-inline'` remplacé par hash SHA-256 du script theme inline (`'sha256-SpcYfPAFmN3AcqAisA2RsheLRqw5HOlqBLk/WvFAdUE='`) | `curl -I` → header CSP avec hash ; theme bootstrap fonctionne sans warning |

⚠️ **Si tu modifies `frontend/index.html`** (en particulier le script theme inline), le hash CSP devient invalide → le script sera bloqué → page blanche.

Pour recalculer le hash après modif :
```bash
python3 -c "
import hashlib, base64, re
html = open('frontend/index.html').read()
m = re.search(r'<script>([\s\S]*?)</script>', html)
h = base64.b64encode(hashlib.sha256(m.group(1).encode()).digest()).decode()
print(f'sha256-{h}')
"
# Puis update Caddyfile avec le nouveau hash, reload Caddy
```

⚠️ **Le script `04-deploy.sh` peut overwriter le Caddyfile sur le VPS** (rsync depuis local). Le Caddyfile dans le repo `infra/prod/caddy/Caddyfile` doit être maintenu à jour avec les modifs prod (CSP, blocked_paths, h3 disable). Si tu modifies en prod via SSH, **resync immédiatement** le repo.

### 8.6 — Hardening Vague 3-B/C/D appliqué (2026-04-26)

| ID | Action | Vérif |
|---|---|---|
| V3-B | Web nginx non-root via `nginxinc/nginx-unprivileged:1.27-alpine` (uid 101, listen 8080) — Caddy `reverse_proxy web:8080` | `docker exec ... id` → uid=101 |
| V3-C | RLS Postgres PERMISSIVE sur 120 tables `tenantId` — policies `tenant_isolation_runtime` (app_runtime) + `bypass_admin` — script `infra/prod/postgres/03-rls-runtime.sql` idempotent | `SELECT count(*) FROM pg_policies WHERE schemaname='public'` → 240 |
| V3-D | MFA enforcement flag `mustEnrollMfa` dans `/me` et `signIn` réponse — true ssi STAFF + permission haut-privilège (control.iam.audit/manage.tenant, platform.manage, tenant.plan.change) sans MFA | Test login TENANT_ADMIN → réponse contient `mustEnrollMfa: true` |

### 8.7 — Procédure DNSSEC (MED-7 — non encore activé)

⚠️ Activer DNSSEC nécessite **action chez le registrar parent** (LWS pour `dsyann.info`) — sans DS record publié, la chain of trust est cassée.

Procédure complète :

1. **Générer KSK + ZSK ECDSAP256SHA256** dans le container BIND9 :
   ```bash
   ssh translog-vps
   BIND_CID=$(docker ps --filter "label=com.docker.swarm.service.name=translog_bind9" -q | head -1)
   docker exec $BIND_CID sh -c "
     mkdir -p /var/lib/bind/keys
     cd /var/lib/bind/keys
     dnssec-keygen -a ECDSAP256SHA256 -fK translog.dsyann.info  # KSK
     dnssec-keygen -a ECDSAP256SHA256    translog.dsyann.info   # ZSK
     chmod 600 K*.private
   "
   ```

2. **Activer inline-signing** dans `infra/prod/bind9/named.conf` :
   ```
   zone "translog.dsyann.info" {
       type master;
       file "/var/lib/bind/translog.db";
       inline-signing yes;
       auto-dnssec maintain;
       key-directory "/var/lib/bind/keys";
       allow-update { key translog-acme.; };  // existant TSIG
   };
   ```

3. **Reload BIND9** : `docker service scale translog_bind9=0; sleep 3; docker service scale translog_bind9=1`

4. **Récupérer le DS record** (KSK signé) :
   ```bash
   docker exec $BIND_CID dnssec-dsfromkey -2 /var/lib/bind/keys/Ktranslog.dsyann.info.+013+*.key
   # Affiche : translog.dsyann.info. IN DS <key-tag> 13 2 <hash>
   ```

5. **Publier le DS chez LWS** (interface admin du registrar `dsyann.info`) :
   - Type : DS
   - Host : `translog`
   - Algorithm : 13 (ECDSAP256SHA256)
   - Digest type : 2 (SHA-256)
   - Key tag + Digest : depuis la sortie étape 4

6. **Vérifier propagation** : `dig +dnssec +short translog.dsyann.info` → doit retourner les RRSIG, et `dig DS translog.dsyann.info @8.8.8.8` doit retourner le DS publié.

⚠️ Pour rotation des clés (annuel pour KSK, semestriel pour ZSK), procédure documentée dans https://datatracker.ietf.org/doc/html/rfc6781.

### 8.8 — Hardening restant (Vague 4)

- HIGH-5 (suite) Vault uid=100 + cap_add IPC_LOCK/SETFCAP — sealed scenario à gérer (3 unseal keys)
- HIGH-5 (suite) Caddy non-root + cap_add NET_BIND_SERVICE — chown volumes /data /config /var/log
- LOW-18 frontend : page `/account/mfa-enrollment`, redirect auto si `mustEnrollMfa: true` dans `/me` réponse, i18n 8 locales
- MED-7 DNSSEC effectif — voir §8.7 (action chez registrar nécessaire)
- Refacto deploy script `04-deploy.sh` pour ne pas écraser les Caddyfile/zone si déjà à jour
- Bascule RLS PERMISSIVE → RESTRICTIVE strict (audit que tous les services utilisent `prisma.transact()`)
- Investigation filtre Hostinger DDoS qui drop trafic MTN Congo (AS37463) — ticket Hostinger

---

## 9. Workflow de release (CI/CD GitHub Actions)

### 9.1 — Logique : 2 triggers séparés (volontaire)

```yaml
on:
  workflow_dispatch:        # Manuel (Run workflow UI)
  push:
    tags:
      - 'v*.*.*'            # Tag → deploy auto
```

| Action | Effet | Trigger |
|---|---|---|
| `git push origin main` | Tests CI seulement (jest unit + frontend build + gitleaks + npm audit) | `test.yml` |
| `git tag v1.0.1 && git push --tags` | **Build + push GHCR + deploy auto sur VPS** | `deploy.yml` |
| Actions UI → Run workflow | Idem (déploie depuis main) | `deploy.yml` (workflow_dispatch) |

### 9.2 — Pourquoi PAS auto-deploy sur push main ?

- Évite déploiement par erreur (commit "wip", "test", merge cassé)
- Sépare clairement "code commité" et "version livrée"
- Tag = marqueur d'historique pour rollback (`v1.0.1` → `v1.0.0`)
- Permet de pousser plusieurs commits et déployer une fois tout cohérent

### 9.3 — Flow standard d'une release

```bash
# 1. Code + tests locaux
npm test
npm run build          # backend
cd frontend && npm run build && cd ..

# 2. Commit + push (déclenche les TESTS CI seulement)
git add -A
git commit -m "feat(billing): nouvelle facturation pro-rata"
git push origin main

# 3. Vérifier que le run "Tests" est vert sur GitHub Actions
#    https://github.com/yannds/TranslogPro/actions/workflows/test.yml

# 4. Tag + push tags → déclenche le DÉPLOIEMENT
git tag v1.0.1
git push --tags

# 5. Suivre le run "Deploy production" sur Actions
#    https://github.com/yannds/TranslogPro/actions/workflows/deploy.yml
```

### 9.4 — Conventions de versioning (semver)

```
MAJOR.MINOR.PATCH
  │     │     └── Bug fix sans changement d'API (ex: 1.2.3 → 1.2.4)
  │     └──────── Nouvelle feature compatible (ex: 1.2.3 → 1.3.0)
  └────────────── Breaking change (ex: 1.2.3 → 2.0.0)
```

### 9.5 — Hotfix urgent (skipper la séquence normale)

```bash
# Sur main, fix + commit
git commit -am "fix(critical): patch incident production"
git push origin main

# Tag patch immédiat
git tag v1.0.2
git push --tags
# → CI/CD déploie en ~5 min
```

### 9.6 — Rollback en cas de release foireuse

**Option A — Rollback service au précédent tag** (rapide) :
```bash
ssh root@72.61.108.160 'docker service update --image translog_api:1.0.0 translog_api'
# Idem pour translog_web et translog_caddy
```

**Option B — Re-déployer un ancien tag** :
- Actions UI → Run workflow → entre `tag` = `v1.0.0` → Run

**Option C — Urgence totale** (gmp prend le relais) :
```bash
ssh root@72.61.108.160 'bash /opt/TranslogPro/infra/prod/scripts/rollback.sh'
```

---

## 10. Architecture CI/CD : push-based vs pull-based

### Mode actuel (push-based, GitHub Actions → VPS)

```
[Mac local] ──git push──▶ [GitHub] ──CI/CD──▶ [VPS]
                              │              ▲
                              │   1. build   │
                              │   2. push    │
                              ▼              │
                        [GHCR registry] ─────┘  3. SSH pull + deploy
```

- **Push-based** : GitHub Actions SSH vers le VPS et exécute `04-deploy.sh`
- Trigger : tag push ou clic UI
- Sécurité : SSH key dédiée déploiement, scope minimum
- Pré-requis : VPS accessible depuis internet sur 22 (mais filtré par IP GitHub Actions optionnel)

### Mode alternatif (pull-based, GitOps)

```
[Mac local] ──git push──▶ [GitHub] ◄──poll──[VPS agent]
                                              │
                                              ▼
                                       docker stack deploy
```

Le VPS héberge un agent (ex: **Watchtower**, **Flux**, **ArgoCD**) qui :
- **Poll** GitHub toutes les X minutes
- Détecte un nouveau tag/commit
- Pull les images depuis GHCR
- Re-deploy le stack

**Pros pull-based** :
- ✅ **Sécurité** : pas de SSH inbound depuis internet (port 22 fermé totalement)
- ✅ **Source of truth** : l'état Git est l'état prod (réconciliation auto)
- ✅ **Auto-recovery** : si VPS reboot, l'agent re-synchronise tout seul
- ✅ **Audit** : historique complet dans Git (qui a déployé quoi quand)

**Cons pull-based** :
- ❌ Agent supplémentaire à maintenir (mémoire CPU + monitoring)
- ❌ Latence de polling (1-15 min selon config)
- ❌ Plus complexe : webhooks possibles mais ouvre un port HTTP (genre 9000)
- ❌ Migration depuis push-based actuel = effort initial

**Outils possibles** :
| Outil | Niveau | Complexité | Use case |
|---|---|---|---|
| **Watchtower** | Container update auto | ⭐ Trivial | Petit projet, 1 service |
| **GitHub Actions self-hosted runner** | Runner sur le VPS qui exécute le workflow | ⭐⭐ Moyen | Hybride simple |
| **Flux CD** | GitOps complet | ⭐⭐⭐⭐ Élevé | Cluster k8s/Swarm avancé |
| **ArgoCD** | GitOps + UI graphique | ⭐⭐⭐⭐⭐ Très élevé | Production sérieuse multi-env |

### Quand passer au pull-based ?

- Si tu fermes le port 22 au monde et veux quand même déployer
- Si plusieurs serveurs / multi-env (staging + prod)
- Si l'équipe grandit (plusieurs devs qui tag)
- Si tu veux 0 SSH outbound depuis CI

**Pour TransLog Pro aujourd'hui** : push-based actuel est **adapté** (1 VPS, 1 dev, releases manuelles via tag). Pas besoin de basculer tant que tu n'as pas un de ces besoins.

---

## 11. Quand ça plante

1. **Lis les logs** : `docker service logs translog_<service> --since 10m | tail -50`
2. **Status** : `docker stack ps translog --no-trunc`
3. **Healthchecks** : `docker inspect <container> --format='{{.State.Health}}'`
4. **Rollback** : `bash scripts/rollback.sh` (gmp restauré, infra TransLog stoppée)
5. **Re-deploy** : `bash scripts/04-deploy.sh` (idempotent, reprend où ça s'est arrêté)

Si bloqué : ce manuel + relire la conversation Claude qui a buildé l'infra le 2026-04-25.
