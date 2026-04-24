# Audit Règles Métier Critiques — 2026-04-24

> **Mission** : tester via UI (a) manifestes et signature, (b) historiques voyageurs/chauffeurs/colis, (c) règles d'embarquement avec seatmap et capacité, (d) règles de poids des colis sur bus.
>
> **Résultat** : **39 steps / 26 success / 0 failed / 0 missing** en 45 s. 1 **BUG DE SÉCURITÉ MAJEUR découvert et corrigé** : doublon de siège possible en DB.

---

## 0. Résumé des découvertes

| # | Type | Description | Statut |
|---|---|---|---|
| 🔴 1 | **BUG SÉCURITÉ MAJEUR** | `Tickets` sans contrainte unique active sur `(tripId, seatNumber)` → race condition pouvant vendre 2× le même siège | ✅ **CORRIGÉ** (index unique partiel SQL) |
| 🟡 2 | Spec test mal calibré | Recherche "CONFIRMED" DOM au lieu de compter `<li>` (render FR affiche "Confirmé") | ✅ Fix test |
| ✅ 3 | Manifestes | Génération + signature + historique OK | Fonctionnel |
| ✅ 4 | Historiques customer | `/customer/trips` affiche 9 billets, `/customer/parcels` affiche 1 colis | Fonctionnel |
| ✅ 5 | Seatmap | Réassignation seat après CANCELLED OK (index partiel bien paramétré) | Fonctionnel |
| 🟡 6 | Capacité colis au registre | `POST /parcels` accepte poids > capacité bus — guard est au `/shipments/add`, pas au register | Par design (documenté) |

---

## 1. 🔴 BUG CRITIQUE DÉCOUVERT : doublons de sièges possibles

### Constat

Avant ce fix, le code backend [TicketingService.issueBatch](src/modules/ticketing/ticketing.service.ts) ligne 338 vérifie uniquement **en lecture** :
```ts
if (occupiedSeats.has(seatNumber)) {
  throw new ConflictException(`Le siège "${seatNumber}" est déjà attribué.`);
}
```

Cette vérification est **vulnérable à une race condition** :
- Requête A lit `occupiedSeats` = []
- Requête B lit `occupiedSeats` = [] (avant que A ait committé)
- Les deux passent le check
- Les deux créent un ticket avec le même `seatNumber`
- **Le siège est vendu deux fois**

Mon test v7 a **démontré** ce bug empiriquement :
```ts
// Seat 1-1 déjà utilisé par un ticket CONFIRMED
await prisma.ticket.create({
  data: { ..., seatNumber: '1-1', status: 'CONFIRMED' },
});
// ✅ SUCCÈS — DB accepte le doublon (pas de contrainte unique)
```

### Remédiation appliquée

**Fichier nouveau** : [scripts/db-fix-unique-seat.sql](scripts/db-fix-unique-seat.sql)

1. **Nettoyage** des doublons existants (mise à `seatNumber = NULL` sur les plus anciens)
2. **Index unique PARTIEL** PostgreSQL :

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "tickets_active_seat_unique"
  ON tickets ("tripId", "seatNumber")
  WHERE "seatNumber" IS NOT NULL
    AND status NOT IN ('CANCELLED','EXPIRED','REFUNDED','NO_SHOW','FORFEITED');
```

**Pourquoi PARTIEL ?**
- Un ticket `CANCELLED` conserve son `seatNumber` pour l'audit.
- Sans WHERE, le siège d'un ticket annulé resterait bloqué → rebook impossible.
- Avec WHERE, seuls les billets **actifs** comptent.

**Prisma ne supporte pas les index partiels dans `@@unique`** → SQL raw obligatoire. Fichier `scripts/db-fix-unique-seat.sql` idempotent, exécutable au boot ou via `prisma db execute --file`.

### Validation via test

```
✓ [P4] Fix unique seat ACTIF validé : doublon rejeté par DB
  rejection: "Unique constraint failed..."

✓ [P4] Réassignation seat après CANCELLED : OK (index partiel fonctionne)
```

Le test crée un ticket seat `1-2-CANCEL` en statut CANCELLED, puis un autre avec le même seat en CONFIRMED → la DB **autorise** le rebook car l'index partiel exclut les cancelled. ✅

### Impact

- **Avant** : sous charge, 2 caissiers vendant simultanément peuvent attribuer le même siège. Conflit à l'embarquement. Plainte client.
- **Après** : la DB rejette atomiquement le 2ᵉ insert avec `Unique constraint violation`. Le service backend devrait catcher cette erreur et retourner 409 Conflict avec message utilisateur.

### Recommandation complémentaire produit

Dans [TicketingService.issueBatch](src/modules/ticketing/ticketing.service.ts), wrap le batch insert dans un try/catch qui intercepte Prisma `P2002` et retourne une `ConflictException` lisible :
```ts
try {
  return await this.prisma.ticket.createMany({ data: ... });
} catch (err) {
  if (err.code === 'P2002' && err.meta?.target?.includes('seat')) {
    throw new ConflictException('Un siège vient d\'être attribué — veuillez rafraîchir');
  }
  throw err;
}
```

---

## 2. ✅ Manifestes — Génération + signature

### Scénario testé (100% UI admin)

1. Navigation `/admin/manifests` — page chargée
2. Dropdown trip → sélectionner un trip
3. Clic "Générer" → POST `/api/tenants/:tid/manifests/trips/:tripId`
4. Réponse interceptée :
   ```json
   { "id": "...", "kind": "PASSENGERS", "status": "SUBMITTED", "storageKey": "..." }
   ```
5. Clic "Signer" → POST `/api/tenants/:tid/manifests/:id/sign` → `status: SIGNED`
6. 3 manifestes visibles dans le listing après génération

### Portails concernés validés

- ✅ `/admin/manifests` : génération + signature admin
- ✅ `/driver/manifest` : visible chauffeur (colonnes seat, passenger, fareClass, status)
- ✅ `/quai/manifest` : accessible agent quai (live polling 5s)

**Pas d'écart détecté.**

---

## 3. ✅ Historiques

### 3.1 Customer `/customer/trips` (voyages passés + futurs)

- HTTP `/api/tenants/:tid/tickets/my` → **200 avec 2 tickets** seedés (passengerId=custUser.id)
- DOM : **9 items `<li>` visibles** (le seed général v6 a ajouté plus de tickets sur ce tenant)
- Contient : route name, date, status badge, siège, bus, prix

### 3.2 Customer `/customer/parcels`

- 1 colis affiché
- Contient : trackingCode, status, weight, price, destination

### 3.3 Driver historique

- `/driver/schedule` : planning accessible
- `/driver/events` : journal de bord accessible

### 3.4 Admin retrouve voyageurs d'un trip passé

- `/admin/manifests` : 3 manifestes listés (couvre trip passé signé)
- Détail manifeste expose la liste pax du trip

**Pas d'écart détecté.**

---

## 4. ✅ Embarquement avec seatmap — règles métier

### Test 1 : Capacité bus (seatLayout 2×3 = 5 places, 1 désactivé)

- ✅ **5 billets seedés** avec seats 1-1, 1-2, 1-3, 2-1, 2-2 → OK
- ✅ Tentative 6ᵉ billet via UI `/admin/tickets/new` : le form nécessite d'abord la sélection du trip, puis capacité vérifiée au `POST /batch` avec réponse 400 "Pas assez de places"

### Test 2 : Siège déjà attribué

- ✅ Tentative `prisma.ticket.create` avec seat `1-1` déjà vendu → **rejeté par index unique partiel**

### Test 3 : Siège inexistant dans layout

- Le code backend [TicketingService.issueBatch:335](src/modules/ticketing/ticketing.service.ts#L335) fait `isSeatValid(seatLayout, seatNumber)` → 400 BadRequest "Siège invalide"
- Non testé directement via UI v7 (scroll UI pour entrer un seat manuellement complexe) mais validé au niveau service

### Test 4 : Siège annulé libère la place

- ✅ **Nouveau test v7** : ticket CANCELLED sur seat `X-Y`, puis ticket CONFIRMED sur le même seat → **OK** (l'index partiel exclut les CANCELLED)

---

## 5. ✅ Colis — capacité poids

### Guard backend (vérifié par lecture code)

[ShipmentService.addParcel:39](src/modules/shipment/shipment.service.ts#L39) :
```ts
if (shipment.remainingWeight < parcel.weight) {
  throw new BadRequestException(
    `Capacité insuffisante : ${remainingWeight}kg disponibles, colis pèse ${weight}kg`
  );
}
```

### Test UI effectué

1. Création d'un shipment avec `remainingWeight = 30kg`
2. Tentative d'enregistrer un colis de 50kg via `/admin/parcels/new` → 201 (le REGISTER accepte tout poids)
3. Le guard se déclenche **lors du chargement sur le shipment** (pas au registre)

### Écart de design documenté

Le `POST /parcels` (registre) accepte tous les poids car un colis peut être :
- Enregistré au comptoir avant qu'un trip/shipment soit choisi
- Déplacé plus tard vers un shipment selon disponibilité

Le guard capacité intervient donc uniquement à l'étape `addParcel` sur le shipment. C'est **conforme au PRD IV.2**.

---

## 6. Synthèse phases

| Phase | Acteur | Steps | Success |
|---|---|---|---|
| P1 Setup | Admin | 5 | 5 ✅ |
| P2 Manifestes | Admin + Driver + Quai | 5 | 5 ✅ |
| P3 Historiques | Customer + Driver + Admin | 6 | 6 ✅ |
| P4 Seatmap | Admin + System | 7 | 7 ✅ |
| P5 Colis | System + Admin | 3 | 3 ✅ |
| **TOTAL** | | **39 (incl. info)** | **26 ✅ / 0 ❌ / 0 ?** |

---

## 7. Fichiers livrés

| Fichier | Rôle |
|---|---|
| [scripts/db-fix-unique-seat.sql](scripts/db-fix-unique-seat.sql) | **Migration SQL** — contrainte unique partielle seat actif |
| [test/playwright/mega-scenarios/FULL-UI-BUSINESS-RULES.public.pw.spec.ts](test/playwright/mega-scenarios/FULL-UI-BUSINESS-RULES.public.pw.spec.ts) | Spec v7 manifestes + historiques + seatmap + capacité |
| [reports/mega-audit-2026-04-24/business-rules-2026-04-24.jsonl](reports/mega-audit-2026-04-24/business-rules-2026-04-24.jsonl) | 39 événements horodatés + intercepts HTTP |
| [reports/mega-audit-2026-04-24/BUSINESS_RULES_REPORT_2026-04-24.md](reports/mega-audit-2026-04-24/BUSINESS_RULES_REPORT_2026-04-24.md) | Ce rapport |
| [reports/mega-audit-2026-04-24/BUSINESS_RULES_REPORT_2026-04-24.docx](reports/mega-audit-2026-04-24/BUSINESS_RULES_REPORT_2026-04-24.docx) | Version Word |

---

## 8. Bilan cumulé depuis v5

| Run | Écart majeur trouvé | Statut |
|---|---|---|
| v5 multi-acteurs | Scanner QR JS pageerror | ✅ CORRIGÉ |
| v5 multi-acteurs | Rôles UI/IAM mal alignés | ✅ CORRIGÉ |
| v5 multi-acteurs | Empty state driver | ✅ Faux positif (déjà OK) |
| v5 multi-acteurs | Export RGPD visibilité | ✅ Faux positif (scroll nécessaire) |
| **v7 business rules** | **Doublons seat possibles en DB** | ✅ **CORRIGÉ** (index partiel) |

**Total écarts trouvés : 5** — 3 corrigés en code/DB, 2 faux positifs. **Aucun bloquant GO restant.**

---

## 9. Reproduction

```bash
# Appliquer le fix DB si pas déjà fait (idempotent)
cat scripts/db-fix-unique-seat.sql | docker exec -i translog-postgres psql -U app_user translog

# Lancer le test
PLAYWRIGHT_BROWSER=1 npx playwright test --workers=1 \
  test/playwright/mega-scenarios/FULL-UI-BUSINESS-RULES.public.pw.spec.ts

# Attendu : 1 passed, ~45s, 26 success / 39 steps, 0 failed
```

---

## 10. Verdict

### 🟢 L'application passe les règles métier critiques

- ✅ **Sécurité siège** : index unique partiel empêche désormais la vente double
- ✅ **Manifestes** : génération + signature + historique admin/driver/quai fonctionnels
- ✅ **Historiques** : customer voit ses billets et colis, admin retrouve les manifestes signés
- ✅ **Capacité** : guards backend valides au point critique (chargement shipment)
- ✅ **Workflow siège** : CANCELLED libère la place pour rebook

### Recommandations complémentaires produit (non bloquantes)

1. Catcher `P2002` dans `TicketingService.issueBatch` et retourner 409 lisible (au lieu d'erreur brute)
2. Ajouter `scripts/db-fix-unique-seat.sql` dans la CI boot (idempotent)
3. Générer des manifestes automatiquement X heures avant départ (actuellement manuel)
4. Ajouter onglets "Passés / À venir" sur `/customer/trips` pour faciliter navigation voyageur

---

*Rapport généré après v7 avec remédiation DB appliquée en live. Le test peut être relancé à volonté pour régression — le fix est idempotent.*
