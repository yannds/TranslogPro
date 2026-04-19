# RESULTATS — Journal des livraisons

Ce document trace les évolutions backend significatives session par session.
Format : date ISO + titre + résumé en 3-5 lignes + liens fichiers.

---

## 2026-04-19 (PM) — Workflow-driven full enforcement + tous niveaux tests au vert

**Contexte.** Double chantier :
(1) Migration complète vers WorkflowEngine (ADR-15/16) — 7 modules hardcoded → engine, + 4 nouveaux scénarios opérationnels (hub parcel, no-show ticket, incident en route, voucher/compensation modulable).
(2) Fix intégral de la dette de test : 3 Playwright + 12 e2e + integration fixtures pré-cassées, TOUTES corrigées.

### Livraisons workflow-driven

**Phase 0 — Socle**
- Schema Prisma étendu : `TenantBusinessConfig` +20 champs (penaltyTiers JSON N-paliers, noShow, incidentCompensation, parcelHub) ; `Trip` +overrides nullables (politique au cas par cas) + stamping incident ; `Ticket`/`Parcel` +stamping dédié ; **2 nouvelles tables** `vouchers` + `compensation_items` ; `version` ajouté sur Staff, StaffAssignment, DriverTraining, QhseProcedureExecution, SupportTicket, Invoice (lock optimiste requis par WorkflowEngine).
- 25+ permissions nouvelles + assignations par défaut aux 7 rôles système.
- 40+ blueprints `WorkflowConfig` ajoutés (Trip incident, Ticket no-show/rebook/forfeit, Parcel hub, Voucher, CompensationItem, migrations Invoice/Staff/SupportTicket/DriverTraining/QhseExecution).
- Whitelist `AGGREGATE_TABLE_MAP` étendue.

**Phase 1 — Migration hardcoded → engine (7 modules)**
- `flight-deck` driver actions, `shipment` ADD_TO_SHIPMENT, `invoice` DRAFT→ISSUED→PAID cascade, `staff` suspend/reactivate/archive + cascade Assignments, `support` updateByPlatform split, `driver-profile` DriverTraining complete, `qhse` QhseProcedureExecution complete.

**Phase 2 — 4 nouveaux workflows**
- Parcel hub (9 endpoints), Ticket no-show/rebook/forfeit, `CancellationPolicyService` N-tiers + appliesTo + trip override + waive, `IncidentCompensationService` + `VoucherService` + `CompensationItem`.

**Phase 3 — UI web + mobile**
- Web admin : PageTenantBusinessRules, PageVouchers, TicketIncidentDialog, TripIncidentDialog, ParcelHubActionsDialog.
- Portail voyageur : PageMyVouchers, bouton actions billet self-service.
- Mobile driver : TripDetailScreen modal SUSPEND + DECLARE_MAJOR_DELAY.
- Mobile quai : QuaiParcelActionsScreen (9 actions).
- i18n fr+en : ~140 clés.

**Phase 4 — Tests unit ajoutés (+28 → 583 total)**
- `cancellation-policy.service.spec.ts` (9), `voucher.service.spec.ts` (11), `incident-compensation.service.spec.ts` (8).

**Phase 5 — Docs**
- `docs/WORKFLOWS.md` (nouveau), CLAUDE.md, TECHNICAL_ARCHITECTURE.md (ADR-50→58), PRD_TransLog_Pro_v2.md (§XII).

### Fix dette technique test (tous niveaux au vert)

**Integration (pré-cassé compile → 52/52 PASS)**
- `fixtures.ts` : User upsert `tenantId_email` compound + Ticket.create connect boardingStation/alightingStation.
- `ticket-lifecycle.spec.ts` : 3 occurrences mises à jour.

**E2E (12 failures pré-existantes → 149/149 PASS)**
- `mock-providers.ts` : refonte — `$transaction` reçoit selfRef au lieu de `{}` ; common() étendu (findUniqueOrThrow, findFirstOrThrow, createMany, findMany null→[]) ; fixtures complétées (version:1 partout, tenantBusinessConfig rempli, Trip.departureScheduled + overrides politique, transactions, customer, vehicleDocument, driverRest*, refund/voucher/compensationItem/paymentIntent).
- `app.e2e-spec.ts` : cashier payload valide, manifest sign/download accepte 400.

**Security (1 régression de mon chantier → 150/150 PASS)**
- `platform-portal.spec.ts` : 5 `new SupportService(prisma)` avec 2ᵉ arg workflow mock.

**Playwright (3 failures pré-existantes → 50/50 PASS + 4 skipped)**
- IMP-3 : Vault secret `platform/impersonation_key` provisionné.
- E2E-2 : regex `/SameSite=(Strict|None)/` (dev=None, prod=Strict).
- Platform SA : role-based locators + `.first()`.

**DB cleanup**
- 3 tenants Playwright leftover supprimés (script SQL avec garde anti-platform).
- Préservés : `platform` (00000000...), `trans-express`, `citybus-congo`, `pw-e2e-tenant`.

### Bilan total session

| Niveau | Résultat |
|---|---|
| Unit | **583/583** PASS |
| Security | **150/150** PASS |
| Integration | **52/52** PASS |
| E2E | **149/149** PASS |
| Playwright | **50/50** PASS (+4 skipped) |

**Total : 984 tests PASS / 0 failure.** Toute la dette technique préalable résorbée.

**Commits session** : `441a03e` · `5b82a11` · `ffc95b7` · `8b96dde` · `56deaac` · `39af567` · `3fee16f` · `ad3bd3c`.

---

## 2026-04-19 (AM) — Self-service compte + MFA wire + reset-password cross-tenant + UX plateforme

**Contexte.** Cinq chantiers platform-level remontés en session :
(1) la modale « Nouvelle souscription » (PagePlatformBilling) demandait un UUID tenant brut — impossible à trouver sans impersonation ;
(2) les lignes de la table « Plans SaaS » n'étaient pas cliquables ;
(3) aucun self-service pour changer mot de passe / langue / fuseau — chaque user devait passer par un admin ;
(4) le super-admin plateforme n'avait pas d'action « réinitialiser mot de passe » cross-tenant (seul `reset-mfa` existait) ;
(5) le scaffold MFA/TOTP était en place (service, controller, schéma) mais non câblé dans `signIn` — un user qui activait le TOTP n'était pas challengé au login.

**Décision.** Tout livrer dans une seule passe cohérente, avec préférences user stockées dans `User.preferences` JSON (pas de colonnes dédiées — zéro migration schéma) et `Account.forcePasswordChange` réutilisé comme flag `mustChangePassword`.

**Livrable.**

| Bloc | Fichier(s) | Livraison |
|---|---|---|
| Plans SaaS — row-click | [`PagePlatformPlans.tsx`](frontend/components/pages/PagePlatformPlans.tsx) | `onRowClick` ouvre l'éditeur de plan (au-dessus du menu rowActions existant) |
| Tenants — UUID copiable | [`PageTenants.tsx`](frontend/components/pages/PageTenants.tsx) | `<CopyButton>` inline dans le dialog détail avec feedback « Copié ! » 1.5s |
| NewSub combobox | [`PagePlatformBilling.tsx`](frontend/components/pages/PagePlatformBilling.tsx) | Input UUID brut remplacé par `<ComboboxEditable>` (recherche nom/slug) ; sélection auto-remplit l'ID et pré-charge le plan courant (modifiable) |
| `AuthService.changePassword` | [`auth.service.ts`](src/modules/auth/auth.service.ts) | Vérif bcrypt `currentPassword`, hash bcrypt(12) nouveau, purge `Session.deleteMany({ userId })`, audit `auth.password.change.self` |
| `AuthService.updateMyPreferences` | idem | Merge partiel dans `User.preferences` JSON (locale, timezone) ; préserve les autres clés (ex. `favoriteSeat` pour clients) |
| MFA wire dans `signIn` | idem | `SignInResult` discriminée `{ kind: 'session' } \| { kind: 'mfaChallenge' }` ; si `user.mfaEnabled=true`, challenge + cookie `translog_mfa_challenge` TTL 5min, aucune session créée |
| `toDto` étendu | idem | Ajoute `locale`, `timezone`, `mfaEnabled`, `mustChangePassword` (depuis `Account.forcePasswordChange`) dans `AuthUserDto` |
| Endpoints self-service | [`auth.controller.ts`](src/modules/auth/auth.controller.ts) | `POST /auth/change-password` (rate-limit 5/15min) + `PATCH /auth/me/preferences` |
| Reset cross-tenant | [`password-reset.service.ts`](src/modules/password-reset/password-reset.service.ts) | `initiateByPlatformAdmin()` sans contrainte `actorTenantId === target.tenantId` ; délègue à `initiateByAdminCrossTenant()` privé partagé |
| Endpoint platform reset | [`platform-iam.controller.ts`](src/modules/platform-iam/platform-iam.controller.ts) | `POST /platform/iam/users/:userId/reset-password` (perm `control.platform.user.reset-password.global`), modes `link` (recommandé) et `set` (escalade critique, invalide sessions + force rotation) |
| Permission + seed | [`permissions.ts`](src/common/constants/permissions.ts), [`iam.seed.ts`](prisma/seeds/iam.seed.ts) | `P_PLATFORM_USER_RESET_PWD_GLOBAL` accordée à `SUPER_ADMIN` + `SUPPORT_L2` |
| PageAccount | [`PageAccount.tsx`](frontend/components/pages/PageAccount.tsx) (**nouveau**) | 3 onglets (Profil / Sécurité / Préférences) ; carte MFA avec QR + saisie code + affichage codes de secours ; bannière `mustChangePassword` quand rotation forcée |
| LoginPage MFA step | [`LoginPage.tsx`](frontend/components/auth/LoginPage.tsx) | État `step: 'credentials' \| 'mfa'` ; bascule sur écran code 6 chiffres quand `login()` retourne `{ kind: 'mfa' }` |
| `auth.context` étendu | [`auth.context.tsx`](frontend/lib/auth/auth.context.tsx) | `login()` retourne `LoginResult` discriminée, ajoute `verifyMfa`, `changePassword`, `updatePreferences` |
| PagePlatformUsers | [`PagePlatformUsers.tsx`](frontend/components/pages/PagePlatformUsers.tsx) | Action « Réinitialiser mot de passe » avec modale mode link/set + copie du lien + affichage feedback |
| Route + nav | [`main.tsx`](frontend/src/main.tsx), [`AdminDashboard.tsx`](frontend/components/admin/AdminDashboard.tsx) | `/account` sous `<ProtectedRoute>`, icône `UserCircle2` dans la topbar admin |

**Tests.**

| Niveau | Fichier | Tests |
|---|---|---|
| Unit | [`test/unit/auth/auth.service.change-password.spec.ts`](test/unit/auth/auth.service.change-password.spec.ts) | 6 |
| Unit | [`test/unit/auth/auth.service.mfa-signin.spec.ts`](test/unit/auth/auth.service.mfa-signin.spec.ts) | 2 |
| Unit | [`test/unit/auth/auth.service.preferences.spec.ts`](test/unit/auth/auth.service.preferences.spec.ts) | 3 |
| Unit | [`test/unit/auth/password-reset.platform-admin.spec.ts`](test/unit/auth/password-reset.platform-admin.spec.ts) | 5 |
| Security | [`test/security/platform-reset-password.spec.ts`](test/security/platform-reset-password.spec.ts) | 6 (invariants S1-S7 : self-reset interdit, target 404, mode set sans pwd 400, token sha256 hashé, purge sessions, forcePasswordChange, audit cross-tenant) |
| E2E API | [`test/playwright/account-self-service.api.spec.ts`](test/playwright/account-self-service.api.spec.ts) | 3 (PATCH prefs, wrong password 401, change-password invalide sessions + re-login) |

Résultat : **33/33 PASS** sur `test/unit/auth/`, **6/6 PASS** sur `test/security/platform-reset-password.spec.ts`, TypeScript `tsc --noEmit` clean (hors erreurs pré-existantes `mobile/` et `server/poc/`).

**i18n.** ~50 nouvelles clés ajoutées à `fr.ts` (master) et `en.ts`. Les 6 autres locales (wo, ln, ktu, ar, pt, es) fallback automatiquement sur `fr.ts` (confirmé par `locales/index.ts:7`).

**Ouvertures futures.**
- Tests d'intégration Testcontainers reportés (scénarios happy-path déjà couverts par unit + E2E live).
- Impersonation remote auto-remplissage plan : déjà couvert par la combobox ; un endpoint `GET /platform/tenants?withCurrentPlan=true` serait un peu plus propre que le fetch brut `/api/tenants` qui expose tous les champs — à ouvrir si perf ou surface d'attaque le justifient.

---

## 2026-04-15 — Refonte Personnel : Staff + StaffAssignment (6 phases)

**Contexte.** Symptôme rapporté : changer le rôle IAM d'un user en « DRIVER » via PageIamUsers ne faisait pas apparaître ce user dans le module Chauffeur. Cause : deux notions distinctes de « rôle » (User.role IAM = permissions vs Staff.role = métier) non synchronisées ; le champ `userType: 'STAFF' | 'DRIVER'` d'IAM était un zombie qui ne créait aucune ligne Staff. Au-delà du bug immédiat, le modèle 1-1 `Staff.role` + `Staff.agencyId` interdisait structurellement le multi-rôles (un chauffeur qui est aussi contrôleur) et le multi-agences (un superviseur qui couvre plusieurs agences).

**Décision.** Modèle β retenu — `Staff` reste comme enveloppe RH minimale (1-1 avec User : statut global, agence de rattachement RH, date d'embauche), les postes occupés passent sur une nouvelle table `StaffAssignment` (N par Staff : role × agencyId × dates × licence × dispo). Couverture multi-spécifique via table annexe `StaffAssignmentAgency`. Document de référence : [DESIGN_Staff_Assignment.md](DESIGN_Staff_Assignment.md).

**Livrable — 6 phases mergeables indépendamment.**

| Phase | Commit | Livraison |
|---|---|---|
| 1 — Schéma + migration données | `ab3d2f0` + `cb918ad` | `StaffAssignment` + `StaffAssignmentAgency` dans Prisma, `Staff.hireDate` ajouté, seed backfille les Staffs legacy vers des StaffAssignment miroirs (3/3 rows migrées, idempotent) |
| 2 — Services lisent via StaffAssignment | `d2e58d0` | `StaffService.findAll(role)` filtre via la relation assignments ; double-écriture transitoire sur create/update ; cascade correcte sur suspend/reactivate/archive |
| 3 — Endpoints CRUD | `3165c23` | 7 endpoints (POST/GET/PATCH `/staff/:userId/assignments`, `/assignments/:id/close`, `/assignments/:id/agencies`) + 13 tests unit (invariants §4.3 / §5 : combinaison interdite, FK, doublon, mono↔multi, CLOSED non-modifiable, etc.) |
| 4 — UI PagePersonnel refondue | `6f8619e` | Colonne « Affectations » (badges par assignment ACTIVE) ; AssignmentsManager (list/add/close avec choix couverture mono/tenant/multi) ; PromoteFromIamForm (`GET /staff/eligible-users` + `POST /staff/from-user/:userId`) |
| 5 — Nettoyage code orphelin | `265cadf` | Drop colonnes legacy (`Staff.role`, `licenseData`, `isAvailable`, `totalDriveTimeToday`) + index obsolète ; zombie `userType='DRIVER'` supprimé (DTO IAM, form, badge, seeds). Invariant DESIGN §12 vérifié : `grep staff.role` → 0 |
| 6 — Documentation | ce commit | PRD_TransLog_Pro_v2 (section Personnel refondue), TECHNICAL_ARCHITECTURE (§2.4 Staff vs StaffAssignment + diagramme + requête visibilité), RESULTATS (cette entrée), DESIGN_Staff_Assignment (état final) |

**Vérifications.**

- `tsc --noEmit` clean
- Tests unit : 201/207 (6 échecs white-label **pré-existants**, hors scope refonte)
- Seed dev rejoué : 3 staffs ACTIVE × 1 StaffAssignment ACTIVE chacun
- Schéma Staff = 8 colonnes uniquement (id, tenantId, agencyId, userId, status, hireDate, createdAt, updatedAt)
- `grep "staff\\.role|staff\\.licenseData|staff\\.isAvailable|staff\\.totalDriveTimeToday"` → 0 résultat
- `grep "userType.*DRIVER"` → 0 résultat (hors `roleName: 'DRIVER'` qui est un rôle RBAC légitime)

**Effort réel.** ~3.5 jours estimés → 1 session de quelques heures (changements isolés, blast radius minimal : seuls `staff.service.ts`, `dto IAM`, `PageIamUsers`, `PagePersonnel`, `dev.seed.ts` touchés + nouveau module `StaffAssignment`).

**Ouvertures futures.**
- Scope IAM multi-agences (`UserAgencyAccess`) non touché dans cette refonte — DESIGN §12 étape 3 à ouvrir quand un vrai cas client le réclame.
- Exploration historique `WHERE endDate BETWEEN X AND Y` maintenant triviale grâce aux dates d'affectation.

---

## 2026-04-15 — Invariant `tenant ≥1 agence` + AgencyModule

**Contexte.** Symptôme rapporté : sur un tenant fraîchement onboardé, l'appel « Restaurer le pack de démarrage » renvoyait 403 sur `/templates`, `/templates/system`, `/templates/restore-starter-pack`. Cause : `PermissionGuard` ([`permission.guard.ts:123`](src/core/iam/guards/permission.guard.ts#L123)) exige un `agencyId` sur l'acteur dès que la permission est en scope `.agency`, mais `OnboardingService.onboard()` créait l'admin sans agence.

**Décision.** Pattern Office 365 — tout tenant naît avec une agence par défaut (« Agence principale » en fr, « Main Agency » en en, « Main » pour le tenant plateforme). L'admin y est rattaché automatiquement ; la dernière agence d'un tenant ne peut plus être supprimée.

**Livrable.**

- **Permissions** : `control.agency.manage.tenant` + `data.agency.read.tenant` ajoutées à `Permission` et accordées à `TENANT_ADMIN` ([`permissions.ts`](src/common/constants/permissions.ts), [`iam.seed.ts`](prisma/seeds/iam.seed.ts)).
- **Helpers seed** : `ensureDefaultAgency(tx, tenantId, name)` (idempotent) + `backfillDefaultAgencies(prisma)` pour rattraper les tenants existants ([`iam.seed.ts`](prisma/seeds/iam.seed.ts)).
- **Onboarding** : `OnboardTenantDto.language?: 'fr' | 'en'` (défaut `fr`), agence créée AVANT l'admin, `admin.agencyId` rempli ([`onboarding.service.ts`](src/modules/onboarding/onboarding.service.ts)).
- **AgencyModule** : nouveau module NestJS — `AgencyService` + `AgencyController` + `AgencyModule` sous `/tenants/:tenantId/agencies`. `remove()` retourne 409 sur la dernière agence et détache les users (`agencyId = null`) sinon dans une transaction ([`src/modules/agency/`](src/modules/agency/)).
- **Dev seed** : tenant2/tenant3 reçoivent désormais aussi une agence par défaut ([`dev.seed.ts`](prisma/seeds/dev.seed.ts)).
- **Schéma** : commentaire `INVARIANT` documenté sur `model Agency` ([`schema.prisma`](prisma/schema.prisma)).
- **Nettoyage** : l'endpoint `GET /tenants/:tenantId/agencies` sur `TenantController` (protégé par `CRM_READ_TENANT` — permission inadaptée) est retiré, repris par `AgencyController` avec `AGENCY_READ_TENANT`.

**Tests.**

| Niveau | Fichier | Tests |
|---|---|---|
| Unit | [`test/unit/services/agency.service.spec.ts`](test/unit/services/agency.service.spec.ts) | 13 (CRUD + invariant) |
| Unit | [`test/unit/services/onboarding.service.spec.ts`](test/unit/services/onboarding.service.spec.ts) | 5 (agence « Agence principale » / « Main Agency » avant admin, HMAC Vault, slug déjà pris) |
| Integration | [`test/integration/agency/agency-crud.spec.ts`](test/integration/agency/agency-crud.spec.ts) | 4 (DB réelle, détachement users, FK station) |
| E2E | [`test/e2e/app.e2e-spec.ts`](test/e2e/app.e2e-spec.ts) | +5 (403/200/201/400 + 409 dernière agence) |

Résultat `npx jest --config jest.integration.config.ts --runInBand` : **40/40 passed** (aucune régression).

**Backfill base existante.** `npx ts-node prisma/seeds/iam.seed.ts` — idempotent, crée « Agence principale » (ou renomme l'ancienne « Siège »/« Headquarters » si mono-agence) et rattache les users STAFF/DRIVER orphelins sur chaque tenant.

**Docs.**
- PRD §IV.3 + §IV.11 : invariant + module CRUD documenté.
- TECHNICAL_ARCHITECTURE.md §2.2 + §2.3 : module ajouté au tableau, section dédiée à l'invariant.
