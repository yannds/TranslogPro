-- ============================================================
-- TransLog Pro — RLS Policies v2 (nouvelles tables)
-- Complément de 01-rls.sql — à exécuter après prisma migrate
-- ============================================================
--
-- Tables ajoutées depuis la v1 :
--   tenant-scoped : trip_events, safety_alerts, feedbacks, ratings,
--                   crew_assignments, public_reports, campaigns,
--                   gps_positions, trip_templates, notifications
--
--   cross-tenant  : impersonation_sessions  ← PAS de RLS tenant classique
--                   role_permissions        ← pas de tenant_id
--                   waypoints               ← pas de tenant_id
--
-- Stratégie ImpersonationSession :
--   Ces sessions sont cross-tenant par nature (actorTenantId = 0000...,
--   targetTenantId = client). La RLS tenant standard ne s'applique pas.
--   L'accès est contrôlé UNIQUEMENT au niveau applicatif (ImpersonationGuard
--   + PermissionGuard + PLATFORM_TENANT_ID check).
--   On active RLS mais avec une politique restrictive qui autorise:
--     - app_superadmin : accès complet (monitoring plateforme)
--     - app_user : accès si actorTenantId OU targetTenantId correspond au tenant courant
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- Tables tenant-scoped standard (même pattern que 01-rls.sql)
-- ─────────────────────────────────────────────────────────────

DO $apply_rls_v2$ DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    'trip_events',
    'safety_alerts',
    'feedbacks',
    'ratings',
    'crew_assignments',
    'public_reports',
    'campaigns',
    'gps_positions',
    'trip_templates',
    'notifications'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    -- Activer RLS
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);

    -- Supprimer les politiques existantes (idempotent)
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS superadmin_bypass ON %I', tbl);

    -- Politique RESTRICTIVE : 0 ligne si app.tenant_id non défini
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
       AS RESTRICTIVE FOR ALL TO app_user
       USING ("tenantId" = current_tenant_id())',
      tbl
    );

    -- Super-Admin bypass complet
    EXECUTE format(
      'CREATE POLICY superadmin_bypass ON %I
       AS PERMISSIVE FOR ALL TO app_superadmin
       USING (true)',
      tbl
    );

    RAISE NOTICE 'RLS v2 applied to table: %', tbl;
  END LOOP;
END $apply_rls_v2$;

-- ─────────────────────────────────────────────────────────────
-- impersonation_sessions — politique spéciale cross-tenant
-- ─────────────────────────────────────────────────────────────

ALTER TABLE impersonation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE impersonation_sessions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS impersonation_actor_access  ON impersonation_sessions;
DROP POLICY IF EXISTS impersonation_target_access ON impersonation_sessions;
DROP POLICY IF EXISTS superadmin_bypass           ON impersonation_sessions;

-- Un acteur (SA/Support) voit ses propres sessions de n'importe quel tenant
-- Nécessaire car actorTenantId = PLATFORM (00000000-...) ≠ targetTenantId
CREATE POLICY impersonation_actor_access ON impersonation_sessions
  AS PERMISSIVE FOR SELECT TO app_user
  USING (
    "actorTenantId" = current_tenant_id()
    OR "targetTenantId" = current_tenant_id()
  );

-- Opérations d'écriture : uniquement si actorTenantId = tenant courant (plateforme)
CREATE POLICY impersonation_write_platform ON impersonation_sessions
  AS RESTRICTIVE FOR INSERT TO app_user
  WITH CHECK ("actorTenantId" = current_tenant_id());

CREATE POLICY impersonation_update_platform ON impersonation_sessions
  AS RESTRICTIVE FOR UPDATE TO app_user
  USING ("actorTenantId" = current_tenant_id());

-- Super-Admin : bypass complet (Control Plane audit)
CREATE POLICY superadmin_bypass ON impersonation_sessions
  AS PERMISSIVE FOR ALL TO app_superadmin
  USING (true);

RAISE NOTICE 'RLS v2 applied to table: impersonation_sessions (cross-tenant policy)';

-- ─────────────────────────────────────────────────────────────
-- Vérification : tables sans RLS intentionnelle
-- ─────────────────────────────────────────────────────────────
-- role_permissions : pas de tenant_id — accès contrôlé par FK roleId + PermissionGuard
-- waypoints        : pas de tenant_id — accès via routeId (tenant-scoped)
-- accounts         : Better Auth — pas de tenant_id
-- permissions      : table de catalogue — lecture seule, pas de RLS nécessaire
--
-- Ces tables restent sans RLS par décision d'architecture.
-- L'isolation est garantie par les FKs et le code applicatif.

-- ─────────────────────────────────────────────────────────────
-- Index supplémentaires pour les nouvelles tables
-- (voir aussi 02-indexes.sql pour les index existants)
-- ─────────────────────────────────────────────────────────────

-- Nettoyage RGPD : PublicReport.reporterGpsExpireAt — partiel index pour le scheduler
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_public_reports_gps_expiry
  ON public_reports ("reporterGpsExpireAt")
  WHERE "reporterGpsExpireAt" IS NOT NULL;

-- GPS lookup : dernier point par trajet (TrackingGateway + manifest)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gps_positions_latest
  ON gps_positions ("tripId", "recordedAt" DESC);

-- Notifications non lues : query rapide pour l'onglet "mes notifications"
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_unread
  ON notifications ("tenantId", "userId", "status")
  WHERE "status" != 'READ';

-- ImpersonationSession : lookup par tokenHash (révocation)
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_impersonation_token_hash
  ON impersonation_sessions ("tokenHash");

-- ImpersonationSession : sessions actives non expirées (audit monitoring)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_impersonation_active
  ON impersonation_sessions ("status", "expiresAt")
  WHERE "status" = 'ACTIVE';

-- ─────────────────────────────────────────────────────────────
-- GRANT pour les nouvelles tables (nouvelles tables créées après le GRANT ALL initial)
-- ─────────────────────────────────────────────────────────────

GRANT ALL PRIVILEGES ON TABLE
  trip_events,
  safety_alerts,
  feedbacks,
  ratings,
  crew_assignments,
  public_reports,
  campaigns,
  gps_positions,
  trip_templates,
  notifications,
  impersonation_sessions
TO app_user, app_superadmin;
