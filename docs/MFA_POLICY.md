# Politique MFA TransLog Pro — 2026-04-27

## Décision

| Acteur | MFA | Comportement UI | Désactivation |
|---|---|---|---|
| **Staff plateforme** (SUPER_ADMIN, SUPPORT_L1, SUPPORT_L2 — `tenantId = PLATFORM_TENANT_ID`) | **OBLIGATOIRE** | `mustEnrollMfa = true` → ProtectedRoute redirige bloquant vers `/account?tab=security` tant que MFA n'est pas activé | **INTERDITE** — `MfaService.disable()` retourne 403. Reset uniquement par un autre admin plateforme via `control.platform.mfa.reset.global` |
| **Staff tenant** (TENANT_ADMIN, AGENCY_MANAGER, CASHIER, DRIVER, STATION_AGENT, QUAI_AGENT) | **RECOMMANDÉ** | `suggestedEnrollMfa = true` → banner dismissible (7j) dans le dashboard + notification email + IN_APP au 1er signIn éligible | **AUTORISÉE** à tout moment (avec code TOTP/backup en confirmation) |
| **Customer** (`userType = 'CUSTOMER'`) | **HORS POLITIQUE** | Aucun flag, aucune notif, MFA disponible si l'utilisateur l'active manuellement | **AUTORISÉE** comme staff tenant |

## Justification

Avant 2026-04-27 : tout user avec une permission tenant haut-privilège (`control.iam.audit.tenant`, `control.iam.manage.tenant`, etc.) tombait sur `mustEnrollMfa = true` à sa 1re connexion → blocage immédiat sur `/account?tab=security`. Un nouveau tenant qui venait de signer ne pouvait même pas accéder à son onboarding sans avoir scanné un QR TOTP.

Cette friction était disproportionnée pour le **contexte africain centrale** (Congo, Cameroun, Gabon, Côte d'Ivoire…) où :
- Les utilisateurs n'ont pas tous une seconde appli (Google Authenticator) installée d'office
- L'apprentissage TOTP est une marche supplémentaire **avant** l'onboarding produit
- La friction d'1 minute supplémentaire au login se traduit empiriquement par 30%+ d'abandon

**On préserve la sécurité maximale là où elle est non-négociable** (staff plateforme, qui a accès cross-tenant) **et on suggère sans bloquer pour tout le reste**, avec une notification douce pour incitation. Un admin tenant compromis reste protégé par : password fort, rate-limit login, CAPTCHA adaptatif, audit log, session 24h, et la possibilité **immédiate** d'activer MFA par lui-même.

## Implémentation technique

### Modèle Prisma

`User.mfaSuggestionSentAt: DateTime?` — marqueur d'idempotence. Set à la date d'émission du 1er event `AUTH_MFA_SUGGESTED`. Empêche le spam multi-login.

### Backend

| Fichier | Rôle |
|---|---|
| [src/modules/auth/auth.service.ts](../src/modules/auth/auth.service.ts) `toDto()` | Calcule `mustEnrollMfa` (plateforme) vs `suggestedEnrollMfa` (autres staff) |
| [src/modules/auth/auth.service.ts](../src/modules/auth/auth.service.ts) `signIn()` | Appelle `mfa.maybeSendSuggestion(userId)` après succès auth (fire-and-forget) |
| [src/modules/mfa/mfa.service.ts](../src/modules/mfa/mfa.service.ts) `disable()` | Lance `ForbiddenException` si `tenantId === PLATFORM_TENANT_ID && userType === STAFF` |
| [src/modules/mfa/mfa.service.ts](../src/modules/mfa/mfa.service.ts) `maybeSendSuggestion()` | Idempotent (5 conditions) + marque `mfaSuggestionSentAt` AVANT d'émettre |
| [src/common/types/domain-event.type.ts](../src/common/types/domain-event.type.ts) | Nouveau event `AUTH_MFA_SUGGESTED = 'auth.mfa.suggested'` |
| [src/modules/notification/email-templates/auth-templates.ts](../src/modules/notification/email-templates/auth-templates.ts) | Template `auth.mfa.suggested` (fr+en) — ton positif "Sécurisez votre compte" |
| [src/modules/notification/auth-notification.listener.ts](../src/modules/notification/auth-notification.listener.ts) | Subscribe + fan-out EMAIL + IN_APP (les autres `AUTH_MFA_*` restent EMAIL only — alertes sécu) |

### Frontend

| Fichier | Rôle |
|---|---|
| [frontend/lib/auth/auth.context.tsx](../frontend/lib/auth/auth.context.tsx) | Type `AuthUser` enrichi : `suggestedEnrollMfa?: boolean` |
| [frontend/components/auth/ProtectedRoute.tsx](../frontend/components/auth/ProtectedRoute.tsx) | Inchangé — bloque uniquement sur `mustEnrollMfa` (logique plus stricte côté backend → moins de cas bloqués) |
| [frontend/components/auth/MfaSuggestionBanner.tsx](../frontend/components/auth/MfaSuggestionBanner.tsx) | **Nouveau** — banner dismissible 7j avec localStorage, affiché si `suggestedEnrollMfa` |
| [frontend/components/admin/AdminDashboard.tsx](../frontend/components/admin/AdminDashboard.tsx) | Intégré le banner sous `ImpersonationBanner` |
| [frontend/components/pages/PageAccount.tsx](../frontend/components/pages/PageAccount.tsx) | Alerte bleue "Recommandé" si `suggestedEnrollMfa`. Bouton "Désactiver MFA" caché si staff plateforme + libellé "verrou plateforme" affiché |

### Tests

| Suite | Verts | Couvre |
|---|---|---|
| [test/unit/auth/auth.service.mfa-policy.spec.ts](../test/unit/auth/auth.service.mfa-policy.spec.ts) | 6/6 | Matrice `(staff plateforme, staff tenant, customer) × (mfaEnabled true/false)` |
| [test/unit/mfa/mfa.service.spec.ts](../test/unit/mfa/mfa.service.spec.ts) | 18/18 | Setup, getStatus, regenerateBackupCodes + **disable verrou plateforme** + **maybeSendSuggestion (7 cas)** |
| [test/unit/auth/auth.service.mfa-signin.spec.ts](../test/unit/auth/auth.service.mfa-signin.spec.ts) | 2/2 | signIn flows mfaEnabled true/false (régression — mock enrichi avec `maybeSendSuggestion`) |

Total après refonte : **9 suites / 70 tests verts** sur `test/unit/auth/` + `test/unit/mfa/`.

## Migration des utilisateurs existants

**Stratégie lazy** — pas de backfill batch :

- Anciens TENANT_ADMIN qui avaient été bloqués sans avoir activé MFA → débloqués au prochain signIn (ProtectedRoute ne les redirige plus). Banner suggestion s'affiche. Notif email + IN_APP envoyée 1 fois.
- Anciens utilisateurs qui ont déjà MFA actif → aucun changement (continuent à se logger via challenge MFA, peuvent désactiver à volonté).
- Staff plateforme avec MFA actif → aucun changement (continuent normalement, désactivation interdite).
- Staff plateforme sans MFA actif → toujours bloqués sur `/account?tab=security` (politique inchangée pour ce tier).

## i18n

fr+en complets pour :
- `account.suggestedEnrollMfa` + `account.mfaPlatformLocked`
- `mfa.suggestion.{aria,title,body,cta,dismiss}`

6 autres locales (es, pt, ar, wo, ln, ktu) en TODO documenté dans [TODO_i18n_propagation.md](TODO_i18n_propagation.md).

## Évolutions futures envisagées

- **Grace period optionnelle** — re-bloquer un user après N jours non-activation. Pas implémentée v1 (décision UX : "suggérer sans bloquer"). Activable en ajoutant une clé `PlatformConfig` `mfa.gracePeriodDays` (0 = désactivé) + cron qui flippe `suggestedEnrollMfa → mustEnrollMfa` au passage du seuil.
- **Politique configurable par tenant** — un tenant pourrait imposer MFA à tous ses staff. Ajout d'un champ `Tenant.mfaPolicy = 'optional' | 'required-after-days' | 'required'`. Impact : modifier `toDto()` pour respecter la config par tenant.
- **Méthodes alternatives** — SMS, WebAuthn (clés FIDO2), biométrie. Aujourd'hui seul TOTP est supporté.
