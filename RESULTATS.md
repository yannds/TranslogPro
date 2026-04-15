# RESULTATS — Journal des livraisons

Ce document trace les évolutions backend significatives session par session.
Format : date ISO + titre + résumé en 3-5 lignes + liens fichiers.

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
