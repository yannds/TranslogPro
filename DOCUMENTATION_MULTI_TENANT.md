# TransLog Pro — Documentation Multi-Tenant (Solution Complète)

> **Document de référence technique et opérationnel.**
> Complète le PRD (`PRD_TransLog_Pro_v2.md`) et l'architecture (`TECHNICAL_ARCHITECTURE.md`).
> Décrit l'état réel du code **au 2026-04-18** — stack, configuration, fonctionnement, dev, prod, prérequis.

---

## Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [Stack technique réelle](#2-stack-technique-réelle)
3. [Architecture multi-tenant](#3-architecture-multi-tenant)
4. [Tenant plateforme & portail SaaS](#4-tenant-plateforme--portail-saas)
5. [Configuration (dev & prod)](#5-configuration-dev--prod)
6. [Fonctionnement — flow complet](#6-fonctionnement--flow-complet)
7. [Mise en place — Dev](#7-mise-en-place--dev)
8. [Mise en place — Prod](#8-mise-en-place--prod)
9. [Stratégie de tests](#9-stratégie-de-tests)
10. [Décisions architecturales (delta)](#10-décisions-architecturales-delta)
11. [Ce qui existait avant vs ce qui a été livré](#11-ce-qui-existait-avant-vs-ce-qui-a-été-livré)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Vue d'ensemble

TransLog Pro est une plateforme **SaaS B2B multi-tenant** pour la gestion du transport routier de voyageurs et de colis en Afrique (Congo, Sénégal, Côte d'Ivoire…). Un exploitant (« tenant ») dispose de son propre sous-domaine, ses utilisateurs, ses agences, sa configuration métier. Un tenant spécial `__platform__` (UUID nil `00000000-0000-0000-0000-000000000000`) héberge l'équipe interne TransLog Pro qui opère la plateforme.

### Acteurs

| Acteur | Rôle | Tenant |
|---|---|---|
| **SUPER_ADMIN** | Control plane complet + override workflows + gestion plans SaaS + config plateforme | `__platform__` |
| **SUPPORT_L1** | Lecture data plane global + impersonation JIT + répond aux tickets support | `__platform__` |
| **SUPPORT_L2** | L1 + debug workflow/outbox + révocation d'impersonation | `__platform__` |
| **TENANT_ADMIN** | Gestion IAM du tenant + config, modules, staff | Tenant client |
| **AGENCY_MANAGER**, **CASHIER**, **DRIVER**, **HOSTESS**, **MECHANIC**, **DISPATCHER**, **PUBLIC_REPORTER**, **CUSTOMER** | Rôles opérationnels | Tenant client |

### Isolation

- **Par sous-domaine** : `trans-express.translog.test` (dev) ou `trans-express.translogpro.com` (prod)
- **Par cookie session** : `translog_session` est scopé au sous-domaine → impossible de « voler » un cookie d'un tenant vers un autre
- **Par PostgreSQL RLS** : toutes les tables sensibles ont une policy `RESTRICTIVE` qui refuse toute requête sans `SET LOCAL app.tenant_id` (fail-closed)
- **Par permissions scopées** : `data.ticket.read.agency` ≠ `data.ticket.read.tenant` ≠ `data.ticket.read.global`

---

## 2. Stack technique réelle

> État constaté au 2026-04-18. Le PRD (section II.1) et TECHNICAL_ARCHITECTURE (section 1.1) décrivent l'intention ; ce tableau documente **ce qui tourne**.

### 2.1 Backend

| Item | Version | Pourquoi ce choix |
|---|---|---|
| **Node.js** | ≥ 20 (forcé par `dev.sh`) | LTS, support natif de fetch + streams modernes |
| **NestJS** | `^10.3.0` | Modular monolith, DI first-class, guards/interceptors/middleware unifiés |
| **TypeScript** | `^5.3.0` | Type-safety bout en bout (DTOs, Prisma, guards) |
| **Prisma** | `^5.10.0` | ORM type-safe, `db push` schemaless en dev, migrations gérées à part en prod |
| **PostgreSQL** | 16 + PostGIS 3.4 | RLS RESTRICTIVE, PostGIS optionnel pour géo-safety |
| **PgBouncer** | edoburu/pgbouncer latest, mode **SESSION** | Obligatoire pour RLS (`SET LOCAL` requis par transaction) |
| **Redis** | 7-alpine, AOF on, password | Sessions, rate-limiting, cache permissions (60s TTL), Socket.io adapter, Pub/Sub |
| **Vault** | hashicorp/vault 1.16 | Secrets DB/Redis/MinIO/Auth + HMAC keys par tenant (QR signatures, impersonation) |
| **MinIO** | minio/minio latest | S3-compat, buckets `translog-docs` / `translog-photos`, TTL URLs signées |
| **better-auth** | `^1.0.0` | Session cookie httpOnly + compat JWT API clients |
| **bcryptjs** | `^3.0.3` | Hash password, timing-safe |
| **otplib** | `^12.0.1` | TOTP 2FA (MfaModule) |
| **class-validator** + **class-transformer** | `^0.14`, `^0.5.1` | Validation DTOs déclarative |
| **zod** | `^3.22` | Validation backend additionnelle (ex : guards runtime) |
| **ioredis** | `^5.3.2` | Client Redis haute perf |
| **socket.io** + `@socket.io/redis-adapter` | `^4.7`, `^8.3` | Gateways temps réel (display gare, GPS buses, alerts) multi-instance |
| **@nestjs/throttler** | `^5.1.0` | Rate limit global 300 req/60s ; surcouches `RedisRateLimitGuard` par endpoint |
| **helmet** | `^8.1.0` | Security headers (CSP prod, désactivé en dev pour HMR) |
| **@nestjs/schedule** | `^4.0.0` | Crons : outbox poller, DAU/HealthScore (platform-analytics), renewal billing, DLQ retry |
| **winston** + **nest-winston** | `^3.11`, `^1.9.4` | Logs JSON structurés, interceptors `LoggingInterceptor` + `AuditLoggingInterceptor` (ISO 27001) |
| **prom-client** | `^15.1.0` | Métriques Prometheus `/metrics` |
| **@opentelemetry/***  | `^1.7`, `^0.57`, `^0.56` | Traces distribuées → Jaeger |
| **puppeteer-core** + **@sparticuz/chromium** | `^24.40`, `^147.0` | PDF headless (manifestes, billets) |
| **@pdfme/** | `^6.0.6` | Templates PDF dynamiques |
| **lru-cache** | `^10.2.0` | Caches in-process (permissions, tenant config) |
| **async-local-storage** | `^2.3.0` | Contexte tenant par requête (scope invisible aux couches métier) |

### 2.2 Frontend

| Item | Version | Pourquoi |
|---|---|---|
| **React** | `^18.3.1` | Hooks, Suspense, concurrent features |
| **Vite** | `^5.4.2` | HMR ultra-rapide, proxy `/api` natif, bundles optimisés |
| **React Router** | `^7.14.1` | SPA routing, lazy loading |
| **TypeScript** | `^5.5.4` | Mêmes types que backend via copy DTOs |
| **Tailwind CSS** | `^3.4.10` | Utility-first, tokens sémantiques (`t-text`, `t-card-bordered`…) |
| **@radix-ui/*** | Multiples `^1.x` | Headless primitives accessibles (Dialog, Select, Tabs, Tooltip…) |
| **class-variance-authority** | `^0.7.0` | Variants de composants (Button, Badge) |
| **lucide-react** | `^0.441.0` | Icônes — 1500+ glyphes |
| **react-hook-form** + **zod** + **@hookform/resolvers** | `^7.53`, `^3.23`, `^3.9` | Formulaires contrôlés + validation |
| **react-leaflet** | `^4.2.1` | Maps (tracking GPS, géo-safety) |
| **reactflow** | `^11.11.4` | Éditeur visuel workflows (WorkflowStudio) |
| **@playwright/test** | `^1.59.1` | E2E navigateur |

### 2.3 Infra (docker-compose)

| Service | Image | Port(s) | Rôle |
|---|---|---|---|
| postgres | postgis/postgis:16-3.4 | 5434 → 5432 | DB principale + RLS + PostGIS optionnel |
| pgbouncer | edoburu/pgbouncer:latest | 5433 → 5432 | Pooler SESSION (requis RLS) |
| redis | redis:7-alpine | 6379 | Cache, rate limit, pub/sub, sessions |
| vault | hashicorp/vault:1.16 | 8200 | Secrets + HMAC keys |
| vault-init | hashicorp/vault:1.16 | — | One-shot bootstrap secrets |
| minio | minio/minio:latest | 9000, 9001 | S3 storage + console |
| caddy (overlay) | caddy:2-alpine | 80, 443 | TLS + routage sous-domaines *.translog.test (dev uniquement) |

### 2.4 Observabilité

| Domaine | Stack | Endpoint / fichier |
|---|---|---|
| Logs | Winston JSON | stdout (collecté par Docker log driver) |
| Audit | `audit_logs` table + `AuditLoggingInterceptor` | Prisma model `AuditLog` |
| Métriques | Prometheus `prom-client` | `GET /metrics` |
| Traces | OpenTelemetry SDK Node | Export OTLP → Jaeger |
| Health | NestJS custom | `GET /health/live`, `GET /health/ready` |

### 2.5 Tests

| Type | Config | Harness |
|---|---|---|
| **Unit** | `jest.unit.config.ts` | Jest + mocks in-memory |
| **Integration** | `jest.integration.config.ts` | Jest + Testcontainers PostgreSQL |
| **Security** | `jest.security.config.ts` | Jest ciblé (permission guards, input validation, tenant isolation) |
| **E2E API** | `jest.e2e.config.ts` | Supertest + mocked infra |
| **E2E Browser** | `playwright.config.ts` | Playwright Chromium + storageState par rôle |

### 2.6 Ce qui n'existe PAS (encore)

- **CI/CD** : pas de `.github/workflows/` ni `.gitlab-ci.yml`. Tests locaux uniquement. **À ajouter** pour le prod.
- **Kubernetes manifests** : le PRD les décrit mais aucun fichier `k8s/` dans le repo. Prod pour l'instant = `docker-compose.prod.yml` (à construire).
- **Monitoring dashboards** : Prometheus expose `/metrics`, mais pas de Grafana fourni.

---

## 3. Architecture multi-tenant

### 3.1 Isolation par sous-domaine

Chaque tenant a un hostname unique (`{slug}.translog.test` en dev, `{slug}.translogpro.com` en prod) et son propre cookie de session scopé au domaine.

```
┌─ trans-express.translog.test ──┐     ┌─ citybus-congo.translog.test ─┐
│ Cookie: translog_session=A…    │     │ Cookie: translog_session=B…   │
│ Session.tenantId = "te-123"    │     │ Session.tenantId = "cb-456"   │
└────────────┬───────────────────┘     └────────────┬──────────────────┘
             │                                      │
             └──────────┬───────────────────────────┘
                        ▼
                ┌───────────────────┐
                │ TenantHostMiddleware │  ← résout req.resolvedHostTenant via Host header
                │ SessionMiddleware    │  ← hydrate req.user via cookie
                │ TenantIsolationGuard │  ← refuse si session.tenantId ≠ host.tenantId
                │ PermissionGuard      │  ← @RequirePermission(...)
                │ ModuleGuard          │  ← @RequireModule(...)
                │ RlsMiddleware        │  ← SET LOCAL app.tenant_id
                └───────────────────┘
```

### 3.2 Résolution du tenant (flow d'une requête)

1. **Requête arrivant** : `GET https://trans-express.translog.test/api/tickets`
2. **Caddy** (dev) ou reverse proxy prod transmet à NestJS avec `Host: trans-express.translog.test`
3. **`TenantHostMiddleware`** extrait le subdomain → lookup `TenantDomain.hostname` → résout `resolvedHostTenant = { tenantId, slug }`
4. **`SessionMiddleware`** lit le cookie, charge la session en Redis/DB, hydrate `req.user = { id, tenantId, roleId, ... }`
5. **`TenantIsolationGuard`** refuse (403) si `req.user.tenantId ≠ req.resolvedHostTenant.tenantId` (cookie smuggling)
6. **`PermissionGuard`** vérifie que le rôle a bien la permission (`data.ticket.read.tenant`)
7. **`ModuleGuard`** vérifie que le module SaaS requis est activé pour le tenant (`InstalledModule`)
8. **`RlsMiddleware`** exécute `SET LOCAL app.tenant_id = $1` dans la transaction Prisma → PostgreSQL filtre automatiquement tous les SELECT/UPDATE/DELETE

### 3.3 Row Level Security (RLS)

Policies dans `infra/sql/01-rls.sql` + `02-rls-new-tables.sql`. Pattern :

```sql
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tickets
  AS RESTRICTIVE FOR ALL TO app_user
  USING ("tenantId" = current_setting('app.tenant_id', true));
```

**Mode RESTRICTIVE** = **fail-closed**. Si `app.tenant_id` n'est pas défini (oubli middleware), la requête retourne 0 lignes au lieu de fuiter. Contrairement à PERMISSIVE qui est une AND logique, RESTRICTIVE garantit qu'aucun bypass possible via OR.

**PgBouncer mode SESSION obligatoire** : RLS utilise `SET LOCAL` qui ne fonctionne que dans la même session Postgres. Mode TRANSACTION de PgBouncer réutiliserait des connexions avec `app.tenant_id` d'une autre requête — faille critique.

### 3.4 Plan vs scope permissions

Les permissions suivent le format `{plane}.{module}.{action}.{scope}` :

- **plane** : `control` (config, règles) | `data` (données métier)
- **scope** : `own` < `agency` < `tenant` < `global`

Un SUPER_ADMIN a `data.ticket.read.global` qui dépasse tous les tenants. Un AGENCY_MANAGER a `data.ticket.read.agency` (son agence uniquement).

### 3.5 Impersonation JIT (switch de session temporaire)

Un SUPER_ADMIN / SUPPORT_L1 qui doit enquêter sur un tenant client fait :
1. `POST /iam/impersonate { targetTenantId, reason }` → reçoit un **token HMAC-SHA256 signé** (clé Vault `platform/impersonation_key`)
2. Token stocké **hashé SHA-256** en DB (`ImpersonationSession`), jamais en clair
3. Les requêtes suivantes portent le header `X-Impersonation-Token: {token}` — TTL 15 min, non-renouvelable
4. `ImpersonationGuard` valide signature (timing-safe), vérifie non-expiré, injecte `req.impersonation`
5. `ScopeContext.tenantId = targetTenantId` pendant la session → RLS cible le bon tenant
6. Tout est loggé en `AuditLog` niveau `critical`
7. `DELETE /iam/impersonate/:sessionId` révoque (SUPPORT_L2 + SA uniquement)

---

## 4. Tenant plateforme & portail SaaS

### 4.1 Tenant spécial `__platform__`

- **UUID fixe** : `00000000-0000-0000-0000-000000000000` (nil UUID, RFC 4122)
- **Slug** : `__platform__`
- **Hostname dev** : `admin.translog.test` (entry `/etc/hosts` provisionnée par `dev-up.sh`)
- **Hostname prod** : `admin.translogpro.com`
- **Protégé par** `PlatformTenantGuard` : aucun user tenant client ne peut y être assigné
- **3 rôles système** seedés au bootstrap (`bootstrapPlatform()` dans `iam.seed.ts`) :
  - `SUPER_ADMIN` — 25 permissions (control plane complet + data global + impersonation switch/revoke + platform plans/billing/metrics/support/config)
  - `SUPPORT_L1` — 14 permissions (data read global + impersonation switch + support read/write)
  - `SUPPORT_L2` — 17 permissions (L1 + debug workflow/outbox + revoke impersonation)

### 4.2 Modules backend du portail SaaS (nouveaux)

| Module | Chemin | Responsabilité |
|---|---|---|
| `PlatformModule` | `src/modules/platform/` | Bootstrap premier SA (`POST /platform/bootstrap`), CRUD staff plateforme |
| `PlatformPlansModule` | `src/modules/platform-plans/` | CRUD plans SaaS (slug, prix, cycle, modules inclus), catalogue public tenant |
| `PlatformBillingModule` | `src/modules/platform-billing/` | Souscriptions + factures plateforme→tenant + cron renouvellement quotidien |
| `PlatformAnalyticsModule` | `src/modules/platform-analytics/` | Growth / Adoption / Health — endpoints + crons DAU et TenantHealthScore |
| `PlatformConfigModule` | `src/modules/platform-config/` | KV store des seuils DB-driven (health thresholds, billing due days, etc.) avec cache 60s et fallback const |
| `SupportModule` | `src/modules/support/` | Tickets tenant→plateforme + thread messages + SLA capping par plan |

### 4.3 Modèles Prisma ajoutés (par ce chantier)

```
Plan
  id, slug (unique), name, description, price, currency, billingCycle,
  trialDays, limits (JSON), sla (JSON), sortOrder, isPublic, isActive
PlanModule            — M2M Plan × moduleKey
PlatformSubscription  — 1:1 avec Tenant, statut TRIAL|ACTIVE|PAST_DUE|SUSPENDED|CANCELLED
PlatformInvoice       — facture plateforme → tenant, numéro séquentiel PF-YYYY-NNNNNN
SupportTicket         — tenantId, reporterUserId, title, priority, status, slaDueAt, assignedToPlatformUserId
SupportMessage        — ticketId, authorScope TENANT|PLATFORM, body, isInternal
DailyActiveUser       — agrégat cron, clef (userId, date)
TenantHealthScore     — agrégat cron, score 0-100 + components JSON
PlatformConfig        — KV (key @id, value JSON, updatedBy)
```

Champs ajoutés sur modèles existants :
- `User.lastLoginAt`, `lastActiveAt`, `loginCount` — alimentent DAU/MAU
- `Tenant.planId`, `activatedAt`, `suspendedAt`
- `InstalledModule.enabledAt`, `enabledBy`

### 4.4 Frontend — portail plateforme

Pages React lazy-loaded (sous `/admin/platform/*`) :

| Page | Route | Access |
|---|---|---|
| PagePlatformDashboard | `/admin/platform/dashboard` | SA + L1 + L2 (sections filtrées par perm) |
| PageTenants | `/admin/platform/tenants` | SA (`control.tenant.manage.global`) |
| PagePlatformPlans | `/admin/platform/plans` | SA (`control.platform.plans.manage.global`) |
| PagePlatformBilling | `/admin/platform/billing` | SA (`control.platform.billing.manage.global`) |
| PagePlatformSupport | `/admin/platform/support` | SA/L1/L2 (`control.platform.support.read.global`) |
| PagePlatformStaff | `/admin/platform/staff` | SA (`control.platform.staff.global`) |
| PagePlatformSettings | `/admin/platform/settings` | SA (`control.platform.config.manage.global`) |
| PageImpersonation | `/admin/platform/impersonation` | SA+L1 switch, SA+L2 revoke |
| PageDebugWorkflow | `/admin/platform/debug/workflow` | L2+SA (`data.workflow.debug.global`) |
| PageDebugOutbox | `/admin/platform/debug/outbox` | L2+SA (`data.outbox.replay.global`) |

Côté tenant (utilisateurs tenant qui contactent le support) :
- `PageCustomerSupport` sur `/admin/support` — crée et consulte ses propres tickets

### 4.5 `TenantScopeProvider` (frontend)

Contexte React qui permet à un staff plateforme de **superviser les données d'un tenant spécifique** sans impersonation (lecture seule). Le hook `useScopedTenantId()` retourne :
- `scopedTenantId` si l'agent a choisi un tenant depuis le sélecteur sticky
- `user.tenantId` pour les utilisateurs tenant normaux (pas de notion de scope)
- `null` pour un SA n'ayant rien sélectionné (les pages affichent `<NoTenantScope />`)

Persistance en `sessionStorage`.

### 4.6 Redirect au login

`HomeRedirect` dans `frontend/src/main.tsx` :
- User CUSTOMER → `/customer`
- User avec perms driver → `/driver`
- Staff agence / quai → `/agent` / `/quai`
- **Staff plateforme** → `/admin/platform/dashboard` directement (le dashboard tenant standard est vide pour eux)
- Autre (admin tenant) → `/admin`

### 4.7 Ce qui n'est PAS caché mais rendu tenant-aware

Les items tenant-scoped de `ADMIN_NAV` (Trips, Fleet, Cashier, Incidents…) restent visibles pour le SA. Quand il en ouvre un, les requêtes utilisent `useScopedTenantId()` — si aucun tenant scope n'est choisi, la page affiche `<NoTenantScope />` qui invite à sélectionner un tenant dans le bandeau en haut. **Pas de cache, pas de dissimulation** : restructuration UX propre.

---

## 5. Configuration (dev & prod)

### 5.1 Variables d'environnement

Fichier `.env` racine (git-ignoré). Variables critiques :

```bash
# Base de données (via PgBouncer en SESSION mode)
DATABASE_URL="postgresql://app_user:app_password@localhost:5433/translog?schema=public"

# Redis
REDIS_URL="redis://:redis_password@localhost:6379"

# Vault
VAULT_ADDR="http://localhost:8200"
VAULT_TOKEN="dev-root-token"          # DEV uniquement — prod = token scoped

# MinIO
MINIO_ENDPOINT="localhost"
MINIO_PORT="9000"
MINIO_ACCESS_KEY="minioadmin"
MINIO_SECRET_KEY="minioadmin"
MINIO_USE_SSL="false"

# Multi-tenant
PLATFORM_BASE_DOMAIN="translog.test"   # dev — prod : translogpro.com
ADMIN_SUBDOMAIN="admin"

# Modes
NODE_ENV="development"
PORT="3000"
```

En prod : ne jamais commiter `.env.prod`. Les secrets sensibles (DB password, Vault token, JWT secret, HMAC keys) vivent **dans Vault** ; `.env.prod` ne contient que l'adresse de Vault + le token AppRole.

### 5.2 Secrets Vault (bootstrappés par `scripts/vault-bootstrap.ts`)

```
platform/db          { DATABASE_URL }
platform/redis       { HOST, PORT, PASSWORD }
platform/minio       { ENDPOINT, PORT, ACCESS_KEY, SECRET_KEY, USE_SSL }
platform/auth        { SECRET, JWT_SECRET }
platform/sms         { ACCOUNT_SID, AUTH_TOKEN, FROM_NUMBER }
platform/whatsapp    { ACCOUNT_SID, AUTH_TOKEN, FROM_NUMBER }
platform/flutterwave { SECRET_KEY, WEBHOOK_HASH }
platform/paystack    { SECRET_KEY }
platform/openweathermap { API_KEY }
platform/impersonation_key { KEY }                    # 64 hex chars (HMAC)
tenants/{tenantId}/hmac    { KEY }                    # HMAC QR codes par tenant
```

### 5.3 DNS / Hosts

#### Dev (macOS / Linux)
`dev-up.sh` provisionne `/etc/hosts` :

```
127.0.0.1 admin.translog.test
127.0.0.1 trans-express.translog.test
127.0.0.1 citybus-congo.translog.test
127.0.0.1 translog.test
```

Puis Caddy (`docker-compose.dev.yml`) route `*.translog.test` → Vite:5173 / Nest:3000 avec TLS (certs mkcert).

Les tenants créés dynamiquement (`pw-e2e-tenant`) sont auto-résolus par Playwright via `--host-resolver-rules=MAP *.translog.test 127.0.0.1` sans nécessiter de modification /etc/hosts.

#### Prod
Wildcard DNS `*.translogpro.com` → LoadBalancer / Ingress. Le reverse proxy (Caddy ou Nginx+Kong) termine le TLS, route vers NestJS avec Host header intact. Certificats Let's Encrypt via DNS-01 challenge (requis pour wildcard).

### 5.4 Configuration du frontend (Vite)

`frontend/vite.config.ts` :
- Port 5173
- Proxy `/api` → `http://localhost:3000` (cookies transmis via `changeOrigin`)
- Alias `@ui`, `@form`, `@layout`, `@lib`

### 5.5 Configuration PlatformConfig (DB-driven, sans redéploiement)

Les seuils métier (score à risque, DLQ events threshold, billing due days…) sont **éditables depuis l'UI `/admin/platform/settings`** par le SA sans redéploiement. Registre statique dans `src/modules/platform-config/platform-config.registry.ts`, valeurs en DB, cache in-memory 60s, fallback const si la DB est KO.

---

## 6. Fonctionnement — flow complet

### 6.1 Login d'un user tenant client

```
1. GET https://trans-express.translog.test/login
2. POST /api/auth/sign-in  { email, password }
   Host header: trans-express.translog.test
3. Backend:
   - TenantHostMiddleware résout tenantId via TenantDomain
   - AuthService.signIn() :
     - Lookup Account(providerId=credential, accountId=email)
     - bcrypt.compare(password)
     - Check User.isActive
     - Génère token 256 bits, create Session
     - Incrémente User.loginCount, pose lastLoginAt
     - AuditLog success
4. Response:
   - Set-Cookie: translog_session=<token>; HttpOnly; Secure; SameSite=Strict;
                 Domain=trans-express.translog.test; Max-Age=2592000  (30j)
5. Frontend redirige vers HomeRedirect qui choisit le bon portail selon userType + permissions
```

### 6.2 Login d'un SA (tenant plateforme)

Identique au 6.1 mais Host = `admin.translog.test`, résolution vers `__platform__`. `HomeRedirect` route vers `/admin/platform/dashboard` automatiquement.

### 6.3 Création d'un tenant (par SA)

```
1. SA va sur /admin/platform/tenants → clique "Nouveau tenant"
2. POST /api/tenants { name, slug, adminEmail, adminName }
3. TenantService.create :
   - Vérifie unicité slug
   - prisma.tenant.create({ provisionStatus: 'ACTIVE' })
   - Génère clé HMAC 256 bits → Vault secrets/tenants/{tenantId}/hmac
   - Crée le 1er user admin (userType: STAFF) — mot de passe à définir via magic link
   - OnboardingService : crée agence par défaut + rôles tenant + modules par défaut
   - Crée TenantDomain ({slug}.translog.test + {slug}.translogpro.com)
4. Response : { id, slug, createdAt }
```

### 6.4 Souscription d'un tenant à un plan (par SA)

```
1. SA va sur /admin/platform/billing → onglet Subscriptions → "Nouvelle souscription"
2. POST /api/platform/billing/subscriptions { tenantId, planId }
3. PlatformBillingService.createSubscription :
   - Rejette si tenantId = PLATFORM_TENANT_ID
   - Vérifie plan.isActive
   - Calcule trialEndsAt (plan.trialDays) et currentPeriodEnd (plan.billingCycle)
   - status = TRIAL ou ACTIVE selon trialDays
   - upsert PlatformSubscription (idempotent par tenantId)
   - update Tenant.planId
4. Cron quotidien (03:00 UTC) : pour chaque subscription active dont
   currentPeriodEnd ≤ now → génère PlatformInvoice DRAFT + avance la période.
```

### 6.5 Flow support tenant → plateforme

```
1. User du tenant (TENANT_ADMIN ou agent) va sur /admin/support
2. Ouvre un ticket : POST /api/support/tickets { title, description, category, priority }
3. SupportService.createByTenant :
   - Rejette si actor.tenantId = PLATFORM (staff plateforme ne crée pas côté tenant)
   - Lookup tenant.plan.sla.maxPriority → cappe la priorité demandée
   - Calcule slaDueAt via plan.sla.firstResponseMinByPriority ou fallback DEFAULT_SLA_MINUTES
   - Crée SupportTicket + SupportMessage initial (TENANT scope)
4. Le ticket apparaît dans /admin/platform/support queue (SA/L1/L2)
5. SA répond : POST /api/platform/support/tickets/:id/messages
   - firstResponseAt posé si 1er response externe
   - Status OPEN → IN_PROGRESS → WAITING_CUSTOMER
6. Tenant répond : status WAITING_CUSTOMER → IN_PROGRESS
7. SA résout : PATCH /api/platform/support/tickets/:id { status: 'RESOLVED' }
   - resolvedAt posé, tenant reçoit notif (future)
```

### 6.6 Session d'impersonation JIT (enquête support)

```
1. SUPPORT_L1 est sur /admin/platform/impersonation
2. Sélectionne un tenant, saisit une raison → POST /iam/impersonate
3. ImpersonationService :
   - Signature HMAC-SHA256 avec clé Vault platform/impersonation_key
   - Stocke hash SHA-256 en DB (jamais le token en clair)
   - TTL 15 min, non-renouvelable
   - AuditLog level=critical
4. Frontend affiche le token UNE SEULE FOIS avec countdown
5. Les requêtes suivantes incluent header X-Impersonation-Token
6. ImpersonationGuard valide (timing-safe), injecte req.impersonation
7. PermissionGuard + RlsMiddleware utilisent targetTenantId au lieu de actorTenantId
8. Expiration auto à 15 min ou révocation manuelle par SA/L2
```

### 6.7 Crons actifs

| Nom | Fréquence | Service |
|---|---|---|
| OutboxPoller | Chaque 1s | `infrastructure/eventbus/outbox-poller.service` |
| DLQ Retry | Chaque 15 min | idem |
| Expiration tickets PENDING_PAYMENT | Chaque minute | `modules/scheduler` |
| Génération trips depuis TripTemplate | 02:00 UTC | `modules/scheduler` |
| Auto-clôture repos chauffeurs | Chaque 5 min | `modules/scheduler` |
| **DAU aggregation** | **02:00 UTC** | `platform-analytics.service.runDailyActiveUsersJob` |
| **TenantHealthScore** | **02:30 UTC** | `platform-analytics.service.runTenantHealthScoreJob` |
| **Billing renewal** | **03:00 UTC** | `platform-billing.service.runRenewalBatch` |

---

## 7. Mise en place — Dev

### 7.1 Prérequis

| Outil | Version | Pourquoi |
|---|---|---|
| macOS 13+ ou Linux | — | `dev.sh` force macOS ; sur Linux adapter manuellement |
| Docker Desktop | 24+ | Conteneurs infra |
| Node.js | 20 LTS | Forcé par dev.sh (via Homebrew) |
| sudo | — | Pour /etc/hosts (via `dev-up.sh`) |
| Git | — | Clone repo |
| mkcert (optionnel) | — | Certs locaux pour HTTPS dev |

### 7.2 Premier lancement (bootstrap complet)

```bash
git clone git@github.com:votreorg/translogpro.git
cd translogpro
chmod +x scripts/dev.sh
./scripts/dev.sh
```

Ce que fait `dev.sh` (auto-healing, 492 lignes) :

1. Nettoie les instances précédentes (PIDs, ports 3000/3001/5173)
2. Installe Homebrew + Docker + Node 20 + mc si manquants
3. Lance `docker-compose up -d` pour postgres, pgbouncer, redis, vault, minio
4. Bootstrap Vault via `scripts/vault-bootstrap.ts` (idempotent)
5. Push Prisma schema : `npx prisma db push`
6. Applique RLS : `infra/sql/01-rls.sql` + `02-rls-new-tables.sql`
7. Seed IAM : `npx ts-node prisma/seeds/iam.seed.ts` (rôles plateforme + tenants de démo)
8. Seed dev : `npx ts-node prisma/seeds/dev.seed.ts` (données démo)
9. Crée buckets MinIO : `translog-docs`, `translog-photos`
10. Patch URLs Vault (hostnames Docker → localhost pour dev)
11. Lance API NestJS en watch (`nest start --watch`)
12. Lance Vite frontend en HMR (`vite`)
13. Trap Ctrl+C → graceful shutdown

Pour configurer `/etc/hosts` + TLS local (recommandé pour tester le multi-tenant vraiment) :
```bash
./scripts/dev-up.sh
```

### 7.3 Comptes de démo pré-seedés

| Email | Password | Rôle | Tenant |
|---|---|---|---|
| `superadmin@translogpro.com` | `Admin1234!` | SUPER_ADMIN | __platform__ |
| `admin@trans-express.com` | `Admin1234!` | TENANT_ADMIN | trans-express |
| `admin@citybus-congo.com` | `Admin1234!` | TENANT_ADMIN | citybus-congo |

Pour les tests Playwright, comptes E2E additionnels (seedés par `scripts/seed-e2e.ts`) :
- `e2e-sa@translog.test` / `Passw0rd!E2E` (SA)
- `e2e-tenant-admin@trans-express.translog.test` / `Passw0rd!E2E` (TENANT_ADMIN)

### 7.4 URLs dev

| URL | Service |
|---|---|
| `http://localhost:5173` | Vite (mode direct) |
| `http://admin.translog.test:5173` | Frontend via subdomain (bandeau tenant plateforme actif) |
| `http://trans-express.translog.test:5173` | Frontend pour trans-express |
| `http://localhost:3000/api/*` | API Nest |
| `http://localhost:9001` | MinIO Console (minioadmin / minioadmin) |
| `http://localhost:8200` | Vault UI (token `dev-root-token`) |
| `http://localhost:5555` | Prisma Studio (si `npm run db:studio`) |

### 7.5 Arrêt / redémarrage

```bash
./scripts/stop.sh             # graceful stop (API + Vite)
./scripts/stop.sh --docker    # + docker down
./scripts/dev-down.sh         # + nettoyage /etc/hosts
./scripts/dev-down.sh --full  # + drop volumes + uninstall mkcert
```

### 7.6 Re-seed sans reset complet

```bash
npx ts-node prisma/seeds/iam.seed.ts         # propage nouvelles permissions aux tenants existants
npx ts-node scripts/seed-e2e.ts              # reset comptes E2E
npm run db:reset                             # DESTRUCTIF : drop + recreate + re-seed
```

---

## 8. Mise en place — Prod

> **État actuel** : `docker-compose.prod.yml` et Kubernetes manifests ne sont PAS dans le repo. Cette section décrit la cible recommandée.

### 8.1 Infrastructure cible (recommandée)

```
┌─── CDN (Cloudflare) ───┐
│  *.translogpro.com     │
│  admin.translogpro.com │
└──────────┬─────────────┘
           ▼
┌─── Ingress Caddy / Nginx+Kong ──┐
│  TLS termination                │
│  Rate limiting edge             │
│  Host routing → NestJS pods     │
└──────────┬──────────────────────┘
           ▼
┌─── Kubernetes cluster ──────────────────────┐
│  NestJS pods (HPA min=3 max=30)             │
│  Frontend static (S3 + CloudFront) ou SSR  │
│  Sidecar otel-collector → Jaeger            │
└──────────┬──────────────────────────────────┘
           ▼
┌─── Data plane ──────────────────────────────┐
│  PostgreSQL 16 RDS HA (multi-AZ, PITR)      │
│  PgBouncer DaemonSet (SESSION mode)          │
│  Redis Elasticache Cluster                   │
│  Vault HA (Raft 3 nœuds)                     │
│  S3 (ou MinIO cluster 4 nœuds)               │
└─────────────────────────────────────────────┘
```

### 8.2 Pré-requis prod

| Item | Détail |
|---|---|
| Domaine + wildcard DNS | `*.translogpro.com`, certs Let's Encrypt via DNS-01 |
| Secrets manager | Vault HA ou AWS Secrets Manager (mais code = Vault) |
| Base | PostgreSQL 16 + PostGIS (RDS / CloudSQL / Azure) |
| Pooler | PgBouncer SESSION mode (obligatoire pour RLS) |
| Cache | Redis 7 Cluster (min 3 shards) |
| Stockage | S3 (IAM policy par tenant) ou MinIO cluster |
| Monitoring | Prometheus + Grafana + Alertmanager |
| Traces | Jaeger ou Tempo |
| Logs | Loki ou ELK (Winston JSON → stdout → collector) |
| Email transactionnel | SendGrid / SES / Mailgun |
| SMS / WhatsApp | Twilio (configuré dans Vault) |
| Paiement | Flutterwave + Paystack (clés Vault) |

### 8.3 Variables prod obligatoires

```bash
NODE_ENV=production
PLATFORM_BASE_DOMAIN=translogpro.com
ADMIN_SUBDOMAIN=admin

VAULT_ADDR=https://vault.internal.translogpro.com
VAULT_TOKEN=<AppRole token scoped>
# Tous les autres secrets (DB, Redis, auth, HMAC) vivent dans Vault — jamais en env.

SENTRY_DSN=...               # error monitoring
OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger-collector:4318
```

### 8.4 Déploiement — étapes

1. **Build images** :
   ```bash
   docker build -t translogpro/api:$(git rev-parse --short HEAD) .
   docker build -t translogpro/frontend:$(git rev-parse --short HEAD) -f Dockerfile.frontend frontend/
   ```

2. **Push registry** (GHCR / ECR / Harbor)

3. **Migrate DB** :
   ```bash
   DATABASE_URL=... npx prisma migrate deploy
   DATABASE_URL=... psql -f infra/sql/01-rls.sql
   DATABASE_URL=... psql -f infra/sql/02-rls-new-tables.sql
   ```

4. **Bootstrap Vault** (une fois) :
   ```bash
   VAULT_ADDR=... VAULT_TOKEN=<root> npx ts-node scripts/vault-bootstrap.ts
   ```

5. **Bootstrap plateforme** (créer le 1er SUPER_ADMIN) :
   ```bash
   curl -X POST https://admin.translogpro.com/api/platform/bootstrap \
     -H "X-Bootstrap-Key: $BOOTSTRAP_KEY" \
     -d '{ "email": "admin@translogpro.com", "name": "Admin" }'
   ```
   La route renvoie un `setupToken` qui permet de définir le mot de passe. L'endpoint se verrouille ensuite (idempotent refuse).

6. **Deploy pods** :
   ```bash
   kubectl apply -f k8s/          # À créer
   kubectl rollout status deployment/api
   ```

7. **Smoke tests** :
   ```bash
   curl https://admin.translogpro.com/api/health/live
   ```

### 8.5 Checklist sécurité pré-prod

- [ ] Tous les secrets en Vault, **aucun** dans `.env` / image Docker
- [ ] Cookies : `Secure=true`, `SameSite=Strict`, `HttpOnly=true`, `Domain=.translogpro.com`
- [ ] CORS : `origin: false` pour les APIs privées ; whitelist explicite pour le portail public
- [ ] Helmet CSP strict avec nonces
- [ ] Rate limit edge (Cloudflare) + app (Redis)
- [ ] Audit log ingesté vers SIEM (Splunk / Datadog)
- [ ] DLQ monitoring avec PagerDuty si > 1h non-vide
- [ ] Backup DB quotidien + PITR 30j + test de restore mensuel
- [ ] Secrets rotation : JWT secret tous les 90j, HMAC impersonation tous les 30j
- [ ] Pentests annuels

### 8.6 Ce qui reste à construire pour prod

1. `docker-compose.prod.yml` **OU** manifests K8s (`k8s/*.yaml`)
2. Pipelines CI/CD (GitHub Actions) : lint + test unit + test integration + test security + build images + deploy
3. Grafana dashboards (Growth, Adoption, Health SaaS, API latency, error rate)
4. Alertmanager rules (DLQ > 1h, health score < 60 global, subscription renewal failed)
5. Runbooks (incident response, data breach, secret rotation)

---

## 9. Stratégie de tests

### 9.1 Pyramide

```
              ┌─ Playwright E2E (browser) ─┐   37 tests
             /  Suite portail plateforme   \
            /───────────────────────────────\
           /   Jest E2E API (supertest)     \  149 tests (app + platform)
          /─────────────────────────────────\
         /   Security (Jest + mocks)        \  132 tests
        /───────────────────────────────────\
       /   Integration (Testcontainers PG)  \  ~50 tests
      /───────────────────────────────────────\
     /   Unit (Jest + in-memory mocks)        \  56+ tests (platform) + existants
    └─────────────────────────────────────────┘
```

### 9.2 Commandes

```bash
npm test                    # Unit (Jest)
npm run test:integration    # Testcontainers PG réel
npm run test:security       # Tests sécu isolés
npm run test:e2e            # E2E API (supertest + NestJS complet + mocks)
npm run test:pw             # Playwright headless
npm run test:pw:ui          # Playwright UI mode (debug)
npm run test:pw:headed      # Browser visible
npm run test:pw:report      # Ouvrir dernier rapport HTML
```

### 9.3 Conventions

| Suffixe | Type | Config |
|---|---|---|
| `*.spec.ts` dans `test/unit/` | Unit | `jest.unit.config.ts` |
| `*.spec.ts` dans `test/integration/` | Integration (DB réelle) | `jest.integration.config.ts` |
| `*.spec.ts` dans `test/security/` | Security | `jest.security.config.ts` |
| `*.e2e-spec.ts` dans `test/e2e/` | E2E API | `jest.e2e.config.ts` |
| `*.sa.pw.spec.ts` | Playwright SA | project `super-admin` |
| `*.tenant.pw.spec.ts` | Playwright tenant | project `tenant-admin` |
| `*.public.pw.spec.ts` | Playwright non-auth | project `public` |
| `*.api.spec.ts` dans `test/playwright/` | Playwright HTTP direct | project `api` |

### 9.4 Couverture SaaS platform (livrée par ce chantier)

| Module | Unit | Security | E2E API | Playwright |
|---|---|---|---|---|
| PlatformConfigService | 15 | 5 | 5 | 3 |
| PlatformPlansService | 11 | 2 | 5 | 4 |
| PlatformBillingService | 13 | 1 | 2 | — |
| SupportService | 17 | 3 | 6 | 3 tenant + 2 SA |
| PlatformAnalyticsService | — | — | — | — (scope à ajouter) |
| TenantScopeProvider | — | — | — | 2 |
| **Total nouveau** | **56** | **11** | **18** | **14** |

Total global (nouveau + existant) : **132 security / 149 e2e API / 37 Playwright, 0 fail**.

### 9.5 Rapport sécurité

`Result_Secu_test.md` mis à jour à chaque audit — 132/132 tests PASS au 2026-04-18.

---

## 10. Décisions architecturales (delta)

Nouvelles ADR introduites par le chantier portail SaaS (à ajouter à TECHNICAL_ARCHITECTURE section 1.2) :

| ADR | Titre | Raison |
|---|---|---|
| **ADR-27** | Plans SaaS DB-driven (modèle `Plan` + `PlanModule`) | Zéro hardcoding des plans — le SA les crée/édite via UI |
| **ADR-28** | Billing plateforme séparé de `Invoice` tenant | Éviter de mélanger factures client-final et facturation SaaS |
| **ADR-29** | Support ticket model distinct de SAV `Claim` | SAV est intra-tenant ; support est tenant↔plateforme |
| **ADR-30** | SLA capping par plan avec fallback `DEFAULT_SLA_MINUTES` | Ne bloque jamais un tenant sans plan — filet de sécurité |
| **ADR-31** | `PlatformConfig` KV store (seuils editables sans redéploiement) | Permet au SA de tuner riskThreshold, DLQ threshold, billing dueDays sans PR |
| **ADR-32** | `TenantScopeProvider` + `<NoTenantScope />` plutôt que cacher les items nav | Restructuration propre : les pages restent visibles, scope choisi explicitement |
| **ADR-33** | Fallback const obligatoire sur chaque `PlatformConfigService.getNumber()` | Zéro panique si DB KO — le cron et les services continuent de fonctionner |
| **ADR-34** | `User.lastActiveAt` throttlé à 5 min dans `SessionMiddleware` | DAU/MAU sans overhead — 1 update max toutes les 5 min par user |
| **ADR-35** | Health score calculé en cron 02:30 UTC, lu depuis agrégat | Pas de calcul on-the-fly coûteux → lecture O(1) |
| **ADR-36** | Playwright `--host-resolver-rules` au lieu de /etc/hosts | Tests E2E fonctionnent sans sudo, isolent dynamiquement `*.translog.test` → 127.0.0.1 |

---

## 11. Ce qui existait avant vs ce qui a été livré

### 11.1 Avant ce chantier (pré-2026-04-18)

Déjà en place dans le repo :
- Architecture NestJS + Prisma + React/Vite + Docker stack complet
- 100+ modèles Prisma, 40+ modules NestJS
- Multi-tenant par sous-domaine avec TenantDomain model
- RLS RESTRICTIVE + PgBouncer SESSION mode
- IAM DB-driven (PermissionGuard + cache Redis 60s)
- Impersonation JIT (token HMAC, 15 min TTL)
- Modules A à V (billetterie, colis, flotte, caisse, manifestes, SAV…)
- Portail client / driver / station-agent / quai-agent / admin
- 108 tests sécurité (CRM, session, headers, RLS, dependencies…)
- PRD v4.0 + TECHNICAL_ARCHITECTURE v3.0

Ce qui manquait :
- Portail plateforme réel (pages `PageWip` stubs)
- Modèle commercial SaaS (plans, souscriptions, factures plateforme)
- Support cross-tenant (tenant ouvre ticket → queue plateforme)
- Analytics cross-tenant (growth, adoption, health score)
- Config plateforme éditable sans redéploiement
- Tests Playwright navigateur

### 11.2 Livré par ce chantier (2026-04-18)

**Backend — 5 nouveaux modules** :
- `PlatformPlansModule` (dto + service + controller + tests)
- `PlatformBillingModule` (souscriptions + factures + cron renewal)
- `PlatformAnalyticsModule` (growth/adoption/health + crons DAU/HealthScore)
- `PlatformConfigModule` (KV store + registry + cache)
- `SupportModule` (2 controllers : tenant + plateforme)

**Schema Prisma — 8 nouveaux modèles** :
`Plan`, `PlanModule`, `PlatformSubscription`, `PlatformInvoice`, `SupportTicket`, `SupportMessage`, `DailyActiveUser`, `TenantHealthScore`, `PlatformConfig`

**Permissions — 9 nouvelles** (seedées aux 3 rôles plateforme + tenant admin) :
- `control.platform.plans.manage.global`, `.billing.manage.global`, `.support.read.global`, `.support.write.global`, `.config.manage.global`
- `data.platform.metrics.read.global`
- `data.support.create.tenant`, `.read.tenant`
- `data.tenant.plan.read.tenant`, `control.tenant.plan.change.tenant`

**Frontend — 8 pages + 1 provider** :
- PagePlatformDashboard refondue (Growth/Adoption/Health/Support queue)
- PagePlatformPlans, PagePlatformBilling, PagePlatformSupport, PagePlatformSettings
- PageCustomerSupport (côté tenant)
- PageDebugWorkflow, PageDebugOutbox (stubs honnêtes)
- TenantScopeProvider + TenantScopeSelector + NoTenantScope

**i18n** — 8 locales enrichies (fr + 7 trads) :
- 6 nouveaux namespaces (platformDash, tenantsPage, platformPlans, platformBilling, platformSupport, platformConfig, customerSupport, tenantScope)
- Correction d'un bug de namespace dupliqué qui cassait fr.ts

**Tests — 89 nouveaux** :
- 56 unit + 11 security + 18 e2e API + 37 Playwright

**Infrastructure** :
- Playwright complet (config, globalSetup, fixtures, 7 fichiers spec)
- seed-e2e.ts idempotent (SA + TENANT_ADMIN + plan + ticket fixtures)
- Scripts npm : `test:pw`, `test:pw:ui`, `test:pw:headed`, `test:pw:report`, `seed:e2e`

**Documentation** :
- Ce fichier `DOCUMENTATION_MULTI_TENANT.md`
- Mise à jour `Result_Secu_test.md` (132/132 pass)
- `test/playwright/README.md` (pré-requis + troubleshooting)

### 11.3 Delta chiffré

| Domaine | Avant | Après |
|---|---|---|
| Modèles Prisma | 120 | **128** (+8) |
| Modules backend | 55 | **60** (+5) |
| Pages frontend | ~50 (plateforme = stubs) | ~58 (plateforme fonctionnelle) |
| Permissions | ~80 | **~90** (+9) |
| Tests sécurité | 108 | **132** (+24) |
| Tests Playwright | 0 | **37** (+37) |
| i18n namespaces | ~100 | **~108** (+8) |
| Documentation | PRD + Tech Archi | **+ DOC_MULTI_TENANT** |

---

## 12. Troubleshooting

### 12.1 « Rate-limit 429 sur /sign-in »
Redis a accumulé les compteurs. Flush :
```bash
docker exec translog-redis redis-cli -a redis_password --no-auth-warning FLUSHDB
```

### 12.2 « Login échoué HTTP 400 — Sous-domaine tenant requis »
Tu fais un POST `/api/auth/sign-in` vers `localhost:3000` sans Host header d'un tenant. Soit :
- Utilise le subdomain (`http://trans-express.translog.test:5173`) et Vite proxy
- Soit force le header : `curl -H "Host: trans-express.translog.test" ...`

### 12.3 « Prisma db push dit que la DB est en sync mais les tables manquent »
Tu as changé le schéma mais pas régénéré le client :
```bash
npx prisma generate
```

### 12.4 « Les tests Playwright timeout sur getByLabel »
Les labels i18n ne sont pas résolus — le clé brute est affichée. Vérifie qu'il n'y a pas de duplication de namespace dans `fr.ts` :
```bash
grep -c '"platformDash"' frontend/lib/i18n/locales/fr.ts   # doit afficher 1
```

### 12.5 « RLS renvoie 0 lignes bien que mon user est authentifié »
- Vérifie que PgBouncer est en mode **SESSION** (pas TRANSACTION) : `docker logs translog-pgbouncer | grep -i pool_mode`
- Vérifie que `RlsMiddleware` s'exécute avant la requête Prisma (ordre dans `app.module.ts > configure()`)
- Vérifie en DB : `SELECT current_setting('app.tenant_id', true);`

### 12.6 « Bootstrap plateforme refuse avec 403 »
L'endpoint `POST /platform/bootstrap` est verrouillé dès qu'un SUPER_ADMIN existe. Pour réinitialiser en dev :
```sql
DELETE FROM users WHERE "tenantId" = '00000000-0000-0000-0000-000000000000' AND "roleId" IN (SELECT id FROM roles WHERE name = 'SUPER_ADMIN');
```

### 12.7 « Vault réclame auth alors que je suis en dev »
`docker-compose.yml` lance Vault en dev mode avec token `dev-root-token`. Exporte :
```bash
export VAULT_ADDR=http://localhost:8200
export VAULT_TOKEN=dev-root-token
```

### 12.8 « HMR Vite ne recharge pas après édit de fichier »
Vite a parfois un bug de watcher sur macOS. Redémarre :
```bash
./scripts/stop.sh
./scripts/dev.sh
```

### 12.9 Reset complet dev

```bash
./scripts/dev-down.sh --full    # drop volumes + certs + mkcert CA
./scripts/dev.sh                 # rebuild everything
```

---

## Changelog doc

| Date | Version | Changements |
|---|---|---|
| 2026-04-18 | 1.0 | Création initiale. Portail plateforme SaaS livré, tests Playwright en place, config DB-driven. |
