# TransLog Pro — Accès à la stack infrastructure

> Référence opérationnelle : comment se connecter à chacun des services
> (Postgres, Redis, Vault, MinIO, Caddy, API NestJS, Vite) en ligne de
> commande et via leur UI web, avec les credentials exacts tels que
> configurés dans le repo.
>
> **Périmètre** : environnement de **développement local** (`docker-compose.yml`).
> Pour la production, les credentials vivent dans le gestionnaire de secrets
> de la plateforme d'hébergement (K8s Secrets, Doppler, AWS Secrets Manager…)
> — ce document ne les liste pas.

---

## 0. Vue d'ensemble

| # | Service | Container | Port hôte | CLI | UI web | Credentials |
|---|---|---|---|---|---|---|
| 1 | **PostgreSQL** | `translog-postgres` | `5434` (direct) | `psql` | pgAdmin / DBeaver / TablePlus | `app_user` / `app_password` |
| 2 | **PgBouncer** | `translog-pgbouncer` | `5433` (pool SESSION) | `psql` | pgAdmin / DBeaver | `app_user` / `app_password` |
| 3 | **Redis** | `translog-redis` | `6379` | `redis-cli` | RedisInsight (optionnel) | password `redis_password` |
| 4 | **Vault** | `translog-vault` | `8200` | `vault` CLI | http://localhost:8200 | token `dev-root-token` |
| 5 | **MinIO** | `translog-minio` | API `9000`, console `9001` | `mc` (MinIO Client) | http://localhost:9001 | `minioadmin` / `minioadmin123` (⚠ voir §5.3) |
| 6 | **Caddy** (dev, optionnel) | `translog-caddy-dev` | `80`, `443` | — | https://{slug}.translog.test | cert mkcert local |
| 7 | **API NestJS** | (host, pas Docker) | REST `3000`, WS `3001`, debug `9229` | — | http://localhost:3000/api/auth/me | session cookie après login |
| 8 | **Frontend Vite** | (host, pas Docker) | `5173` | — | http://localhost:5173 | — |

Fichier source de vérité : [`docker-compose.yml`](docker-compose.yml).
Fichier env de référence : [`.env`](.env) (local, non commité — voir [`.env.example`](.env.example)).

---

## 1. Démarrage et arrêt de la stack

### 1.1 Script "tout-en-un"

Le script [`scripts/dev.sh`](scripts/dev.sh) orchestre tout : Docker compose up,
migrations Prisma, seed IAM, création des buckets MinIO, démarrage de l'API et
du frontend Vite.

```bash
./scripts/dev.sh
```

À la fin, la console affiche les URLs utiles (API, Vite, pgAdmin-equivalent URL, etc.).

### 1.2 Contrôle fin

| Action | Commande |
|---|---|
| Démarrer seulement les containers Docker | `./scripts/dev-up.sh` |
| Arrêter tout (API + Vite + Docker) | `./scripts/stop.sh` |
| Arrêter seulement API + Vite (conserve Docker) | `./scripts/stop.sh --app` |
| Arrêter seulement Docker (conserve API + Vite) | `./scripts/stop.sh --docker` |
| Couper tout sans script | `docker compose down` + `pkill -f "start:dev\|vite"` |
| Repartir de zéro (⚠ destructif — efface les volumes Postgres/Redis/MinIO/Vault) | `docker compose down -v && ./scripts/dev.sh` |

### 1.3 État rapide

```bash
docker ps --filter "name=translog-" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

---

## 2. PostgreSQL — base de données principale

### 2.1 Coordonnées

| Paramètre | Valeur |
|---|---|
| **Host** (depuis hôte) | `localhost` |
| **Host** (depuis un autre container) | `postgres` |
| **Port direct** (bypass PgBouncer) | `5434` |
| **Port pool** (via PgBouncer — recommandé pour l'app) | `5433` |
| **Base** | `translog` |
| **User applicatif** | `app_user` |
| **Password** | `app_password` |
| **Schema** | `public` |
| **Extensions actives** | `postgis`, `postgis_topology`, `pgcrypto`, `uuid-ossp` |

Dans `.env` :
```bash
DATABASE_URL=postgresql://app_user:app_password@localhost:5434/translog?schema=public
DATABASE_URL_POOLED=postgresql://app_user:app_password@localhost:5433/translog?schema=public
```

### 2.2 Connexion CLI

Depuis l'hôte :

```bash
# Direct (5434) — pour migrations, scripts admin, debug
psql "postgresql://app_user:app_password@localhost:5434/translog"

# Via PgBouncer (5433) — simule le comportement applicatif
psql "postgresql://app_user:app_password@localhost:5433/translog"
```

Depuis le container (utile pour `exec -it`) :

```bash
docker exec -it translog-postgres psql -U app_user -d translog
```

Raccourci sans prompter le password (le password est déjà dans le container) :

```bash
docker exec -it translog-postgres psql -U app_user translog
```

### 2.3 Connexion UI web / desktop

**pgAdmin 4** (Mac : `brew install --cask pgadmin4`) — ajouter un serveur :
- General → Name : `TransLog Dev`
- Connection → Host : `localhost` · Port : `5434` · DB : `translog` · User : `app_user` · Password : `app_password`

**DBeaver / TablePlus** : même coordonnées (nouvelle connexion → PostgreSQL).

**Mode RLS** : les tables applicatives sont protégées par Row Level Security
([`infra/sql/01-rls.sql`](infra/sql/01-rls.sql)). Tant que tu te connectes avec
`app_user`, tu **ne vois rien** dans les tables scoped tenant — c'est normal.
Pour debug cross-tenant en UI, utiliser le rôle superuser :

```bash
# Réinitialiser en mode bypass RLS (⚠ dev uniquement)
docker exec -it translog-postgres psql -U app_user -d translog \
  -c "SET ROLE postgres;"
```

### 2.4 Commandes utiles

```bash
# Voir toutes les tables avec leur nb de lignes
docker exec translog-postgres psql -U app_user -d translog -c "\dt+"

# Dump local pour sauvegarde
docker exec translog-postgres pg_dump -U app_user translog > /tmp/translog.sql

# Restore depuis dump
docker exec -i translog-postgres psql -U app_user translog < /tmp/translog.sql

# Lire les logs du container
docker logs -f translog-postgres
```

---

## 3. PgBouncer — pooler de connexions

### 3.1 Coordonnées

| Paramètre | Valeur |
|---|---|
| **Host** | `localhost` |
| **Port** | `5433` |
| **User** | `app_user` |
| **Password** | `app_password` |
| **DB** | `translog` |
| **Mode pool** | `session` (obligatoire pour RLS — un set_config persiste sur la session) |
| **Max clients** | 200 |
| **Taille pool par DB** | 20 |

### 3.2 Pourquoi `session` et pas `transaction` ?

`app_runtime` pose `SET LOCAL app.current_tenant_id = 'xxx'` via
`TenantContextMiddleware`. En mode `transaction`, la variable est perdue après
chaque requête → le RLS ne voit plus le tenant courant → fuite cross-tenant
potentielle. Le mode `session` garantit qu'une même connexion garde la variable
le temps de la requête HTTP.

### 3.3 Inspection runtime

```bash
# Statistiques du pool (depuis l'hôte, connexion admin PgBouncer)
psql "postgresql://app_user:app_password@localhost:5433/pgbouncer" -c "SHOW POOLS;"

# Connexions actives
psql "postgresql://app_user:app_password@localhost:5433/pgbouncer" -c "SHOW CLIENTS;"

# Logs
docker logs -f translog-pgbouncer
```

---

## 4. Redis — cache + pub/sub + rate-limiting

### 4.1 Coordonnées

| Paramètre | Valeur |
|---|---|
| **Host** | `localhost` |
| **Port** | `6379` |
| **Password** | `redis_password` |
| **DB** | 0 (par défaut) |
| **Persistance** | AOF activé (`appendonly yes`), snapshot RDB toutes les 60s (si ≥ 1 write) |

Dans `.env` : `REDIS_URL=redis://:redis_password@localhost:6379`

### 4.2 Connexion CLI

```bash
# Depuis l'hôte (brew install redis)
redis-cli -h localhost -p 6379 -a redis_password

# Depuis le container
docker exec -it translog-redis redis-cli -a redis_password

# One-shot ping
docker exec translog-redis redis-cli -a redis_password --no-auth-warning PING
```

### 4.3 Opérations courantes

```bash
# Lister les keys rate-limit posées par RedisRateLimitGuard
redis-cli -a redis_password KEYS 'rl:*'

# Flusher les rate-limit quand on est bloqué en dev (erreur 429 sur sign-in)
docker exec translog-redis redis-cli -a redis_password --no-auth-warning FLUSHDB

# Voir l'info du cache WhiteLabel (ex.)
redis-cli -a redis_password GET "wl:brand:{tenantId}"
```

### 4.4 UI web

Redis n'expose pas d'UI native. Options :

- **RedisInsight** (gratuit, multi-plateforme) : `brew install --cask redisinsight`
  → Add Redis Database → Host `localhost`, Port `6379`, Password `redis_password`.
- **Extension VS Code `Redis Commander`** : fonctionne dans l'onglet Explorer.
- **CLI TUI** : `iredis` (plus confortable que `redis-cli`) — `pipx install iredis`.

---

## 5. HashiCorp Vault — gestionnaire de secrets

### 5.1 Coordonnées

| Paramètre | Valeur |
|---|---|
| **URL** | http://localhost:8200 |
| **Token root (dev)** | `dev-root-token` |
| **Mode** | `dev` (⚠ jamais en prod — pas de sealing, token fixe) |
| **Secrets engine KV v2** | monté sur `secret/` |
| **Secrets engine PKI** | monté sur `pki/` (CA interne + certs TLS) |
| **Secrets engine Transit** | monté sur `transit/` (chiffrement applicatif) |
| **Audit** | activé, logs dans `/vault/logs/audit.log` (volume `vault_data`) |

Dans `.env` :
```bash
VAULT_ADDR=http://localhost:8200
VAULT_TOKEN=dev-root-token
```

### 5.2 Connexion CLI

Installer le CLI une fois : `brew install vault`.

```bash
# Exporter les variables pour la session shell
export VAULT_ADDR=http://localhost:8200
export VAULT_TOKEN=dev-root-token

# Vérifier
vault status

# Lire un secret KV v2 (engine 'secret', path 'platform/payments/mtn_momo_cg')
vault kv get secret/platform/payments/mtn_momo_cg

# Écrire/remplacer un secret
vault kv put secret/platform/payments/mtn_momo_cg \
  PRIMARY_KEY="xxx" SECRET_KEY="yyy" CALLBACK_URL="https://..."

# Lister les chemins
vault kv list secret/platform/payments

# Supprimer (soft — KV v2 garde versions)
vault kv delete secret/platform/payments/stripe

# Destroy (hard — efface toutes versions)
vault kv metadata delete secret/platform/payments/stripe
```

### 5.3 Sans CLI local — via Docker exec

```bash
docker exec -it translog-vault vault kv get secret/platform/payments/mtn_momo_cg
```

### 5.4 UI web

Ouvre http://localhost:8200 :

1. **Method** : Token
2. **Token** : `dev-root-token`
3. → Dashboard avec les 3 engines (`secret/`, `pki/`, `transit/`)
4. `secret/` → `secret/data/platform/payments/mtn_momo_cg` → tu peux lire/écrire
   via le formulaire (KV v2 = chaque save crée une version, rollback possible)

### 5.5 Script d'init idempotent

[`infra/vault/init.sh`](infra/vault/init.sh) exécuté automatiquement par
`docker-compose up` via le service `vault-init`. Il :

- Active l'audit file
- Active les engines KV v2 / PKI / Transit
- Configure la CA interne `translog-ca` (TTL 10 ans)
- Crée les rôles PKI restreints aux domaines internes

Pour relancer manuellement :
```bash
docker compose run --rm vault-init
```

### 5.6 Conventions de chemins

| Chemin | Usage |
|---|---|
| `secret/platform/payments/<provider>` | Credentials providers paiement (shared plateforme) |
| `secret/platform/email/<provider>` | Credentials email (O365, Resend, SMTP) |
| `secret/tenants/<tenantId>/payments/<provider>` | Overrides provider paiement par tenant (sous-comptes dédiés) |
| `secret/tenants/<tenantId>/hmac` | Clé HMAC pour QR code tickets (par tenant) |

**Règle d'or** : un secret dans Vault n'est JAMAIS retourné par une API
applicative. Les services (`O365EmailService`, `PaymentProvider`, etc.) lisent
Vault directement à la demande et ne journalisent que le fait qu'une lecture a
eu lieu — jamais le contenu.

---

## 6. MinIO — stockage d'objets (S3-compatible)

### 6.1 Coordonnées

| Paramètre | Valeur docker-compose | Valeur `.env` local | Retenu par l'app |
|---|---|---|---|
| **API** | http://localhost:9000 | `MINIO_ENDPOINT=localhost:9000` | `localhost:9000` |
| **Console web** | http://localhost:9001 | — | — |
| **Root user** | `minioadmin` | `MINIO_ACCESS_KEY=minioadmin` | `minioadmin` |
| **Root password** | `minioadmin123` | `MINIO_SECRET_KEY=minioadmin` | ⚠ divergent — voir note ci-dessous |
| **SSL** | off | `MINIO_USE_SSL=false` | off |

> ⚠ **Note — divergence credentials MinIO**
>
> Le `docker-compose.yml` définit `MINIO_ROOT_PASSWORD=minioadmin123` mais le
> `.env` exemple utilise `MINIO_SECRET_KEY=minioadmin`. Selon l'environnement
> chargé, l'app peut échouer à se connecter (403).
>
> **Fix recommandé** : aligner `.env` → `MINIO_SECRET_KEY=minioadmin123` (pour
> matcher le container), ou créer un access key applicatif distinct via la
> console (§6.4).

### 6.2 Connexion CLI — MinIO Client (`mc`)

Installer : `brew install minio/stable/mc`.

```bash
# Configurer l'alias "dev" pointant sur le MinIO local
mc alias set dev http://localhost:9000 minioadmin minioadmin123

# Lister les buckets
mc ls dev/

# Créer un bucket
mc mb dev/documents

# Uploader un fichier
mc cp ./hello.txt dev/documents/hello.txt

# Lister le contenu d'un bucket
mc ls dev/documents

# Générer une URL signée (expire dans 1h)
mc share download --expire 1h dev/documents/hello.txt

# Voir les infos de policy d'un bucket
mc anonymous get dev/documents
```

### 6.3 Connexion CLI — SDK AWS (Node)

```javascript
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({
  endpoint: 'http://localhost:9000',
  region: 'us-east-1',           // MinIO ignore region mais l'SDK l'exige
  credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin123' },
  forcePathStyle: true,          // MinIO utilise toujours le path-style
});

const out = await s3.send(new ListBucketsCommand({}));
console.log(out.Buckets);
```

### 6.4 UI web — console MinIO

Ouvrir http://localhost:9001 :

- **Username** : `minioadmin`
- **Password** : `minioadmin123`

La console permet :
- Créer/lister les **buckets** (gauche)
- Gérer les **policies** (IAM-like, JSON)
- Créer des **access keys applicatifs** (Settings → Identity → Users → Service Accounts)
  — à privilégier sur la root key en prod
- Inspecter les **événements** (webhooks S3 vers l'API)
- Monitoring **traffic** et **objets**

### 6.5 Buckets attendus

Créés automatiquement par `scripts/dev.sh` :

| Bucket | Contenu |
|---|---|
| `documents` | PDFs (manifestes, factures, reçus), photos incidents |
| `avatars` | Photos de profil user |
| `branding` | Logos tenant, hero images custom |
| `exports` | Fichiers CSV/XLSX générés par les reports |

Contrôle :
```bash
mc ls dev/
```

---

## 7. Caddy — reverse proxy dev (multi-tenant sous-domaines)

### 7.1 Rôle

Caddy sert `https://*.translog.test` (cert `mkcert` local) et route vers le
frontend Vite (:5173) ou l'API (:3000) selon le Host. Permet de tester le
multi-tenant sans mocker le Host header.

### 7.2 Démarrage

```bash
# Prérequis une fois :
brew install mkcert
mkcert -install
mkdir -p infra/caddy/certs
mkcert -cert-file ./infra/caddy/certs/dev.crt \
       -key-file  ./infra/caddy/certs/dev.key \
       "*.translog.test" translog.test localhost

# /etc/hosts → ajouter :
echo "127.0.0.1 trans-express.translog.test citybus-congo.translog.test" | sudo tee -a /etc/hosts

# Démarrer Caddy
docker compose -f docker-compose.yml -f docker-compose.dev.yml up caddy -d
```

### 7.3 URLs produites

| URL | Cible |
|---|---|
| `https://trans-express.translog.test` | Portail du tenant `trans-express` (Vite) |
| `https://trans-express.translog.test/api/auth/sign-in` | API NestJS avec Host résolu |
| `https://citybus-congo.translog.test` | Portail tenant B (même Vite, Host différent) |

Logs : `docker logs -f translog-caddy-dev`.

### 7.4 Sans Caddy (mode simple)

Si tu n'as pas besoin du multi-tenant par sous-domaine, tu peux te passer de
Caddy. Ouvre http://localhost:5173 directement — l'auth multi-tenant sera
limitée (le TenantHostMiddleware ne résoudra que le tenant par défaut).

---

## 8. API NestJS — backend applicatif

### 8.1 Coordonnées

| Paramètre | Valeur |
|---|---|
| **REST** | http://localhost:3000 |
| **WebSocket** | ws://localhost:3001 |
| **Debug (inspector)** | `--inspect=9229` — attach depuis VS Code / Chrome DevTools |
| **Runtime** | Node 20 sur l'hôte (pas dans Docker — pour hot-reload rapide) |

### 8.2 Démarrage

```bash
npm run start:dev
```

Logs Winston en JSON structuré. En cas de crash, relecture :
```bash
npm run start:dev 2>&1 | tee /tmp/api.log
```

### 8.3 Auth — session cookie

L'API ne retourne PAS de token d'API. L'authentification passe par session
cookie (`translog_session`) posé à `POST /api/auth/sign-in`.

Exemple de flow CLI :

```bash
# 1. Sign-in (tenant résolu depuis Host header)
curl -c /tmp/jar.txt -X POST http://localhost:3000/api/auth/sign-in \
  -H "Host: trans-express.translog.test" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@trans-express.test","password":"admin123"}'

# 2. Call endpoint protégé avec le cookie
curl -b /tmp/jar.txt http://localhost:3000/api/auth/me \
  -H "Host: trans-express.translog.test"
```

### 8.4 Users seedés

Voir [`prisma/seeds/dev.seed.ts`](prisma/seeds/dev.seed.ts) — les mots de passe
sont typiquement `admin123` (non compliants prod, dev uniquement).

---

## 9. Frontend Vite — portail web

### 9.1 Coordonnées

| Paramètre | Valeur |
|---|---|
| **URL** | http://localhost:5173 |
| **Runtime** | Node 20 sur l'hôte |
| **Proxy API** | `vite.config.ts` → `/api` → `http://localhost:3000` |

### 9.2 Démarrage

```bash
cd frontend && npm run dev
```

### 9.3 Hot Module Replacement

Actif par défaut. Les modifs `.tsx` / `.css` sont reflétées sans rechargement.

---

## 10. Récap commandes clés

| Besoin | Commande one-liner |
|---|---|
| Tout démarrer | `./scripts/dev.sh` |
| Tout arrêter | `./scripts/stop.sh` |
| Restart propre des containers Docker | `docker compose restart` |
| Logs d'un service | `docker logs -f translog-{postgres\|redis\|vault\|minio\|pgbouncer}` |
| Shell dans un container | `docker exec -it translog-{service} sh` |
| Reset DB + Redis + MinIO + Vault (⚠) | `docker compose down -v` |
| Rejouer migrations Prisma seules | `npx prisma migrate deploy` |
| Rejouer seed IAM seul | `npx ts-node prisma/seeds/iam.seed.ts` |
| Voir les ports occupés | `lsof -nP -iTCP -sTCP:LISTEN \| grep -E '3000\|3001\|5173\|5433\|5434\|6379\|8200\|9000\|9001'` |

---

## 11. Sécurité — ce qui change en prod

Ce doc couvre le **dev uniquement**. En production :

| Service | Changement |
|---|---|
| Postgres | mots de passe rotatifs via Vault, TLS mTLS imposé côté PgBouncer, rôle `app_runtime` séparé de `postgres` |
| Redis | password long aléatoire, TLS, ACL par app |
| Vault | mode serveur (pas dev), sealing avec Shamir, token root scellé, auth AppRole pour les services |
| MinIO | access keys applicatifs scopés par bucket, chiffrement SSE-S3 ou SSE-KMS, réplication multi-site |
| API | pas de `dev-root-token` ; `VAULT_TOKEN` injecté via auth AppRole au boot |
| Caddy | cert Let's Encrypt, redirect HTTP→HTTPS forcé, HSTS preloaded |

Runbook prod : [`infra/runbooks/POST_CUTOVER_HARDENING.md`](infra/runbooks/POST_CUTOVER_HARDENING.md).
