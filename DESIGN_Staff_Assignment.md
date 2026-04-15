# DESIGN — Staff = enveloppe RH + Affectations métier (StaffAssignments)

**Statut :** ✅ **Implémenté — 2026-04-15** (option β retenue)
**Auteur :** Session 2026-04-15
**Dépend de :** [PRD_TransLog_Pro_v2.md](PRD_TransLog_Pro_v2.md), [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md)

---

## 0. État final (post-implémentation)

Les 6 phases du plan (§6) ont été livrées dans l'ordre, chacune mergée séparément pour permettre un rollback granulaire. Commits de référence :

| Phase | Commit | Livraison |
|---|---|---|
| 1 — Schéma + migration données | `ab3d2f0` + `cb918ad` | Modèles `StaffAssignment` + `StaffAssignmentAgency` + `Staff.hireDate`. Seed backfille les 3 Staffs existants (idempotent). |
| 2 — Services lisent via StaffAssignment | `d2e58d0` | `StaffService.findAll(role)` filtre via la relation ; double-écriture transitoire ; cascade archive. |
| 3 — Endpoints CRUD | `3165c23` | 7 endpoints REST + 13 tests couvrant les invariants §4.3 / §5. |
| 4 — UI PagePersonnel refondue | `6f8619e` | `AssignmentsManager` (list/add/close, 3 modes de couverture) + `PromoteFromIamForm` (sélection user IAM éligible). |
| 5 — Nettoyage code orphelin | `265cadf` | Drop colonnes legacy (`Staff.role`, `licenseData`, `isAvailable`, `totalDriveTimeToday`) + zombie `userType='DRIVER'` supprimé partout. |
| 6 — Documentation | *ce commit* | PRD §IV.3, TECHNICAL_ARCHITECTURE §2.4, RESULTATS, TEST_STATUS mis à jour. |

**Vérifications finales (invariant §12).**

- `tsc --noEmit` clean
- Tests unit : 201/207 (6 échecs white-label pré-existants, hors scope)
- `grep "staff\.role|staff\.licenseData|staff\.isAvailable|staff\.totalDriveTimeToday"` → **0 résultat** dans `src/`, `frontend/`, `test/`
- `grep "userType.*DRIVER"` → 0 (hors `roleName: 'DRIVER'` qui est un rôle RBAC légitime)
- Schéma `Staff` = 8 colonnes uniquement (id, tenantId, agencyId, userId, status, hireDate, createdAt, updatedAt)

**Ce qui n'a pas été fait (non-objectifs, §2).**

- Le scope IAM multi-agences (`User.agencyId` scalaire) reste inchangé. `UserAgencyAccess` non introduit — à ouvrir quand un cas client le réclamera.
- `User` / `Role` inchangés côté IAM RBAC.

**Effort réel.** ~3.5 jours estimés → 1 session (changements isolés grâce à un blast radius minimal côté consommateurs : seuls `staff.service.ts`, `tenant-iam.*`, `PageIamUsers`, `PagePersonnel`, `dev.seed.ts` touchés + nouveau module `StaffAssignment`).

---

## 1. Contexte et problème

### 1.1 Où on en est aujourd'hui

Trois tables mélangent trois responsabilités :

| Table | Rôle | Contraintes actuelles |
|---|---|---|
| `User` | Identité + login + rattachement IAM (`roleId`, `agencyId`) | `userType: STAFF\|CUSTOMER\|ANONYMOUS` |
| `Role` | Permissions RBAC (IAM) | Ne porte aucune notion métier |
| `Staff` | Profil opérationnel RH d'un employé | **1-1 avec User** (`userId @unique`), **1 rôle métier unique** (`role: String`), **1 agence unique** (`agencyId: String?`) |

Ces contraintes datent de l'époque où `Staff` était pensé comme une simple « extension RH » de `User`. Elles sont trop rigides face aux besoins réels du transport :

- Un user peut légitimement occuper **plusieurs rôles** (chauffeur **et** contrôleur)
- Un contrôleur peut couvrir **plusieurs agences** d'une ville voire tout le pays
- Un employé a un historique d'affectations qu'on veut conserver

### 1.2 Symptôme qui a déclenché cette refonte

Un admin change le `roleId` IAM d'un user en « DRIVER » via `PageIamUsers`, puis s'étonne que le module Chauffeur soit vide. Cause : `User.roleId` (IAM) et `Staff.role` (métier) sont deux notions différentes et la mutation IAM ne crée aucune ligne `Staff`.

De plus, le champ `userType: 'STAFF' | 'DRIVER'` du DTO IAM est un **champ zombie** : il ne sert à rien fonctionnellement, ne crée aucune ligne `Staff`, et induit en erreur. À supprimer.

### 1.3 Ce qui bloque structurellement

**Rien.** Aucune contrainte de sécurité, de Prisma, ou d'intégrité. Trois endroits du code s'appuient sur les hypothèses « 1 rôle, 1 agence » :

1. Requêtes opérationnelles : `staff.service.ts`, scheduler, manifest, crew-briefing, flight-deck, driver-profile — toutes font `WHERE staff.role = X`
2. Scope filter IAM (`src/common/helpers/scope-filter.ts`) : utilise `User.agencyId` scalaire
3. UI `PagePersonnel` : dialogs pensés pour un champ unique

---

## 2. Objectif

Passer du modèle « Jean **est** chauffeur » (statique, exclusif) au modèle « Jean **occupe** le poste de chauffeur à Douala depuis 2024 » (dynamique, cumulable, historisable).

**Non-objectifs :**

- Ne **pas** toucher au scope IAM (`User.agencyId` reste la home administrative)
- Ne **pas** fusionner `User` et `Staff`
- Ne **pas** toucher aux permissions RBAC (`Role`)

---

## 3. Décisions prises

### 3.1 Option β retenue : `Staff` reste, `StaffAssignment` arrive

`Staff` devient une **enveloppe RH minimale** pour représenter « cette personne est employée chez nous ». C'est cohérent avec la réalité : un employé est rattaché à une agence pour sa paie et son évolution, même s'il opère sur plusieurs agences.

`StaffAssignment` porte le **poste occupé** : rôle métier, agence d'opération, dates, dispo, licence spécifique.

### 3.2 Pourquoi pas option α (Staff disparaît)

α est plus radical et plus propre à terme, mais :
- Perd la notion « employé de l'entreprise » utile pour la paie/RH
- Rend l'archivage global plus compliqué (il faut clore N affectations au lieu d'archiver un Staff)
- Casse plus de code en une seule étape

β est un bon compromis : débloque le cas métier, préserve le concept RH, migration progressive.

### 3.3 Multi-agences : `null = tenant-wide` + table de jointure

Pas de flag explicite `coverage: TENANT | AGENCIES`. La sémantique est dans les données :

- `StaffAssignment.agencyId` renseigné → opère dans **cette agence**
- `StaffAssignment.agencyId = null` → opère **tenant-wide** (tous sites)

Pas de join-table `StaffAssignmentAgency` pour l'instant : si un user couvre 3 agences sur 5, on crée **3 lignes d'affectation** (une par agence), avec le même rôle. C'est plus verbeux mais plus simple à requêter, plus simple à clore individuellement, et plus proche de la réalité (un contrôleur peut être suspendu de l'agence A sans l'être de B).

Si un jour cette verbosité devient insupportable, on introduira `StaffAssignmentAgency`. Pour l'instant, YAGNI.

---

## 4. Modèle cible (Prisma)

### 4.1 Modifications sur `Staff`

```prisma
model Staff {
  id        String   @id @default(cuid())
  tenantId  String
  agencyId  String?  // agence de rattachement administratif (RH/paie)
  userId    String   @unique
  status    String   @default("ACTIVE")   // ACTIVE | SUSPENDED | ARCHIVED
  hireDate  DateTime @default(now())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user        User         @relation(fields: [userId], references: [id])
  assignments StaffAssignment[]

  @@index([tenantId, status])
  @@map("staff")
}
```

**Supprimés :**
- `role: String` → déplacé sur `StaffAssignment.role`
- `licenseData: Json` → déplacé sur `StaffAssignment.licenseData` (chaque rôle a ses propres licences)
- `isAvailable: Boolean` → déplacé sur `StaffAssignment.isAvailable` (dispo par rôle)
- `totalDriveTimeToday: Float` → déplacé sur `StaffAssignment` (pertinent uniquement côté chauffeur)

**Conservés :**
- `agencyId` = home administrative (**obligatoire** en logique applicative, nullable en DB le temps de la migration)
- `status` = statut RH global (un user suspendu globalement l'est partout)
- `hireDate` nouveau = date d'embauche (utile RH)

### 4.2 Nouvelle table `StaffAssignment`

```prisma
model StaffAssignment {
  id          String    @id @default(cuid())
  staffId     String
  role        String    // DRIVER | HOSTESS | MECHANIC | AGENT | CONTROLLER | SUPERVISOR
  agencyId    String?   // null = tenant-wide
  startDate   DateTime  @default(now())
  endDate     DateTime? // null = affectation active
  status      String    @default("ACTIVE")   // ACTIVE | SUSPENDED | CLOSED
  licenseData Json      @default("{}")
  isAvailable Boolean   @default(true)
  totalDriveTimeToday Float @default(0)      // pertinent si role=DRIVER
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  staff  Staff   @relation(fields: [staffId], references: [id], onDelete: Cascade)
  agency Agency? @relation(fields: [agencyId], references: [id])

  @@index([staffId, status])
  @@index([role, status, isAvailable])           // requêtes "chauffeurs dispo"
  @@index([agencyId, role, status])              // requêtes "qui est dispo à Douala ?"
  @@map("assignments")
}
```

### 4.3 Cas multi-agences spécifiques (table annexe `StaffAssignmentAgency`)

Pour couvrir le cas « ce contrôleur opère sur 2 agences précises parmi 5 » sans dupliquer N affectations identiques, on introduit une table de jointure facultative.

```prisma
model StaffAssignmentAgency {
  assignmentId String
  agencyId     String

  assignment StaffAssignment @relation(fields: [assignmentId], references: [id], onDelete: Cascade)
  agency     Agency     @relation(fields: [agencyId],     references: [id])

  @@id([assignmentId, agencyId])
  @@index([agencyId])
  @@map("assignment_agencies")
}
```

Et on ajoute côté `StaffAssignment` :
```prisma
model StaffAssignment {
  // ... champs existants
  coverageAgencies StaffAssignmentAgency[]
}
```

**Règle de lecture (unique) :**

| Configuration | Signification |
|---|---|
| `StaffAssignment.agencyId` renseigné, pas de `StaffAssignmentAgency` | **Mono-agence** (cas le plus courant) |
| `StaffAssignment.agencyId = null`, pas de `StaffAssignmentAgency` | **Tenant-wide** (toutes les agences du tenant) |
| `StaffAssignment.agencyId = null`, N lignes `StaffAssignmentAgency` | **Multi-spécifique** (N agences précises) |

**Combinaison interdite** : `StaffAssignment.agencyId` renseigné **ET** lignes dans `StaffAssignmentAgency` → incohérent, rejeté par validation applicative.

**Requête « visible depuis agence X »** (nouvelle version) :
```
SELECT * FROM assignments A
WHERE A.status = 'ACTIVE'
  AND A.isAvailable = true
  AND (
       A.agencyId = :X                                                   -- mono
    OR (A.agencyId IS NULL AND NOT EXISTS (
         SELECT 1 FROM assignment_agencies WHERE assignmentId = A.id))   -- tenant-wide
    OR EXISTS (
         SELECT 1 FROM assignment_agencies
         WHERE assignmentId = A.id AND agencyId = :X)                    -- multi-spécifique
  )
```

**Granularité de suspension** préservée :
- Suspendre l'affectation entière → `StaffAssignment.status = SUSPENDED`
- Retirer juste une des agences couvertes → `DELETE FROM assignment_agencies WHERE assignmentId = ? AND agencyId = ?`

**UI Personnel** : au moment de créer/éditer une affectation, 3 choix explicites :
1. « Une seule agence » → renseigne `StaffAssignment.agencyId`
2. « Toutes les agences du tenant » → `agencyId = null`, pas de `StaffAssignmentAgency`
3. « Plusieurs agences à choisir » → `agencyId = null`, N `StaffAssignmentAgency`

### 4.4 Nettoyage `User`

```prisma
model User {
  // ...
  userType String @default("STAFF") // STAFF | CUSTOMER | ANONYMOUS
  //                                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  //                                    'DRIVER' retiré (zombie)
}
```

---

## 5. Règles métier (invariants)

1. **Un Staff doit avoir au moins une affectation active** (sauf pendant la période entre embauche et première affectation → statut `ONBOARDING` possible à ajouter plus tard si besoin).
2. **Un Staff archivé (`status=ARCHIVED`) ne peut avoir aucune affectation active.** L'archivage clôt automatiquement toutes ses affectations ouvertes.
3. **Un Staff suspendu** (`status=SUSPENDED`) : ses affectations restent en base mais sont invisibles aux requêtes opérationnelles (filtrées côté service).
4. **Clôture plutôt que suppression** : on ne `DELETE` jamais une affectation — on met `endDate` et `status=CLOSED`. L'historique reste exploitable.
5. **Unicité** : pas de deux affectations actives avec le même `(staffId, role, agencyId)` en même temps. Contrainte applicative (pas de DB constraint, trop complexe avec les dates).

---

## 6. Plan d'exécution (6 phases)

Chaque phase est mergeable indépendamment. La prod reste fonctionnelle entre deux phases.

### Phase 1 — Schéma & migration de données *(backend, invisible UI)*
- Prisma migration : création table `assignments`, ajout `Staff.hireDate`
- Script de data migration : pour chaque `Staff` existant → créer 1 `StaffAssignment` avec les valeurs actuelles (`role`, `agencyId`, `licenseData`, `isAvailable`, `totalDriveTimeToday`, `startDate=Staff.createdAt`)
- **Ne pas supprimer** `Staff.role` etc. à ce stade — on les garde en double-écriture pour rollback
- Tests : migration est idempotente, round-trip donne les mêmes données

### Phase 2 — Services lisent les StaffAssignments *(invisible UI)*
- Réécriture `StaffService.findAll(role)` → join sur `StaffAssignment` avec filtres
- Adaptation des 4-5 services qui lisent `Staff.role` :
  - `scheduler.service.ts`
  - `manifest.service.ts`
  - `crew-briefing.*.ts`
  - `flight-deck.service.ts`
  - `driver-profile.service.ts`
- Tests existants doivent passer sans modification (comportement équivalent car données migrées fidèles)
- **Double-check** : comparer les sorties endpoint avant/après sur le seed de dev

### Phase 3 — Endpoints StaffAssignments
```
POST   /api/tenants/:tid/staff/:userId/assignments        # Créer une affectation
PATCH  /api/tenants/:tid/assignments/:id                  # Modifier
PATCH  /api/tenants/:tid/assignments/:id/close            # Clore (endDate + status=CLOSED)
GET    /api/tenants/:tid/staff/:userId/assignments        # Lister affectations d'un staff
GET    /api/tenants/:tid/assignments?role=X&agencyId=Y    # Liste filtrée
```

DTOs : `CreateStaffAssignmentDto`, `UpdateStaffAssignmentDto`, `StaffAssignmentQueryDto`.

Tests unit + integration.

### Phase 4 — UI Personnel refondue
- **PagePersonnel** : liste les **Staffs** (personnes), chaque ligne dépliable montre ses affectations
- Nouveau dialog **« Promouvoir un user IAM en Staff »** : sélectionne un user existant du tenant sans profil Staff, crée Staff + 1ère affectation en un geste
- Dialog **« Ajouter une affectation »** sur un Staff existant (choix rôle, agence ou tenant-wide, dates)
- Bouton **« Clore »** sur chaque affectation (au lieu de supprimer)
- Les modules métier (Chauffeur, Contrôleur…) continuent de fonctionner — ils lisaient `Staff.role` via les services, qui lisent maintenant `StaffAssignment`

### Phase 5 — Nettoyage *(ORPHELINS — sécurité)*
**À supprimer intégralement :**
- `Staff.role`, `Staff.licenseData`, `Staff.isAvailable`, `Staff.totalDriveTimeToday` (colonnes Prisma + migration de drop)
- Valeur `'DRIVER'` de `User.userType` (schéma commentaire + DTO IAM)
- Champ `userType` dans `PageIamUsers` (formulaire, colonne, badge)
- Dans DTO IAM `tenant-iam.dto.ts` : `@IsEnum(['STAFF', 'DRIVER'])` → devient inutile, le champ disparaît ou passe read-only
- Toute fonction de `staff.service.ts` qui lit les colonnes supprimées
- Tous les tests qui seedent directement `staff.role` sans passer par `StaffAssignment`

**Script de détection des orphelins :**
```bash
grep -rn "staff\.role\b" src/ test/ frontend/
grep -rn "staff\.licenseData\b" src/ test/ frontend/
grep -rn "staff\.isAvailable\b" src/ test/ frontend/
grep -rn "'DRIVER'" src/modules/tenant-iam/
```
→ 0 résultat attendu après cette phase.

### Phase 6 — Mise à jour de la documentation
- **`PRD_TransLog_Pro_v2.md`** : section « Personnel & affectations » refondue, mention explicite du multi-rôles multi-agences
- **`TECHNICAL_ARCHITECTURE.md`** : nouveau diagramme User ↔ Staff ↔ StaffAssignment ↔ Agency + note sur la séparation IAM/métier
- **`RESULTATS.md`** : nouvelle entrée datée retraçant la refonte
- **`TEST_STATUS.md`** : couverture mise à jour
- **Ce fichier (`DESIGN_Staff_StaffAssignment.md`)** : ajout d'une section « État final » en haut, pour dire « Implémenté le YYYY-MM-DD, commits XXX..YYY »

---

## 7. Migration de données (détail Phase 1)

```sql
-- Pseudo-SQL
INSERT INTO assignments (id, staffId, role, agencyId, startDate,
                         licenseData, isAvailable, totalDriveTimeToday, status)
SELECT
  gen_cuid(),               -- nouveau cuid
  s.id,                     -- staffId = Staff.id
  s.role,                   -- rôle actuel
  s.agencyId,               -- agence actuelle
  s.createdAt,              -- startDate = date création Staff
  s.licenseData,
  s.isAvailable,
  s.totalDriveTimeToday,
  'ACTIVE'
FROM staff s;
```

Script TypeScript équivalent dans `prisma/migrations/XXXXXXXX_add_assignments/` + vérif dans `prisma/seeds/dev.seed.ts`.

**Rollback Phase 1** : drop table `assignments`, colonnes `Staff` restent intactes, aucun service n'a encore été modifié → zéro impact.

---

## 8. Impacts code (inventaire à compléter pendant l'implémentation)

### Backend
| Fichier | Action | Phase |
|---|---|---|
| `prisma/schema.prisma` | ajout `StaffAssignment`, modif `Staff` | 1 |
| `prisma/seeds/dev.seed.ts` | seed via `StaffAssignment` | 1 |
| `src/modules/staff/staff.service.ts` | réécriture findAll, ajout CRUD assignments | 2-3 |
| `src/modules/staff/staff.controller.ts` | nouveaux endpoints | 3 |
| `src/modules/scheduler/scheduler.service.ts` | `WHERE assignments.role = DRIVER` | 2 |
| `src/modules/manifest/manifest.service.ts` | idem | 2 |
| `src/modules/crew-briefing/*` | idem | 2 |
| `src/modules/driver-profile/driver-profile.service.ts` | idem | 2 |
| `src/modules/flight-deck/flight-deck.service.ts` | idem | 2 |
| `src/modules/tenant-iam/dto/tenant-iam.dto.ts` | retrait `userType: DRIVER` | 5 |
| `src/modules/tenant-iam/tenant-iam.service.ts` | retrait logique zombie | 5 |

### Frontend
| Fichier | Action | Phase |
|---|---|---|
| `frontend/components/pages/PagePersonnel.tsx` | refonte + dialogs affectations | 4 |
| `frontend/components/pages/PageIamUsers.tsx` | retrait champ `userType` | 5 |
| Modules métier (chauffeur, contrôleur…) | aucune modif — les API répondent pareil | — |

---

## 9. Tests

### 9.1 Nouveaux tests unit
- `assignment.service.spec.ts` : CRUD, clôture, invariants (pas de 2 actives identiques)
- `staff.service.spec.ts` : mise à jour, archivage cascade sur assignments

### 9.2 Nouveaux tests integration
- `assignment-multi-role.spec.ts` : un user avec 2 affectations actives apparaît dans 2 listes métier
- `assignment-tenant-wide.spec.ts` : un contrôleur `agencyId=null` est visible depuis toute agence
- `staff-archive-cascade.spec.ts` : archiver un Staff clôt ses affectations

### 9.3 Tests à adapter
- Tous les tests qui appellent `staff.create({ role: 'DRIVER' })` → devront créer Staff puis StaffAssignment
- `test/helpers/*.ts` : helpers de seed à étendre avec `createStaffWithStaffAssignment()`

---

## 10. Mise à jour de la documentation *(Phase 6, obligatoire)*

Listé explicitement pour ne pas l'oublier. Aucune phase n'est considérée « done » tant que les docs ne sont pas à jour.

- [ ] `PRD_TransLog_Pro_v2.md` — refonte section Personnel
- [ ] `TECHNICAL_ARCHITECTURE.md` — diagramme + note séparation IAM/métier
- [ ] `RESULTATS.md` — entrée datée
- [ ] `TEST_STATUS.md` — couverture
- [ ] `DESIGN_Staff_StaffAssignment.md` (ce fichier) — état final
- [ ] ADR léger à la racine ? À décider (à aligner avec les ADRs évoqués dans le PRD et la mémoire session sur VOYAGEUR→CUSTOMER)

---

## 11. Questions ouvertes à trancher en cours d'implémentation

1. **`hireDate`** ajouté ou pas ? Utile RH mais optionnel pour la refonte technique. → **Proposition : oui, par défaut = `createdAt`, coût nul.**
2. **Archivage cascade** : quand on archive un Staff, clôt-on vraiment toutes les affectations ? Ou on refuse si affectations actives ? → **Proposition : cascade automatique, avec `endDate=now()`, confirmation UI côté admin.**
3. **Un Staff peut-il exister sans affectation active ?** Ex : période de transition entre deux rôles. → **Proposition : oui, statut `ACTIVE` mais liste d'affectations actives vide. Les modules métier ne le voient simplement pas.**
4. **Dispo globale** : garde-t-on une notion « Jean est en congé, toutes ses affectations sont indispo » ? → **Proposition : non, la dispo reste par affectation. Un `Staff.status=SUSPENDED` fait déjà l'affaire pour mettre tout le monde hors-ligne.**

---

## 12. Sécurité et code orphelin

Le nettoyage Phase 5 n'est pas cosmétique : **du code orphelin est un vecteur de bug et de confusion**.

- Colonnes DB orphelines → lecture accidentelle d'anciennes valeurs
- Champs DTO non câblés → faux signal de configuration
- Valeurs enum obsolètes → conditions jamais atteintes mais présentes en code, polluant les reviews

**Règle** : une phase 5 qui laisse 1 seul `grep -n "staff\.role\b"` positif dans `src/` ou `frontend/` n'est pas terminée.

---

## 13. Estimation

- Phase 1+2 : ~1 journée
- Phase 3 : ~0.5 journée
- Phase 4 : ~1-1.5 journée
- Phase 5 : ~0.5 journée
- Phase 6 : ~0.5 journée
- **Total : ~3.5-4 jours**

---

## 14. Décision finale — validée 2026-04-15

- [x] Modèle cible section 4 (schéma Prisma)
- [x] Règles métier section 5
- [x] Réponses aux 4 questions section 11
- [x] Ordre des phases — appliqué tel quel (schéma → services → endpoints → UI → nettoyage → docs)

Voir section **0. État final** en haut du document pour la traçabilité des commits et le bilan.
