# Sécurité des endpoints publics — check-list & architecture

> Tout endpoint public (anonyme, accessible sans auth) DOIT passer la check-list
> ci-dessous. 8 verrous minimum, aucun "à faire ensuite". Cette règle est
> absolue — cf. [CLAUDE.md](../CLAUDE.md) "Security first strict".

---

## 1. Check-list obligatoire (8 verrous)

| # | Verrou | Couche | Statut |
|---|---|---|---|
| 1 | **CAPTCHA Cloudflare Turnstile** | `TurnstileGuard` + `@RequireCaptcha()` | ✅ |
| 2 | **Rate limit par IP** | `RedisRateLimitGuard` + `@RateLimit({ keyBy: 'ip' })` | ✅ |
| 3 | **Rate limit par phone** | `@RateLimit({ keyBy: 'phone', phonePath: '...' })` | ✅ |
| 4 | **DTO strict + E.164** | `class-validator` + `@IsE164Phone()` | ✅ |
| 5 | **Cooldown phone** (24h par défaut) sur émission magic link | `CustomerClaimService` | ✅ |
| 6 | **Budget SMS/jour tenant** (200 par défaut) | `CustomerClaimService` | ✅ |
| 7 | **Idempotency-Key** obligatoire sur POST | `IdempotencyGuard` + `@Idempotent()` | ✅ |
| 8 | **phoneVerified gating** sur bumpCounters CRM | `CustomerResolverService.bumpCounters({ source })` | ✅ |

---

## 2. Endpoints publics couverts

| Endpoint | IP | Phone | CAPTCHA | Idempotency | Verrous additionnels |
|---|---|---|---|---|---|
| `POST /api/public/:slug/portal/booking` | 10/h | 3/h/phone | ✅ | ✅ 24h | cooldown 24h/phone sur magic link |
| `POST /api/public/:slug/portal/parcel-pickup-request` | 5/h | 3/h/phone | ✅ | ✅ 24h | idem |
| `POST /api/public/:slug/portal/tickets/:ref/cancel` | 5/h | — | ✅ | ✅ 24h | — |
| `POST /api/public/signup` (création tenant SaaS + admin) | 3/h | — | ✅ | ✅ 24h | honeypot DTO `company_website` |
| `POST /api/public/waitlist` | 5/h | — | ✅ | — | honeypot |
| `POST /api/auth/sign-in` | 5/15min prod | — | **adaptatif** | — | anti-énumération (même message "Identifiants invalides") + bcrypt timing-safe + CAPTCHA déclenché après 3 échecs (IP OU email/15min) |
| `POST /api/auth/password-reset/request` | 3/h | — | ✅ | — | cooldown 60min/email (skip si token actif émis < 60min) |
| `POST /api/public/:tenantId/report` | 5/h | — | ✅ | — | RGPD TTL 24h |
| `POST /api/public/report` (host-resolved) | 5/h | — | ✅ | — | idem |
| `POST /api/tenants/:id/customer/claim/initiate` (retro OTP) | 3/h | 3/24h/phone | ✅ | — | auth CUSTOMER requis |
| `POST /api/tenants/:id/customer/claim/confirm` | 10/h (throttler) | — | — | — | auth CUSTOMER + 5 tentatives OTP max |

---

## 3. Architecture

### 3.1 CAPTCHA — Cloudflare Turnstile

**Pourquoi Turnstile plutôt que hCAPTCHA/reCAPTCHA** : gratuit, pas de cookies tiers, pas de collecte PII, performant en Afrique (Cloudflare CDN).

**Systématique vs adaptatif — règle de décision** :
- **Systématique** (`@RequireCaptcha()`) pour les endpoints **rares/critiques** : signup tenant, password-reset, waitlist, booking ticket, demande colis, signalement. Un user légitime les utilise < 1 fois/semaine → friction CAPTCHA acceptable.
- **Adaptatif** (logique service) pour les endpoints **fréquents** : login. Compteur Redis d'échecs par IP ET par email sur 15 min glissantes. CAPTCHA exigé seulement après ≥ 3 échecs. Succès → reset. Aligné NIST SP 800-63B + OWASP ASVS V2.2.1 + OWASP Credential Stuffing Cheat Sheet (CAPTCHA comme "secondary defense, after suspicious activity — not always").

Un user normal qui se connecte du premier coup **ne voit jamais le widget**. Seul un credential-stuffer / brute-forcer est confronté à partir de la 4e tentative. Le compteur par email protège contre la rotation d'IP.

**Provisioning** :
```bash
vault kv put secret/platform/captcha/turnstile \
  SECRET_KEY="0x1234...ABCD"     # secret key Cloudflare
```

**Per-tenant** : `TenantBusinessConfig.captchaEnabled` (défaut `false`). Permet d'activer progressivement le CAPTCHA tenant par tenant. Quand `false` → le Guard laisse passer (feature flag OFF).

**Dev local** : pas de secret Vault → `TurnstileGuard` fail-open avec `log.warn`. Le dev peut continuer sans compte Cloudflare.

**Frontend** :
- Hook : [`frontend/lib/captcha/useTurnstile.ts`](../frontend/lib/captcha/useTurnstile.ts)
- Widget : [`frontend/components/ui/CaptchaWidget.tsx`](../frontend/components/ui/CaptchaWidget.tsx)
- Env : `VITE_TURNSTILE_SITE_KEY` (site-key publique, sans secret)
- Intégré au portail voyageur sur **booking** + **parcel pickup** (cf. [PortailVoyageur.tsx](../frontend/components/portail-voyageur/PortailVoyageur.tsx))

### 3.2 Rate limit sliding window

[`RedisRateLimitGuard`](../src/common/guards/redis-rate-limit.guard.ts) — ZSET Redis, sliding window ms-precise. Fail-open sur Redis down (timeout 2s).

**Support multi-dimension (2026-04-20)** : `@RateLimit([...])` accepte un tableau. Toutes les dimensions doivent passer (AND). Exemple :
```ts
@RateLimit([
  { limit: 10, windowMs: 3600_000, keyBy: 'ip',    suffix: 'portal_booking' },
  { limit: 3,  windowMs: 3600_000, keyBy: 'phone', suffix: 'portal_booking_phone',
    phonePath: 'passengers[].phone' },
])
```

**keyBy='phone'** : extrait les phones du body via `phonePath` (dot-notation, `[]` pour tableaux, virgule pour multiples). Chaque phone est rate-limité indépendamment — un attaquant ne peut pas flood un phone tiers en variant les IP.

### 3.3 Idempotency-Key

[`IdempotencyGuard` + `IdempotencyInterceptor`](../src/common/idempotency/idempotency.guard.ts)

Client envoie `Idempotency-Key: <uuid>` (format `/^[A-Za-z0-9_-]{8,64}$/`).
- 1ère requête : `SETNX pending` + exécution + cache réponse (TTL 24h).
- 2e requête avec même clé + réponse cachée → renvoie la réponse (200).
- 2e requête avec même clé + encore pending → 409 (concurrent double-submit).
- Pas de header → opt-in, laisse passer (recommandé mais non forcé).

### 3.4 Cooldown phone + budget tenant (magic link)

[`CustomerClaimService.issueToken`](../src/modules/crm/customer-claim.service.ts)

Avant d'émettre un magic link :
1. **Cooldown par phone** — requête `CustomerClaimToken.findFirst` sur `createdAt >= now - cooldownHours`. Si trouvé → skip (`null`) + log warn.
2. **Budget tenant/jour** — `CustomerClaimToken.count({ createdAt >= startOfDayUTC })`. Si ≥ budget → skip + log warn.

Config : `TenantBusinessConfig.dailyMagicLinkBudget` (200), `magicLinkPhoneCooldownHours` (24). Fallback si config absente.

### 3.5 phoneVerified gating CRM

[`CustomerResolverService.bumpCounters`](../src/modules/crm/customer-resolver.service.ts)

Ajout `opts.source: 'PUBLIC' | 'AGENT'` :
- **PUBLIC** + Customer.phoneE164 présent + phoneVerified=false → **SKIP** counters (anti-pollution CRM). `lastSeenAt` toujours touché.
- **PUBLIC** + phoneE164=null (email-only) → bump normal (pas de surface phone).
- **AGENT** (guichet/caisse/parcel register) → bump + flip `phoneVerified=true, phoneVerifiedVia='AGENT_IN_PERSON'` (identité en présentiel).
- Flip `phoneVerified=true` aussi sur `completeToken` (magic link) et retro-claim OTP (via `phoneVerifiedVia: 'MAGIC_LINK' | 'RETRO_CLAIM'`).

Conséquence : les totals et les segments CRM reflètent uniquement les clients authentifiés (ou confirmés en présentiel). Un attaquant ne peut plus polluer les segments VIP/FREQUENT d'un phone tiers via bookings publics.

### 3.6 @IsE164Phone validator

[`src/common/validators/is-e164-phone.validator.ts`](../src/common/validators/is-e164-phone.validator.ts)

Délègue à [`phone.helper.ts`](../src/common/helpers/phone.helper.ts) — normalise en E.164 via la table pays (CG, SN, CI, FR…). Rejette garbage, formats inconnus, trop courts/longs.

Appliqué sur :
- `CreateBookingDto.passengers[].phone`
- `CreateParcelPickupRequestDto.senderPhone` + `recipientPhone`
- `InitiateRetroDto.phone` (retro-claim)

---

## 4. Threat model résiduel

| Menace | Mitigation | Statut |
|---|---|---|
| Spam SMS magic link via phone tiers | cooldown 24h/phone + budget tenant + rate-limit 3/h/phone + CAPTCHA | ✅ verrouillé |
| Pollution CRM par phone d'autrui | `phoneVerified` gating + flip manuel agent | ✅ verrouillé |
| Seat griefing (bloquer 80 sièges 15min) | rate-limit 10/h/IP + 3/h/phone + expiry PENDING_PAYMENT 15min | ✅ bordé |
| Double-submit (2 bookings identiques) | Idempotency-Key + `prisma.transact` | ✅ verrouillé |
| Énumération tracking codes | `trackingCode = prefix-base36-4chars` ≈ 4M combos + rate 30/min/IP | ✅ acceptable |
| Bruteforce retro-claim OTP | 5 tentatives max + 3/h/IP + 3/24h/phone + CAPTCHA | ✅ verrouillé |
| DDoS via SSE annonces | auth `stats.read.tenant` requis ; polling public 30s/IP | ⚠️ review si trafic élevé |

---

## 5. Activation en prod — ordre recommandé

1. **Cloudflare** : créer site + secret key Turnstile → `vault kv put secret/platform/captcha/turnstile SECRET_KEY=...`
2. **Frontend** : déployer avec `VITE_TURNSTILE_SITE_KEY` dans `.env.production`
3. **Par tenant** : activer `captchaEnabled=true` via `/admin/settings/rules` (une fois le site Cloudflare validé)
4. **Ajuster budget** : `dailyMagicLinkBudget` selon volumétrie tenant (défaut 200 = 6k SMS/mois)
5. **Monitoring** : grep `[CustomerClaim] cooldown hit` et `[CustomerClaim] daily budget exhausted` dans les logs — pics = attaque ou config trop basse
6. **Audit** : exporter les Customers `phoneVerified=false` créés via `source='PUBLIC'` pour revue manuelle (cron mensuel)

---

## 6. Tests

- [`test/unit/common/is-e164-phone.validator.spec.ts`](../test/unit/common/is-e164-phone.validator.spec.ts) — 6 tests
- [`test/unit/common/turnstile.guard.spec.ts`](../test/unit/common/turnstile.guard.spec.ts) — 6 tests
- [`test/unit/common/idempotency.guard.spec.ts`](../test/unit/common/idempotency.guard.spec.ts) — 5 tests
- [`test/unit/crm/claim-cooldown-budget.spec.ts`](../test/unit/crm/claim-cooldown-budget.spec.ts) — 5 tests
- [`test/unit/crm/bump-counters-phone-verified.spec.ts`](../test/unit/crm/bump-counters-phone-verified.spec.ts) — 5 tests
- [`test/unit/password-reset/email-cooldown.spec.ts`](../test/unit/password-reset/email-cooldown.spec.ts) — 4 tests
- [`test/unit/auth/signin-adaptive-captcha.spec.ts`](../test/unit/auth/signin-adaptive-captcha.spec.ts) — 6 tests (CAPTCHA adaptatif login : 0/3/6 échecs, IP vs email, fail-open)

**Total : 37 nouveaux tests unit — 829/829 PASS.**
