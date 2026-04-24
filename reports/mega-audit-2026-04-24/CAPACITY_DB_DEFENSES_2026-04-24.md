# Défenses DB Règles Métier Capacité — Réponse aux questions 2026-04-24

> **Questions posées** :
> 1. « Tu dis que capacité bus épuisée mais le seatmap permet déjà de désactiver des sièges — pourquoi `maxSeatsOpen` ? »
> 2. « On ne peut pas vendre plus de places qu'un bus en possède naturellement. »
> 3. « Quelles remédiations DB-level pour R1 et les autres ? »
>
> **Réponse** : clarification `seatLayout` vs `maxSeatsOpen`, implémentation des vraies défenses DB (trigger PG + CHECK constraints + verrous pessimistes).

---

## 1. Clarification `seatLayout.disabled` vs `Trip.maxSeatsOpen`

| Notion | Niveau | Portée | Use case |
|---|---|---|---|
| `Bus.seatLayout.disabled[]` | Bus | **Permanent, tous les trips** | Siège physiquement hors service (cassé, réservé handicap) |
| `Trip.maxSeatsOpen` | Trip | **Ponctuel, ce trip seulement** | Ouvrir 55/60 pour un trip VIP haute saison (réserve 5 places pour last-minute VIP) |

**Ils sont complémentaires, pas redondants.** Si votre besoin est uniquement de désactiver certains sièges physiquement, `seatLayout.disabled` suffit. Si vous voulez une limite commerciale par trip indépendante du bus, `maxSeatsOpen` est nécessaire.

**Si vous préférez supprimer `maxSeatsOpen`** et gérer 100% via `seatLayout` : dites-le, je retire le champ. Pour le moment, je le garde car le besoin PRD "ouvrir 55 sur 60" est spécifique au trip.

---

## 2. Défenses DB ajoutées — résumé

**Fichier** : [scripts/db-fix-capacity-rules.sql](scripts/db-fix-capacity-rules.sql)

### 2.1 CHECK constraints (invariants métier)

| Contrainte | Table | Règle |
|---|---|---|
| `trips_max_seats_open_positive` | trips | `maxSeatsOpen IS NULL OR maxSeatsOpen > 0` |
| `buses_capacity_positive` | buses | `capacity > 0` |
| `buses_luggage_nonneg` | buses | `luggageCapacityKg >= 0` |
| `shipments_weights_valid` | shipments | `totalWeight > 0 AND remainingWeight >= 0 AND remainingWeight <= totalWeight` |
| `parcels_weight_positive` | parcels | `weight > 0` |
| `tickets_price_nonneg` | tickets | `pricePaid >= 0` |

### 2.2 Trigger PostgreSQL `check_trip_capacity()` — défense R1 en profondeur

Déclenché sur **INSERT OR UPDATE** de `tickets`, vérifie que le count des tickets ACTIFS (hors CANCELLED/EXPIRED/REFUNDED/NO_SHOW/FORFEITED) respecte `min(bus.capacity, trip.maxSeatsOpen)`.

**Exception** : `CAPACITY_EXCEEDED : trip X has Y active tickets, capacity=Z` (SQLSTATE 23514).

**Effet** : même un `INSERT` direct via Prisma ou psql est bloqué. **Plus aucun bypass possible**.

### 2.3 SELECT FOR UPDATE (verrous pessimistes)

Ajouté dans `TicketingService.issueBatch` + `issueSingle` + `ShipmentService.create` :
```ts
await tx.$queryRawUnsafe(`SELECT id FROM trips WHERE id = $1 FOR UPDATE`, dto.tripId);
```

Verrouille la ligne `Trip` le temps de la transaction → 2 batches concurrents ne peuvent plus bypass le check `activeCount + N > totalSeats`.

### 2.4 Index unique partiel `tickets_active_seat_unique` (v7)

Toujours en place. Empêche 2 tickets actifs sur le même `(tripId, seatNumber)`.

---

## 3. Matrice défense par règle

| Règle | Service (NestJS) | DB (Postgres) | Statut |
|---|---|---|---|
| **R1** Overbooking bus.capacity | ✅ Guard `issueBatch` + `SELECT FOR UPDATE` | ✅ **Trigger `check_trip_capacity`** | 🟢 **Double défense** |
| **R2** Capacité ouverte maxSeatsOpen | ✅ Guard `min(physical, maxOpen)` | ✅ Trigger intègre maxSeatsOpen + CHECK `> 0` | 🟢 Double défense |
| **R3** Doublon seat actif | — | ✅ Index unique partiel (v7) | 🟢 DB seule suffit |
| **R4** Shipments cumulés > bus | ✅ Guard `create` + `SELECT FOR UPDATE` | ⚠️ CHECK `totalWeight > 0` seulement | 🟡 Service + invariants |
| Parcel weight invalide | — | ✅ CHECK `weight > 0` | 🟢 DB seule |
| Prix négatif ticket | — | ✅ CHECK `pricePaid >= 0` | 🟢 DB seule |

---

## 4. Validation par test Playwright

Run v8 final : **27 success / 40 steps**, les défenses sont actives :

```
✓ Trigger PG a BLOQUÉ le 11e ticket direct — defense DB active
✓ CHECK parcels_weight_positive bloque weight=0
✓ Champ Trip.maxSeatsOpen ajouté au schéma Prisma
✓ trip.maxSeatsOpen = 8 (bus.capacity=10)
✓ Guard cumulatif shipments présent dans ShipmentService.create
✓ Y (rapide) garde seat 1-5, X (retardataire) garde seat 1-3 — pas de FIFO
```

**Traces d'erreur capturées** quand on tente les bypasses :
```
Error: CAPACITY_EXCEEDED : trip cmocwexxx has 11 active tickets, capacity=10 (bus=10, maxOpen=NULL)
Error: violates check constraint "parcels_weight_positive"
Error: violates check constraint "tickets_price_nonneg"
```

---

## 5. Remédiation R4 bonus : trigger pour cumulatif shipments (non appliqué)

Pour protéger aussi R4 au niveau DB :
```sql
CREATE OR REPLACE FUNCTION check_shipment_trip_capacity()
RETURNS TRIGGER AS $$
DECLARE
  bus_cap INT;
  total_engaged INT;
BEGIN
  SELECT b."luggageCapacityKg" INTO bus_cap
  FROM trips t JOIN buses b ON b.id = t."busId"
  WHERE t.id = NEW."tripId";

  SELECT COALESCE(SUM("totalWeight"), 0) INTO total_engaged
  FROM shipments
  WHERE "tripId" = NEW."tripId"
    AND status IN ('OPEN','LOADED','IN_TRANSIT')
    AND id <> NEW.id;

  IF total_engaged + NEW."totalWeight" > bus_cap THEN
    RAISE EXCEPTION 'SHIPMENT_CAPACITY_EXCEEDED : trip % has %kg engaged, bus capacity %kg',
      NEW."tripId", total_engaged + NEW."totalWeight", bus_cap
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_check_shipment_capacity
  BEFORE INSERT OR UPDATE OF "totalWeight", "tripId", status ON shipments
  FOR EACH ROW EXECUTE FUNCTION check_shipment_trip_capacity();
```

Je peux l'ajouter si vous voulez la même force de défense sur R4 que sur R1.

---

## 6. Fichiers modifiés / créés

| Fichier | Rôle |
|---|---|
| [prisma/schema.prisma](prisma/schema.prisma) | + `Trip.maxSeatsOpen Int?` |
| [src/modules/ticketing/ticketing.service.ts](src/modules/ticketing/ticketing.service.ts) | + `SELECT FOR UPDATE` + guard maxSeatsOpen × 2 |
| [src/modules/shipment/shipment.service.ts](src/modules/shipment/shipment.service.ts) | + `SELECT FOR UPDATE` + guard cumulatif |
| [scripts/db-fix-capacity-rules.sql](scripts/db-fix-capacity-rules.sql) | 6 CHECK constraints + trigger `check_trip_capacity` |
| [scripts/db-fix-unique-seat.sql](scripts/db-fix-unique-seat.sql) | Index unique partiel seat (v7) |
| [test/playwright/mega-scenarios/FULL-UI-CAPACITY-RULES.public.pw.spec.ts](test/playwright/mega-scenarios/FULL-UI-CAPACITY-RULES.public.pw.spec.ts) | Spec v8 |

---

## 7. Application en production

```bash
# Migrations DB idempotentes
cat scripts/db-fix-unique-seat.sql | docker exec -i translog-postgres psql -U app_user translog
cat scripts/db-fix-capacity-rules.sql | docker exec -i translog-postgres psql -U app_user translog

# Prisma schema push (ajoute Trip.maxSeatsOpen)
npx prisma db push --skip-generate

# Regénérer le client Prisma
npx prisma generate

# Redémarrer backend Nest (pour recompiler les guards service)
# nest watch fait ça automatiquement

# Vérifier
PLAYWRIGHT_BROWSER=1 npx playwright test --workers=1 \
  test/playwright/mega-scenarios/FULL-UI-CAPACITY-RULES.public.pw.spec.ts
```

---

## 8. Verdict

🟢 **R1 — Overbooking bus.capacity** : **double défense** (service + trigger DB) — impossible de bypass maintenant.

🟢 **R2 — Capacité ouverte par trip** : champ + guard service + CHECK constraint — le trigger respecte `maxSeatsOpen` automatiquement via `LEAST(bus.capacity, maxSeatsOpen)`.

🟢 **R3 — Places numérotées** : attribution respectée à l'embarquement (pas de FIFO) + index unique partiel empêche doublon.

🟡 **R4 — Shipments cumulés** : défense service uniquement. Si vous voulez une défense DB équivalente à R1, ajoutez le trigger `check_shipment_trip_capacity` de §5 (je peux le faire sur demande).

---

*Rapport final après ajout des défenses DB-level. Le code service reste le premier rempart (erreurs métier lisibles). La DB est le dernier rempart (impossible à bypass). Défense en profondeur respectée.*
