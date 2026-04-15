# RESULTATS — Journal des livraisons

Ce document trace les évolutions backend significatives session par session.
Format : date ISO + titre + résumé en 3-5 lignes + liens fichiers.

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
