-- ═════════════════════════════════════════════════════════════════════════════
-- TransLog Pro — RLS RESTRICTIVE Tier 1 (V6.2 batch 1)
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Bascule la RLS de PERMISSIVE → RESTRICTIVE pour 20 tables catalog/config
-- (HTTP-driven uniquement, pas de cron/webhook/listener qui les touche).
--
-- Avant : PERMISSIVE avec fallback NULL/empty (backward-compat) — si
-- current_tenant_id() est non posé, toutes les lignes passent.
-- Après : PERMISSIVE allow_runtime (pour donner visibilité au rôle) +
-- RESTRICTIVE tenant_isolation_strict (filtre strict, 0 ligne si NULL).
--
-- Rollback table par table (instantané) :
--   ALTER TABLE <tablename> DISABLE ROW LEVEL SECURITY;
-- ou rollback global :
--   DROP POLICY tenant_isolation_strict ON <tablename>;
--   (les anciennes policies PERMISSIVE backward-compat sont restaurables
--    en relançant 03-rls-runtime.sql)
--
-- À exécuter en tant que `app_admin` (SUPERUSER) :
--   docker exec -i $(docker ps -q -f name=translog_postgres) \
--     psql -U app_admin -d translog -f 06-rls-restrictive-tier1.sql
-- ═════════════════════════════════════════════════════════════════════════════

\echo '── Tier 1 RESTRICTIVE bascule START'

BEGIN;

DO $tier1$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    -- IAM & infra tenant (HTTP-only via /admin/iam, /admin/agencies)
    'agencies',
    'roles',

    -- Géo & flotte référentiel (HTTP via admin)
    'routes',
    'stations',
    'toll_points',

    -- Config tarifaire (HTTP via /admin/settings/rules, /admin/pricing)
    'tenant_business_configs',
    'tenant_fare_classes',
    'pricing_rules',
    'tariff_grids',
    'promotions',
    'peak_periods',

    -- QHSE templates (HTTP via /admin/qhse)
    'briefing_templates',
    'briefing_sections',
    'briefing_items',
    'briefing_equipment_types',

    -- Documents (HTTP via /admin/documents)
    'document_templates',

    -- Driver config référentiel (HTTP via /admin/drivers)
    'driver_remediation_rules',
    'driver_training_types',

    -- Référentiels divers (HTTP only)
    'accident_severity_types',
    'bus_cost_profiles'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    -- 1. Force RLS (même pour table owner)
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);

    -- 2. Drop des policies existantes (idempotent)
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_runtime ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_strict  ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS allow_runtime            ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS bypass_admin             ON %I', tbl);

    -- 3. PERMISSIVE allow_runtime : donne visibilité au rôle app_runtime
    --    (sans cela les RESTRICTIVE seules bloqueraient TOUT)
    EXECUTE format($f$
      CREATE POLICY allow_runtime ON %I
        AS PERMISSIVE FOR ALL TO app_runtime
        USING (true) WITH CHECK (true)
    $f$, tbl);

    -- 4. RESTRICTIVE tenant_isolation_strict : filtre STRICT (pas de NULL fallback)
    EXECUTE format($f$
      CREATE POLICY tenant_isolation_strict ON %I
        AS RESTRICTIVE FOR ALL TO app_runtime
        USING ("tenantId"::text = current_tenant_id())
        WITH CHECK ("tenantId"::text = current_tenant_id())
    $f$, tbl);

    -- 5. PERMISSIVE bypass_admin : app_admin (migrations, support L2) bypass total
    EXECUTE format($f$
      CREATE POLICY bypass_admin ON %I
        AS PERMISSIVE FOR ALL TO app_admin
        USING (true) WITH CHECK (true)
    $f$, tbl);

    RAISE NOTICE 'Tier 1 RESTRICTIVE applied: %', tbl;
  END LOOP;
END
$tier1$;

COMMIT;

\echo '── Tier 1 RESTRICTIVE bascule DONE — verification'

-- ─────────────────────────────────────────────────────────────────────────────
-- Vérification : doit afficher 3 policies par table (allow_runtime PERMISSIVE,
-- tenant_isolation_strict RESTRICTIVE, bypass_admin PERMISSIVE)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  tablename,
  policyname,
  CASE WHEN permissive = 'PERMISSIVE' THEN 'P' ELSE 'R' END AS type,
  array_to_string(roles, ',') AS roles,
  cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'agencies', 'roles',
    'routes', 'stations', 'toll_points',
    'tenant_business_configs', 'tenant_fare_classes',
    'pricing_rules', 'tariff_grids', 'promotions', 'peak_periods',
    'briefing_templates', 'briefing_sections', 'briefing_items', 'briefing_equipment_types',
    'document_templates',
    'driver_remediation_rules', 'driver_training_types',
    'accident_severity_types', 'bus_cost_profiles'
  )
ORDER BY tablename, policyname;

\echo '── Tier 1 RESTRICTIVE bascule VERIFIED'
