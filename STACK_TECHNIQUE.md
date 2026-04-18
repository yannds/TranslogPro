# TransLog Pro — Stack technique

> Référence vivante de l'architecture, des dépendances et des flux critiques.
> Priorité absolue : **sécurité**, **i18n 8 locales**, **WCAG AA**, **dark/light**, **responsive**, **DRY**, **zéro magic number**.

---

## 1. Vue d'ensemble

```
┌─────────────────────────────┐        ┌───────────────────────────┐
│  Frontend Vite + React      │◀──────▶│  Backend NestJS 10        │
│  (tenant-scoped par host)   │        │  (modules métier)         │
└──────────────┬──────────────┘        └──────────────┬────────────┘
               │                                      │
               ▼                                      ▼
┌─────────────────────────────┐        ┌───────────────────────────┐
│  Caddy + TLS on-demand      │        │  PostgreSQL 16 (Prisma)   │
│  wildcard *.translogpro.com │        │  Redis (cache, queues)    │
└─────────────────────────────┘        └──────────────┬────────────┘
                                                      │
                                                      ▼
                                       ┌──────────────────────────────┐
                                       │  HashiCorp Vault (KV v2 + PKI)│
                                       │  – secrets par provider       │
                                       │  – clé chiffrement payloads   │
                                       │  – certificats mTLS internes  │
                                       └──────────────────────────────┘
```

## 2. Backend (NestJS 10)

### 2.1 Couches
| Couche | Emplacement | Rôle |
|---|---|---|
| Infrastructure | `src/infrastructure/` | Prisma, Vault, notifications, paiement, storage |
| Core engines | `src/core/` | IAM, workflow, tenancy, pricing, billing (pure functions) |
| Modules métier | `src/modules/` | Ticketing, parcel, CRM, fleet, ... |

### 2.2 Multi-tenant isolation
- Middleware `TenantHostMiddleware` : résout le sous-domaine → `tenantId`.
- `TenantIsolationGuard` : injecte `tenantId` dans chaque requête.
- PostgreSQL RLS sur les tables critiques (voir `infra/sql/03-multi-tenant-isolation-phase1.sql`).
- Test E2E : aucune requête ne renvoie jamais de données d'un autre tenant.

### 2.3 Sécurité transverse
- CSP / HSTS / X-Frame-Options via Helmet.
- Cookies session httpOnly + `SameSite=Lax` + rotation 30 min.
- Password reset : token SHA-256 stocké (jamais en clair), TTL 30 min.
- MFA TOTP via `speakeasy`.
- Rate limiting global (ThrottlerModule) + par route sensible.
- Audit log append-only (`src/core/workflow/audit.service.ts`).

## 3. Domaine Paiement & Facturation

### 3.1 Modèle canonique (Prisma)

```
PaymentIntent  ─┬─ idempotencyKey (tenant-unique, header client)
                ├─ subtotal / taxBreakdown / amount (TTC)
                ├─ expiresAt (TenantPaymentConfig.intentTtlMinutes)
                └─ attempts : PaymentAttempt[]
                      ├─ providerKey ('mtn_momo_cg', 'airtel_cg', ...)
                      ├─ externalRef  (unique par provider)
                      ├─ requestEnc / responseEnc  (AES-256-GCM, clé Vault)
                      └─ events : PaymentEvent[]     (append-only)

PaymentProviderState    : mode DISABLED|SANDBOX|LIVE par (tenant, providerKey)
TenantTax               : N taxes empilables, cascade SUBTOTAL / TOTAL_AFTER_PREVIOUS
TenantPaymentConfig     : toutes les constantes paiement tenant
PlatformPaymentConfig   : singleton plateforme
```

### 3.2 Connecteurs (pattern registry + port)

Tous dans `src/infrastructure/payment/providers/` :
| Clé provider | Méthodes | Pays | Refund |
|---|---|---|---|
| `mtn_momo_cg` | Mobile Money | CG | Disbursement |
| `airtel_cg` | Mobile Money | CG | Disbursement (push) |
| `wave` | Mobile Money | SN/CI/ML/BF | Native refund endpoint |
| `flutterwave_agg` | MoMo + Card + Transfer + USSD | 11 pays sub-saharien | Native |
| `paystack_agg` | Card + MoMo | NG/GH/KE/ZA | Native |
| `stripe_cards` | Card | FR/UE/US/CA/UK | Native (non activé en Afrique) |

Architecture :
```
src/infrastructure/payment/
  providers/
    types.ts                       # IPaymentProvider + PAYMENT_PROVIDERS token
    mtn-momo-cg.provider.ts        # Collection + Disbursement MTN
    airtel-cg.provider.ts          # Airtel Africa OpenAPI
    wave.provider.ts               # Wave Business API
    flutterwave-agg.provider.ts
    paystack-agg.provider.ts
  interfaces/payment.interface.ts  # IPaymentService (port historique)
  payment-provider.registry.ts     # inventaire + état DB effective
  payment-router.service.ts        # tenant config → provider à utiliser
  payment-orchestrator.service.ts  # API unique createIntent/confirm/refund
  payment-webhook.controller.ts    # POST /webhooks/payments/:providerKey
  payment-reconciliation.service.ts # cron 10 min
  payload-encryptor.service.ts     # AES-256-GCM
```

### 3.3 Flux createIntent (métier)
1. Le module métier appelle `orchestrator.createIntent(tenantId, { subtotal, method, idempotencyKey, ... })`.
2. Idempotency check `(tenantId, idempotencyKey)` — rejeu sûr.
3. `TaxCalculatorService.computeTaxes` lit `TenantTax`, applique cascade → subtotal + taxes → total TTC.
4. `PaymentRouter.resolve` : choisit provider via `TenantPaymentConfig.defaultProviderByMethod` → `fallbackChainByMethod` → scan global (`supports` + `mode != DISABLED`).
5. Transaction Prisma : crée `PaymentIntent` + `PaymentAttempt` + events `INTENT_CREATED` / `ATTEMPT_STARTED`.
6. `provider.initiate()` (hors TX). Erreur → attempt FAILED + event ERROR.
7. Update attempt avec `externalRef`, `paymentUrl`, `requestEnc` / `responseEnc` chiffrés.

### 3.4 Vault layout
```
secret/
  platform/payments/
    app-key                      { KEY (32 octets hex) }
    mtn_momo_cg                  { COLLECTION_*, DISBURSEMENT_*, TARGET_ENVIRONMENT, WEBHOOK_HMAC_KEY }
    airtel_cg                    { CLIENT_ID, CLIENT_SECRET, X_COUNTRY, X_CURRENCY, WEBHOOK_HMAC_KEY }
    wave                         { API_KEY, WEBHOOK_SECRET }
    flutterwave_agg              { SECRET_KEY, WEBHOOK_HASH }
    paystack_agg                 { SECRET_KEY }
    stripe_cards                 { SECRET_KEY, WEBHOOK_SECRET, PUBLISHABLE_KEY }
  platform/oauth/
    google                       { CLIENT_ID, CLIENT_SECRET }
    microsoft                    { CLIENT_ID, CLIENT_SECRET, TENANT_ID }
    facebook                     { APP_ID, APP_SECRET }
```
Rotation : tout provider invalide son cache au prochain `getSecrets()`.

### 3.5 Webhooks
- `POST /webhooks/payments/:providerKey` — raw-body activé via `NestFactory({ rawBody: true })`.
- Signature lue via `provider.webhookSignatureHeader` (ex `verif-hash`, `x-mtn-signature`, `wave-signature`).
- HMAC temps constant (`crypto.timingSafeEqual`), rejet 401 en cas de mismatch.
- Throttle 60 req/min/IP.
- 200 systématique après vérification pour éviter les retries agressifs — orphans rattrapés par la réconciliation.

### 3.6 Réconciliation
Cron `EVERY_10_MINUTES` désactivable via `PlatformPaymentConfig.reconciliationCronEnabled` :
1. `expirePast()` : Intent `CREATED|PROCESSING` avec `expiresAt < now` → `EXPIRED`.
2. `reconcileStale(lagMin)` : Intent bloqués depuis > lagMin → `provider.verify()` → `applyWebhook`.

## 4. Frontend (React 19 + Vite)

### 4.1 Arborescence
```
frontend/
  components/
    payment/
      PaymentMethodPicker.tsx    # radio-cards par type (MOBILE_MONEY/CARD/...)
      PaymentFlowDialog.tsx      # modale orchestrant le parcours
      usePaymentIntent.ts        # hook polling /confirm
    pages/
      PageTenantTaxes.tsx        # CRUD TenantTax
      PageTenantPayment.tsx      # GET/PATCH TenantPaymentConfig
      PageIntegrations.tsx       # Intégrations API (remplace PageWip)
  lib/
    i18n/locales/{fr,en,ln,ktu,ar,pt,es,wo}.ts   # 8 locales, fallback fr
    api.ts                       # apiGet/apiPost/apiPatch/apiDelete
```

### 4.2 Règles qualité
- **WCAG AA** : rôles sémantiques, focus visible (ring), aria-describedby.
- **i18n obligatoire** : `t('namespace.key')` — clés définies dans `fr.ts`, fallback fr pour les autres locales.
- **Dark/Light** : chaque classe Tailwind a son variant `dark:`.
- **Responsive** : desktop-first pour le back-office (`lg:` multi-colonnes, `max-w-4xl+` sur modales riches).
- **DataTableMaster** obligatoire pour les listes/tables métier.
- **Aucun secret côté front** : intégrations montrent uniquement des empreintes tronquées et dates de rotation.

## 5. Tests

| Suite | Commande | Couvre |
|---|---|---|
| Unit | `npx jest --config jest.unit.config.ts` | Services purs, providers mockés (axios / prisma / secret) |
| Intégration | `npm run test:integration` | Testcontainers PostgreSQL + Redis |
| Sécurité | `npm run test:security` | HMAC, multi-tenant isolation, brute-force, CSS injection, RLS |
| E2E | `npm run test:e2e` | NestJS supertest full-stack |
| Playwright | `npx playwright test` | Parcours utilisateur réel (paiement, settings, intégrations) |

### 5.1 Suites de paiement
- `test/unit/billing/tax-calculator.spec.ts` — 16 tests
- `test/unit/payment/payment-router.spec.ts` — 8 tests
- `test/unit/payment/payment-orchestrator.spec.ts` — 13 tests
- `test/unit/payment/payment-webhook.spec.ts` — 7 tests
- `test/unit/payment/payload-encryptor.spec.ts` — 8 tests
- `test/unit/payment/providers-cg.spec.ts` — 11 tests (MTN/Airtel/Wave)
- `test/unit/payment/payment-reconciliation.spec.ts` — 9 tests

## 6. Dépendances clés

| Lib | Version | Usage |
|---|---|---|
| `@nestjs/core` | 10.x | Framework backend |
| `@nestjs/schedule` | — | Cron jobs (réconciliation, quotas) |
| `@nestjs/throttler` | — | Rate-limit global |
| `prisma` + `@prisma/client` | 5.22 | ORM |
| `node-vault` | — | Client Vault |
| `axios` | — | HTTP client providers |
| `@playwright/test` | 1.59 | E2E réel |
| `jest` + `testcontainers` | — | Tests unit/integration |
| `react` | 19 | UI |
| `vite` | — | Bundler frontend |
| `tailwindcss` | — | Styling dark/light |
| `lucide-react` | — | Icônes |
| `@radix-ui/*` | — | Primitives accessibles (Dialog, Tabs, Checkbox) |

## 7. Règles d'or transversales

1. **Aucun magic number** dans le code métier : tout remonte de `TenantBusinessConfig`, `TenantPaymentConfig`, `PlatformPaymentConfig`, `TenantTax`, `PaymentProviderState`, `PaymentMethodConfig`, ou Vault.
2. **Aucun import direct de SDK tiers** hors du dossier `providers/` concerné.
3. **tenantId condition racine** de TOUTE requête Prisma (même lecture).
4. **Aucun secret en `process.env`** : Vault uniquement, caché 5 min.
5. **Append-only sur les events** (paiement, audit) — jamais d'UPDATE/DELETE.
6. **HMAC temps constant** pour toute vérification de signature.
7. **Intégrations UI** : jamais la valeur d'un secret — uniquement empreinte + date de rotation.
