# Staff ↔ RBAC Sync — Cohérence RH/IAM

**Dernière mise à jour : 2026-04-27**

## 1. Problème résolu

Avant ce chantier, un `User(userType='STAFF')` créé via plusieurs flux (onboarding, IAM admin, bulk import, tenant/platform bootstrap, signup public) existait dans IAM mais n'apparaissait **pas** dans la liste **Personnel** : aucune row `Staff` + `StaffAssignment` n'était provisionnée. Conséquence : un chauffeur, caissier ou mécanicien restait invisible côté RH tant qu'on ne le promouvait pas manuellement via "Promouvoir depuis IAM".

De plus, le rôle IAM (`User.roleId → Role.name`) et le rôle métier (`StaffAssignment.role`) étaient totalement découplés : un user pouvait être `DRIVER` côté IAM et `MECHANIC` côté Personnel sans aucune cohérence.

## 2. Invariants garantis

1. **Tout `User(userType='STAFF')`** → a une row `Staff` + un `StaffAssignment` ACTIVE primaire.
2. **Le `name` du Role IAM** (via `User.role.name`) === **`StaffAssignment.role`** du primary, en permanence.
3. **Roles externes** (`CUSTOMER`, `PUBLIC_REPORTER`) ne sont **jamais** provisionnés en Staff.
4. **Primary assignment** = celui le plus récent en status `ACTIVE` (orderBy startDate desc, take 1).
5. **1 User = 1 rôle IAM = 1 Staff = 1 StaffAssignment ACTIVE primaire** (règle stricte 1-1).

Pour accorder à un user des permissions cumulées (ex: manager + droits chauffeur), créer un **AppRole personnalisé** qui agrège les permissions voulues — pas de multi-rôles par user.

## 3. Roles système vs custom

- **Roles système** (`Role.isSystem=true`) : seedés via `prisma/seeds/iam.seed.ts`. Liste actuelle :
  `TENANT_ADMIN, AGENCY_MANAGER, DISPATCHER, CASHIER, ACCOUNTANT, AGENT_QUAI, DRIVER, HOSTESS, MECHANIC, CUSTOMER, PUBLIC_REPORTER`.
  - **Suppression** : interdite (`tenant-iam.service.ts:459` + `403 ForbiddenException`).
  - **Renommage** : interdit (le `name` sert de clé de sync ; renommer casserait l'invariant).
  - **Édition des permissions** : autorisée (l'admin peut ajouter/retirer des permissions sur un rôle système, sous sa responsabilité).
- **Roles personnalisés** (`isSystem=false`) : créés par l'admin tenant. Modifiables, supprimables tant qu'aucun User ne les utilise.

## 4. Le helper unique : `StaffProvisioningService`

Source : [src/modules/staff/staff-provisioning.service.ts](../src/modules/staff/staff-provisioning.service.ts).

### API

| Méthode | Rôle |
|---------|------|
| `ensureStaffForUser({ userId, tenantId, role?, agencyId? })` | Crée ou réconcilie Staff + StaffAssignment + sync `User.roleId`. Idempotent. |
| `syncFromAssignment(assignmentId)` | Après mutation d'un StaffAssignment.role : si c'est le primary, met à jour `User.roleId` pour matcher. |
| `syncFromUserRole(userId)` | Après changement `User.roleId` : met à jour le primary `StaffAssignment.role` pour matcher. |
| `getPrimaryAssignment(staffId)` | Retourne l'assignment ACTIVE le plus récent. |

### Refus

- `userType !== 'STAFF'` → `BadRequestException`
- `role` dans `EXTERNAL_ROLES = ['CUSTOMER', 'PUBLIC_REPORTER']` → `BadRequestException`
- Aucun rôle cible (User sans Role + role non fourni) → `BadRequestException`
- `Role(name=role)` introuvable dans le tenant → `NotFoundException`

## 5. Flux branchés (Phase 2)

| Flux | Fichier | Comportement |
|------|---------|--------------|
| Onboarding wizard `inviteTeam` | [onboarding-wizard.service.ts](../src/modules/onboarding-wizard/onboarding-wizard.service.ts) | provisioning par invité, best-effort |
| IAM admin `createUser` | [tenant-iam.service.ts](../src/modules/tenant-iam/tenant-iam.service.ts) | provisioning si `dto.roleId` fourni |
| Bulk import CSV `importPersonnel` | [bulk-import.service.ts](../src/modules/bulk-import/bulk-import.service.ts) | tx{User+Account} + helper hors tx |
| Tenant bootstrap `tenant.create` | [tenant.service.ts](../src/modules/tenant/tenant.service.ts) | résout TENANT_ADMIN + provisioning admin |
| Platform bootstrap + createStaff | [platform.service.ts](../src/modules/platform/platform.service.ts) | provisioning pour tenant `__platform__` |
| Signup public `onboard` | [onboarding.service.ts](../src/modules/onboarding/onboarding.service.ts) | provisioning admin tenant après tx commit |

Tous les appels sont **best-effort** (try/catch + `logger.warn`) — un échec ne fait pas régresser la création User. Le helper est `@Optional()` dans 3 services pour la rétrocompat des tests existants.

## 6. Sync bidirectionnel (Phase 3)

| Mutation | Hook | Effet |
|----------|------|-------|
| `TenantIamService.updateUser({ roleId })` | `syncFromUserRole(userId)` | Propage `User.role.name` → primary `StaffAssignment.role` |
| `StaffAssignmentService.create()` | `syncFromAssignment(id)` | Si primary, aligne `User.roleId` |
| `StaffAssignmentService.update({ role })` | `syncFromAssignment(id)` | Idem |

## 7. Backfill (Phase 4)

Script idempotent dry-run par défaut : [prisma/seeds/staff-rbac-sync.backfill.ts](../prisma/seeds/staff-rbac-sync.backfill.ts).

```bash
# Dry-run : lit + reporte, n'écrit rien
npx ts-node prisma/seeds/staff-rbac-sync.backfill.ts

# Apply : exécute
npx ts-node prisma/seeds/staff-rbac-sync.backfill.ts --apply

# Apply avec arbitrage RH-wins (défaut : IAM-wins)
npx ts-node prisma/seeds/staff-rbac-sync.backfill.ts --apply --prefer-rh

# Scope un seul tenant
npx ts-node prisma/seeds/staff-rbac-sync.backfill.ts --tenant=<id>
```

Couvre 3 scénarios :

1. Users staff orphelins (sans Staff) → crée Staff + StaffAssignment ACTIVE
2. Staff sans assignment ACTIVE → crée un primary à partir de `User.role.name`
3. Désalignements `User.role.name ≠ primary.role` → réaligne (IAM-wins par défaut)

## 8. UI cohérence (Phase 5)

- **PageIamRoles** : badge "Système" + actions delete/rename masquées si `isSystem=true` (déjà en place).
- **PageIamUsers** : hint sous le sélecteur de rôle — *"Le poste dans Personnel sera mis à jour automatiquement"*.
- **PagePersonnel** : hint sous le sélecteur de rôle d'assignment — *"Le rôle IAM sera mis à jour automatiquement"*.

i18n fr+en uniquement (les 6 autres locales en backlog : voir [TODO_i18n_propagation.md](TODO_i18n_propagation.md)).

## 9. Tests

- Unit : [test/unit/services/staff-provisioning.service.spec.ts](../test/unit/services/staff-provisioning.service.spec.ts) — **19 tests** couvrant idempotence, refus userType≠STAFF, refus rôles externes, refus Role inexistant, sync forward/backward, no-op cas limites.
- Suite globale : 1461/1461 unit verts (un seul échec pré-existant sans rapport sur `auth-templates.spec.ts`).

## 10. Limites connues

- **Multi-postes simultanés** : non supportés en règle métier (1 ACTIVE primaire). Le schéma DB autorise N assignments mais la convention applicative impose 1 ACTIVE max. Si un legacy a plusieurs ACTIVE, le helper retient le plus récent.
- **Renommage d'un rôle custom** : ne propage pas dans les `StaffAssignment.role` existants (ils gardent l'ancien `name` jusqu'à prochain sync). Limitation acceptable car le renommage de rôle custom est rare et l'alignement se rétablit au prochain `update` côté IAM ou Assignment.
- **Locales** : seules fr+en livrées. Les 6 autres (wo, ln, ktu, ar, pt, es) tomberont sur fr en fallback automatique.
