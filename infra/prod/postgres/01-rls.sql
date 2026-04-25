-- ============================================================
-- TransLog Pro — RLS Policies (Row Level Security)
-- Mode RESTRICTIVE : fail-closed si app.tenant_id non défini
-- ============================================================

-- Création du rôle applicatif (exécuté en migration initiale)
DO $$ BEGIN
  CREATE ROLE app_user NOINHERIT LOGIN PASSWORD 'app_password';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE ROLE app_superadmin NOINHERIT LOGIN PASSWORD 'superadmin_password';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Grants de base
GRANT CONNECT ON DATABASE translog TO app_user, app_superadmin;
GRANT USAGE ON SCHEMA public TO app_user, app_superadmin;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO app_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO app_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO app_superadmin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO app_superadmin;

-- ─────────────────────────────────────────────────────────────
-- Macro pour appliquer RLS RESTRICTIVE sur une table
-- ─────────────────────────────────────────────────────────────
-- Pattern répété pour chaque table avec tenant_id

-- Helper function pour récupérer le tenant_id courant
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS TEXT AS $$
BEGIN
  RETURN current_setting('app.tenant_id', true);
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- ─────────────────────────────────────────────────────────────
-- Tables avec tenant_id (isolation totale)
-- ─────────────────────────────────────────────────────────────

DO $apply_rls$ DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    'tenants', 'agencies', 'users', 'roles',
    'installed_modules', 'notification_preferences',
    'workflow_configs', 'workflow_transitions',
    'audit_logs', 'outbox_events', 'dead_letter_events',
    'stations', 'routes', 'buses', 'staff',
    'trips', 'checklists', 'incidents', 'maintenance_reports',
    'tickets', 'travelers', 'baggages',
    'parcels', 'shipments',
    'pricing_rules', 'cash_registers', 'transactions',
    'lost_found_items', 'claims'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    -- Activer RLS
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);

    -- Supprimer les politiques existantes
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS superadmin_bypass ON %I', tbl);

    -- Politique RESTRICTIVE : 0 ligne si tenant_id non défini
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
       AS RESTRICTIVE FOR ALL TO app_user
       USING ("tenantId" = current_tenant_id())',
      tbl
    );

    -- Super-Admin : bypass complet (Control Plane)
    EXECUTE format(
      'CREATE POLICY superadmin_bypass ON %I
       AS PERMISSIVE FOR ALL TO app_superadmin
       USING (true)',
      tbl
    );

    RAISE NOTICE 'RLS applied to table: %', tbl;
  END LOOP;
END $apply_rls$;

-- ─────────────────────────────────────────────────────────────
-- Tables sans tenant_id (globales)
-- ─────────────────────────────────────────────────────────────
-- permissions, role_permissions, sessions, accounts, waypoints
-- Ces tables ne portent pas de tenant_id — pas de RLS par ligne
-- Leur accès est contrôlé par les FK et le PermissionGuard applicatif

-- ─────────────────────────────────────────────────────────────
-- Partitionnement AuditLog (RANGE mensuel)
-- ─────────────────────────────────────────────────────────────
-- Note: La table audit_logs doit être créée SANS contrainte unique sur id
-- pour permettre le partitionnement. Créée via migration Prisma puis modifiée.

-- Création de la table partitionnée (à exécuter après prisma migrate)
-- ALTER TABLE audit_logs RENAME TO audit_logs_old;
-- CREATE TABLE audit_logs (LIKE audit_logs_old INCLUDING ALL) PARTITION BY RANGE ("createdAt");
-- INSERT INTO audit_logs SELECT * FROM audit_logs_old;
-- DROP TABLE audit_logs_old;

-- Partitions initiales (2026)
CREATE TABLE IF NOT EXISTS audit_logs_2026_01 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_02 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_03 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_04 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_05 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_06 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_07 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_08 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_09 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_10 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_11 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE IF NOT EXISTS audit_logs_2026_12 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

-- Fonction pour créer automatiquement la partition du mois suivant
CREATE OR REPLACE FUNCTION create_next_audit_partition()
RETURNS void AS $$
DECLARE
  next_month DATE := date_trunc('month', now()) + INTERVAL '1 month';
  partition_name TEXT;
  start_date TEXT;
  end_date TEXT;
BEGIN
  partition_name := 'audit_logs_' || to_char(next_month, 'YYYY_MM');
  start_date := to_char(next_month, 'YYYY-MM-DD');
  end_date := to_char(next_month + INTERVAL '1 month', 'YYYY-MM-DD');

  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE tablename = partition_name
  ) THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF audit_logs FOR VALUES FROM (%L) TO (%L)',
      partition_name, start_date, end_date
    );
    RAISE NOTICE 'Created partition: %', partition_name;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- pg_cron job pour créer automatiquement la partition chaque mois
-- (nécessite l'extension pg_cron)
-- SELECT cron.schedule('create-audit-partition', '0 0 25 * *', 'SELECT create_next_audit_partition()');
