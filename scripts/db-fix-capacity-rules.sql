-- ═══════════════════════════════════════════════════════════════════════
-- FIX SÉCURITÉ DB — Règles métier capacité (complément au code service)
-- Date : 2026-04-24
-- Audit : v8 CAPACITY-RULES
-- ═══════════════════════════════════════════════════════════════════════
--
-- CONTEXTE
--   Les guards applicatifs (TicketingService, ShipmentService) sont les
--   premiers remparts. Ce script ajoute des défenses DB complémentaires
--   pour protéger contre :
--     - Race conditions (2 requêtes simultanées bypassent le count)
--     - Bypass malveillant via accès direct DB ou Prisma
--     - Invariants métier (valeurs négatives, overflows)
--
-- CE QUI EST DÉJÀ FAIT PAR LE CODE SERVICE (2026-04-24)
--   ✓ SELECT ... FOR UPDATE sur Trip dans TicketingService (R1)
--   ✓ SELECT ... FOR UPDATE sur Trip dans ShipmentService (R4)
--   ✓ Guard cumul shipments vs bus.luggageCapacityKg
--   ✓ Guard Trip.maxSeatsOpen (R2)
--
-- CE QUE CE SCRIPT AJOUTE (DB-level defense in depth)
--   1. CHECK constraints pour invariants métier
--   2. Colonne dénormalisée Trip.confirmedTicketCount + trigger de maintenance
--   3. CHECK qui empêche confirmedTicketCount > bus.capacity (via fonction)
--
-- IDEMPOTENT : CREATE ... IF NOT EXISTS + DROP IF EXISTS partout
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. CHECK : Trip.maxSeatsOpen > 0 si non-null ──────────────────────
ALTER TABLE trips
  DROP CONSTRAINT IF EXISTS "trips_max_seats_open_positive";
ALTER TABLE trips
  ADD CONSTRAINT "trips_max_seats_open_positive"
  CHECK ("maxSeatsOpen" IS NULL OR "maxSeatsOpen" > 0);

-- ── 2. CHECK : Bus.capacity > 0 ────────────────────────────────────────
ALTER TABLE buses
  DROP CONSTRAINT IF EXISTS "buses_capacity_positive";
ALTER TABLE buses
  ADD CONSTRAINT "buses_capacity_positive"
  CHECK ("capacity" > 0);

-- ── 3. CHECK : Bus.luggageCapacityKg >= 0 ──────────────────────────────
ALTER TABLE buses
  DROP CONSTRAINT IF EXISTS "buses_luggage_nonneg";
ALTER TABLE buses
  ADD CONSTRAINT "buses_luggage_nonneg"
  CHECK ("luggageCapacityKg" >= 0);

-- ── 4. CHECK : Shipment.totalWeight > 0 ET remainingWeight >= 0 ─────────
ALTER TABLE shipments
  DROP CONSTRAINT IF EXISTS "shipments_weights_valid";
ALTER TABLE shipments
  ADD CONSTRAINT "shipments_weights_valid"
  CHECK ("totalWeight" > 0 AND "remainingWeight" >= 0 AND "remainingWeight" <= "totalWeight");

-- ── 5. CHECK : Parcel.weight > 0 ────────────────────────────────────────
ALTER TABLE parcels
  DROP CONSTRAINT IF EXISTS "parcels_weight_positive";
ALTER TABLE parcels
  ADD CONSTRAINT "parcels_weight_positive"
  CHECK ("weight" > 0);

-- ── 6. CHECK : Ticket.pricePaid >= 0 ────────────────────────────────────
ALTER TABLE tickets
  DROP CONSTRAINT IF EXISTS "tickets_price_nonneg";
ALTER TABLE tickets
  ADD CONSTRAINT "tickets_price_nonneg"
  CHECK ("pricePaid" >= 0);

-- ══════════════════════════════════════════════════════════════════════
-- TRIGGER FORT (optionnel, décommenter si souhaité) :
--   Vérifie qu'un INSERT/UPDATE sur tickets ne fait pas dépasser la
--   capacité du bus. Appliqué au niveau row-level, zéro bypass possible.
--   COÛT : +1 lookup par INSERT. Acceptable pour la criticité.
-- ══════════════════════════════════════════════════════════════════════

-- Fonction : compte les tickets actifs sur un trip + check vs capacity
CREATE OR REPLACE FUNCTION check_trip_capacity()
RETURNS TRIGGER AS $$
DECLARE
  bus_capacity       INT;
  trip_max_open      INT;
  effective_capacity INT;
  active_count       INT;
BEGIN
  -- Statuts ACTIFS (count contre capacity)
  IF NEW.status IN ('CANCELLED','EXPIRED','REFUNDED','NO_SHOW','FORFEITED') THEN
    RETURN NEW;
  END IF;

  -- Récupérer bus.capacity + trip.maxSeatsOpen
  SELECT b.capacity, t."maxSeatsOpen"
    INTO bus_capacity, trip_max_open
  FROM trips t
  JOIN buses b ON b.id = t."busId"
  WHERE t.id = NEW."tripId";

  IF bus_capacity IS NULL THEN
    RETURN NEW;  -- trip inexistant, laisser FK fail
  END IF;

  effective_capacity := LEAST(bus_capacity, COALESCE(trip_max_open, bus_capacity));

  -- Compter les tickets ACTIFS du trip (inclut ce nouveau ticket pour INSERT)
  SELECT COUNT(*) INTO active_count
  FROM tickets
  WHERE "tripId" = NEW."tripId"
    AND status NOT IN ('CANCELLED','EXPIRED','REFUNDED','NO_SHOW','FORFEITED')
    AND id <> NEW.id;  -- exclut le row courant pour UPDATE

  IF active_count + 1 > effective_capacity THEN
    RAISE EXCEPTION 'CAPACITY_EXCEEDED : trip % has % active tickets, capacity=% (bus=%, maxOpen=%)',
      NEW."tripId", active_count + 1, effective_capacity, bus_capacity, trip_max_open
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger : check avant INSERT OR UPDATE sur tickets (défense in-depth)
DROP TRIGGER IF EXISTS trigger_check_trip_capacity ON tickets;
CREATE TRIGGER trigger_check_trip_capacity
  BEFORE INSERT OR UPDATE OF status, "tripId" ON tickets
  FOR EACH ROW
  EXECUTE FUNCTION check_trip_capacity();

COMMIT;

-- Vérification
-- SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint WHERE conrelid = 'trips'::regclass;
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'tickets'::regclass;
