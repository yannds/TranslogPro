# Runbook — Initialisation production TransLog Pro

**Version** : Phase 1+2 post-audit sécu (2026-04-18)
**Prérequis** : serveur prod avec Docker, DNS wildcard `*.translogpro.com`, token Cloudflare.

Ce runbook couvre les étapes **obligatoires** avant le cutover prod. Les raccourcis dev (root token Vault, POSTGRES_USER=app_user SUPERUSER, secrets en clair) NE DOIVENT JAMAIS être reportés en prod.

## 1. PostgreSQL — rôles applicatifs

### 1.1 Créer `app_user` (admin) et `app_runtime` (backend) distincts

En dev, `POSTGRES_USER=app_user` crée app_user SUPERUSER (bypass RLS). **En prod, ce n'est pas acceptable**.

**Étape 1** : créer un superuser dédié aux migrations (`app_admin`), distinct du user runtime.

```bash
# Connexion initiale en tant qu'admin Postgres (DBA)
psql -U postgres -d translog

-- Role admin pour migrations Prisma (SUPERUSER ou privilèges DDL suffisants)
CREATE ROLE app_admin LOGIN PASSWORD '<MOT_DE_PASSE_SECURE>'
  CREATEDB CREATEROLE INHERIT;
GRANT ALL PRIVILEGES ON DATABASE translog TO app_admin;

-- Role runtime pour backend (non-SUPERUSER, NOBYPASSRLS)
CREATE ROLE app_runtime LOGIN PASSWORD '<MOT_DE_PASSE_SECURE>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
GRANT CONNECT ON DATABASE translog TO app_runtime;
GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app_runtime;

-- Role superadmin plateforme (pour support L2 control plane)
CREATE ROLE app_superadmin LOGIN PASSWORD '<MOT_DE_PASSE_SECURE>'
  NOSUPERUSER NOBYPASSRLS;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO app_superadmin;
```

### 1.2 Appliquer les policies RLS

```bash
psql -U app_admin -d translog -f infra/sql/01-rls.sql
psql -U app_admin -d translog -f infra/sql/02-rls-new-tables.sql
psql -U app_admin -d translog -f infra/sql/03-multi-tenant-isolation-phase1.sql
psql -U app_admin -d translog -f infra/sql/04-rls-phase1-backfill.sql
```

### 1.3 Vérifier RLS effective

```bash
# Doit retourner 0 lignes (fail-closed sans tenant context)
psql -U app_runtime -d translog -c "SELECT count(*) FROM users;"
# → count = 0

# Avec tenant context, voit uniquement son tenant
psql -U app_runtime -d translog -c "
SET app.tenant_id = '<tenant_uuid>';
SELECT count(*) FROM users;
"
# → count > 0, tous du tenant en question
```

## 2. PgBouncer — userlist multi-role

Pour que le backend (`app_runtime`) et les migrations (`app_admin`) puissent tous deux passer par PgBouncer :

### 2.1 Générer userlist.txt

```bash
# Sur la machine où tourne PgBouncer
cat > /etc/pgbouncer/userlist.txt <<EOF
"app_runtime" "md5<hash_du_password>"
"app_admin"   "md5<hash_du_password>"
EOF

# Hash MD5 : md5(password + username)
# Ex : echo -n "passwordapp_runtime" | md5sum | cut -d' ' -f1 | awk '{print "md5"$1}'
chmod 600 /etc/pgbouncer/userlist.txt
```

### 2.2 Configurer pgbouncer.ini

```ini
[databases]
translog = host=postgres port=5432 dbname=translog

[pgbouncer]
auth_type = md5
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = session                     # OBLIGATOIRE pour RLS
server_reset_query = DISCARD ALL        # Reset app.tenant_id entre sessions
max_client_conn = 500
default_pool_size = 25
```

## 3. Vault — mode production (pas dev)

### 3.1 Déployer Vault en Raft HA

**Interdit** en prod : `VAULT_DEV_ROOT_TOKEN_ID`. Utiliser Raft HA 3 nœuds.

```yaml
# docker-compose.prod.yml (override)
vault:
  image: hashicorp/vault:1.16
  cap_add: [IPC_LOCK]
  environment:
    VAULT_ADDR: https://vault:8200
    VAULT_API_ADDR: https://vault:8200
    VAULT_CLUSTER_ADDR: https://vault:8201
  volumes:
    - ./infra/vault/config.hcl:/vault/config/config.hcl:ro
    - vault_data_prod:/vault/data
    - vault_logs_prod:/vault/logs
  command: ["vault", "server", "-config=/vault/config/config.hcl"]
```

### 3.2 Initialiser Vault (one-shot)

```bash
# Init avec 5 keys Shamir (3 nécessaires pour unseal)
docker exec -it translog-vault vault operator init \
  -key-shares=5 -key-threshold=3 -format=json > /secure/vault-init.json

# ⚠️ Sauvegarder /secure/vault-init.json SÉPARÉMENT :
# - 3 unseal keys → 3 personnes distinctes (GPG-encrypted)
# - root token → coffre-fort break-glass (GPG-encrypted, accès DBA seulement)

# Unseal (à faire à chaque boot de vault — ou configurer auto-unseal KMS)
docker exec -it translog-vault vault operator unseal <key1>
docker exec -it translog-vault vault operator unseal <key2>
docker exec -it translog-vault vault operator unseal <key3>
```

### 3.3 Activer audit logs

```bash
vault audit enable -path=file_audit file file_path=/vault/logs/audit.log
vault audit enable -path=syslog_audit syslog tag="vault"
```

### 3.4 Créer AppRole pour le backend

```bash
# Policy translog-api (voir infra/vault/init.sh pour le contenu)
vault policy write translog-api /vault/policies/translog-api.hcl

# Enable AppRole + créer le role
vault auth enable approle
vault write auth/approle/role/translog-api \
  token_policies=translog-api \
  token_ttl=1h token_max_ttl=4h \
  secret_id_ttl=720h            # Secret rotation tous les 30j

# Générer RoleID + SecretID
export VAULT_ROLE_ID=$(vault read -format=json auth/approle/role/translog-api/role-id \
  | jq -r '.data.role_id')
export VAULT_SECRET_ID=$(vault write -format=json -f auth/approle/role/translog-api/secret-id \
  | jq -r '.data.secret_id')

# Stocker comme Docker secrets
echo -n "$VAULT_ROLE_ID" > ./secrets/vault_role_id
echo -n "$VAULT_SECRET_ID" > ./secrets/vault_secret_id
chmod 600 ./secrets/vault_role_id ./secrets/vault_secret_id
```

### 3.5 Seeder les secrets plateforme

```bash
# DATABASE_URL pour backend runtime (app_runtime non-SUPERUSER)
vault kv put secret/platform/db \
  DATABASE_URL="postgresql://app_runtime:<pwd>@pgbouncer:5432/translog?schema=public" \
  DATABASE_URL_DIRECT="postgresql://app_admin:<pwd>@postgres:5432/translog?schema=public"

# JWT + BetterAuth secrets (≥ 64 chars aléatoires)
vault kv put secret/platform/app \
  JWT_SECRET="$(openssl rand -hex 64)" \
  BETTER_AUTH_SECRET="$(openssl rand -hex 64)"

# HMAC impersonation (Phase 2 — ≥ 32 chars)
vault kv put secret/platform/impersonation_key \
  KEY="$(openssl rand -hex 64)"

# Cloudflare API token (pour Caddy ACME DNS-01)
vault kv put secret/platform/caddy \
  CLOUDFLARE_API_TOKEN="<token_scope_Zone_DNS_Edit_uniquement>"

# DOMAIN_CHECK shared secret (pour Caddy on-demand TLS Phase 3)
vault kv put secret/platform/caddy_domain_check \
  API_KEY="$(openssl rand -hex 32)"
```

## 4. Docker secrets (no passwords in compose)

Remplacer toutes les vars `PASSWORD: xxx` dans `docker-compose.yml` par des Docker secrets :

```yaml
services:
  postgres:
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password
    secrets: [postgres_password]
  redis:
    command: ["redis-server", "--requirepass-file", "/run/secrets/redis_password"]
    secrets: [redis_password]
  minio:
    environment:
      MINIO_ROOT_PASSWORD_FILE: /run/secrets/minio_password
    secrets: [minio_password]

secrets:
  postgres_password: { file: ./secrets/postgres_password }
  redis_password:    { file: ./secrets/redis_password }
  minio_password:    { file: ./secrets/minio_password }
```

**Génération** :
```bash
mkdir -p secrets
openssl rand -base64 48 > secrets/postgres_password
openssl rand -base64 48 > secrets/redis_password
openssl rand -base64 48 > secrets/minio_password
chmod 600 secrets/*
```

## 5. Caddy — activer on-demand TLS (Phase 3)

Quand tu déploies la feature "custom domains" pour les tenants premium :

### 5.1 Implémenter `/internal/domain-check` côté backend

Endpoint **NON EXPOSÉ PUBLIQUEMENT** — protégé par header partagé avec Caddy.

```typescript
// src/modules/tenancy/domain-check.controller.ts
@Controller('internal/domain-check')
@UseGuards(DomainCheckAuthGuard)   // vérifie X-Domain-Check-Key header
export class DomainCheckController {
  @Get()
  async check(@Query('name') hostname: string) {
    const tenant = await this.tenantDomainRepo.findByHostname(hostname);
    if (!tenant || !tenant.verifiedAt) {
      return { allowed: false };
    }
    return { allowed: true };
  }
}
```

### 5.2 Activer le bloc on-demand dans `infra/caddy/Caddyfile.prod`

Dé-commenter la config `on_demand_tls { ask ... }` et le bloc `:443 { tls { on_demand } }`.

### 5.3 Passer le secret partagé

```yaml
# docker-compose.prod.yml
caddy:
  environment:
    DOMAIN_CHECK_API_KEY_FILE: /run/secrets/domain_check_api_key
  secrets: [domain_check_api_key]
backend:
  environment:
    DOMAIN_CHECK_API_KEY_FILE: /run/secrets/domain_check_api_key
  secrets: [domain_check_api_key]
```

Caddy envoie le header `X-Domain-Check-Key: <secret>` dans la requête `ask`. Le backend rejette toute requête sans ce header.

## 6. Frontend `.env` de production

```bash
# frontend/.env.production (à créer hors Git)
VITE_PLATFORM_BASE_DOMAIN=translogpro.com
```

## 7. Vérifications finales pré-cutover

- [ ] `psql -U app_runtime` sans `app.tenant_id` → 0 rows sur tables RLS
- [ ] Backend démarre avec `DATABASE_URL` = `app_runtime@pgbouncer`
- [ ] Migrations Prisma tournent avec `DATABASE_URL_DIRECT` = `app_admin@postgres`
- [ ] `docker exec translog-vault vault audit list` → au moins un device actif
- [ ] `ls -la secrets/*` → tous en 600, aucun dans Git
- [ ] `curl https://admin.translogpro.com` → HTTP 200 avec HSTS header
- [ ] `curl https://admin.translogpro.com/api/health/live` → HTTP 200
- [ ] Test cross-tenant : `curl https://tenantA.translogpro.com/api/tenants/TENANTB_UUID/display` → 403
- [ ] Test RLS bypass : depuis une console DB `app_user`, `SELECT ... cross-tenant` doit être bloqué par RLS policies (vérifié via FORCE RLS + WITH CHECK)

## 8. Rollback plan

Si un problème survient après cutover :

```bash
# 1. Revert DNS wildcard → serveur d'ancien environnement
# 2. Arrêter le nouveau stack
docker compose -f docker-compose.yml -f docker-compose.prod.yml down

# 3. Remettre la DB au snapshot pré-cutover
pg_restore -U postgres -d translog /backups/pre-cutover.dump

# 4. Restart ancien stack
```

Les changements schema/RLS de Phase 1 sont **rétrocompatibles** — l'ancien code continuera à fonctionner, juste sans l'isolation renforcée.
