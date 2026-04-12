-- ============================================================
-- TransLog Pro — Index Critiques
-- Tous créés avec CONCURRENTLY pour éviter les locks en production
-- ============================================================

-- ─── WorkflowConfig — lookup du moteur (très haute fréquence) ──
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wf_config_lookup
  ON workflow_configs ("tenantId", "entityType", "fromState", "action")
  WHERE "isActive" = true;

-- ─── WorkflowTransition — check idempotence ───────────────────
-- (déjà unique sur idempotencyKey — index unique auto)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wf_transition_entity
  ON workflow_transitions ("entityType", "entityId");

-- ─── OutboxEvent — poller (critique path) ─────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_outbox_pending
  ON outbox_events (status, "scheduledAt")
  WHERE status = 'PENDING';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_outbox_tenant_type
  ON outbox_events ("tenantId", "eventType");

-- ─── AuditLog — compliance & BI ───────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_tenant_date
  ON audit_logs ("tenantId", "createdAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_resource
  ON audit_logs (resource);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_action
  ON audit_logs ("tenantId", action);

-- ─── Traveler — getStationDropOff() (critique temps réel) ─────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_traveler_dropoff
  ON travelers ("tripId", "dropOffStationId")
  WHERE status = 'BOARDED';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_traveler_trip_status
  ON travelers ("tenantId", "tripId", status);

-- ─── Trip — filtrage par status actifs ────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trip_active
  ON trips ("tenantId", status)
  WHERE status NOT IN ('COMPLETED', 'CANCELLED');

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trip_departure
  ON trips ("tenantId", "departureScheduled");

-- ─── Ticket — QR verify & listing ────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ticket_qr
  ON tickets ("qrCode");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ticket_trip_status
  ON tickets ("tenantId", "tripId", status);

-- ─── Parcel — tracking public ─────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_parcel_tracking_code
  ON parcels ("trackingCode");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_parcel_shipment
  ON parcels ("shipmentId")
  WHERE "shipmentId" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_parcel_destination
  ON parcels ("tenantId", "destinationId");

-- ─── Shipment — lookup par trip ───────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shipment_trip
  ON shipments ("tenantId", "tripId");

-- ─── Bus — disponibilité ──────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bus_status
  ON buses ("tenantId", status);

-- ─── Staff — disponibilité par rôle ──────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_staff_available
  ON staff ("tenantId", role, "isAvailable")
  WHERE "isAvailable" = true;

-- ─── Incident — SOS non résolus ──────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_incident_sos_unresolved
  ON incidents (severity, "resolvedAt")
  WHERE severity = 'SOS' AND "resolvedAt" IS NULL;

-- ─── CashRegister — sessions ouvertes par agence ─────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cashregister_open
  ON cash_registers ("tenantId", "agencyId", "auditStatus")
  WHERE "auditStatus" = 'OPEN';

-- ─── Transaction — réconciliation paiement ────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transaction_external_ref
  ON transactions ("externalRef")
  WHERE "externalRef" IS NOT NULL;

-- ─── DeadLetter — monitoring ──────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dlq_unresolved
  ON dead_letter_events ("tenantId", "resolvedAt")
  WHERE "resolvedAt" IS NULL;

-- ─── Session — cleanup des sessions expirées ─────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_session_expires
  ON sessions ("expiresAt");

-- Fonction utilitaire : cleanup des sessions expirées (à scheduler)
CREATE OR REPLACE FUNCTION cleanup_expired_sessions() RETURNS void AS $$
BEGIN
  DELETE FROM sessions WHERE "expiresAt" < NOW();
  RAISE NOTICE 'Expired sessions cleaned up at %', NOW();
END;
$$ LANGUAGE plpgsql;

-- Fonction utilitaire : cleanup des OutboxEvents delivered (>30 jours)
CREATE OR REPLACE FUNCTION cleanup_old_outbox_events() RETURNS void AS $$
BEGIN
  DELETE FROM outbox_events
  WHERE status IN ('DELIVERED', 'DEAD')
    AND "processedAt" < NOW() - INTERVAL '30 days';
  RAISE NOTICE 'Old outbox events cleaned up at %', NOW();
END;
$$ LANGUAGE plpgsql;
