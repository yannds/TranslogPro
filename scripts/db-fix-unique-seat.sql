-- ═══════════════════════════════════════════════════════════════════════
-- FIX SÉCURITÉ : Contrainte unique partielle (tripId, seatNumber) ACTIVE
-- ═══════════════════════════════════════════════════════════════════════
--
-- CONTEXTE
--   Avant ce fix, le service ticketing (TicketingService.issueBatch) vérifie
--   `occupiedSeats.has(seatNumber)` en lecture pure (ligne 338). C'est
--   vulnérable à une race-condition : 2 requêtes simultanées peuvent lire
--   la même liste "vide", passer le check, et créer DEUX tickets pour
--   le MÊME siège sur le MÊME trip.
--
--   Le test Playwright [BUSINESS-RULES v7] confirme que :
--     prisma.ticket.create({ ... seatNumber: '1-1' ... })
--   RÉUSSIT même si un autre ticket avec seat 1-1 existe déjà sur le trip.
--
-- REMÉDIATION
--   Index unique PARTIEL PostgreSQL qui couvre UNIQUEMENT les billets
--   "actifs" (pas annulés/expirés/remboursés). Un CANCELLED qui conserve
--   son seatNumber pour l'historique n'entre pas en conflit avec une
--   nouvelle vente.
--
-- COMPATIBILITÉ
--   - Prisma ne gère pas les index PARTIELS dans @@unique → SQL raw requis.
--   - Idempotent (CREATE ... IF NOT EXISTS).
--   - Sans impact performance (très peu de doublons potentiels).
--
-- APPLICATION
--   psql translog -f scripts/db-fix-unique-seat.sql
--   OU via Prisma au boot :
--     await prisma.$executeRawUnsafe(require('fs').readFileSync('scripts/db-fix-unique-seat.sql','utf-8'));
-- ═══════════════════════════════════════════════════════════════════════

-- Étape 1 : nettoyer les éventuels doublons existants (garde le plus récent actif)
-- NOTE : en prod, valider manuellement avant d'exécuter ceci.
WITH duplicates AS (
  SELECT id, "tripId", "seatNumber", "createdAt",
    ROW_NUMBER() OVER (
      PARTITION BY "tripId", "seatNumber"
      ORDER BY "createdAt" DESC
    ) AS rn
  FROM tickets
  WHERE "seatNumber" IS NOT NULL
    AND status NOT IN ('CANCELLED','EXPIRED','REFUNDED','NO_SHOW','FORFEITED')
)
UPDATE tickets SET "seatNumber" = NULL
WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

-- Étape 2 : créer l'index partiel unique
CREATE UNIQUE INDEX IF NOT EXISTS "tickets_active_seat_unique"
  ON tickets ("tripId", "seatNumber")
  WHERE "seatNumber" IS NOT NULL
    AND status NOT IN ('CANCELLED','EXPIRED','REFUNDED','NO_SHOW','FORFEITED');

-- Vérification
-- SELECT indexname, indexdef FROM pg_indexes
--   WHERE tablename = 'tickets' AND indexname = 'tickets_active_seat_unique';
