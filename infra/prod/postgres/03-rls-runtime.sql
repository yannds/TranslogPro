-- ═════════════════════════════════════════════════════════════════════════════
-- TransLog Pro — RLS Runtime (audit Vague 3-C, 2026-04-26)
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Objectif HIGH-4 : activer Row-Level Security sur toutes les tables
-- portant une colonne `tenantId` afin d'isoler les données par tenant
-- au niveau Postgres (défense en profondeur, en plus du filtre applicatif).
--
-- Mode PERMISSIVE adopté : si `current_tenant_id()` retourne NULL ou '',
-- toutes les lignes sont visibles (backward compat avec les services qui
-- n'ont pas encore migré vers `prisma.transact()` ou `prisma.withTenant()`).
--
-- Plus tard (V4) : audit du backend + bascule RESTRICTIVE strict.
--
-- Idempotent : DROP POLICY IF EXISTS avant CREATE.
-- À exécuter en tant que `app_admin` (SUPERUSER) :
--   docker exec ... psql -U app_admin -d translog -f 03-rls-runtime.sql
-- ═════════════════════════════════════════════════════════════════════════════

-- Helper function (probablement déjà existante via 01-rls.sql)
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS TEXT AS $$
BEGIN
  RETURN current_setting('app.tenant_id', true);
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Boucle sur toutes les tables ayant une colonne `tenantId`
-- ─────────────────────────────────────────────────────────────────────────────
DO $rls_runtime$
DECLARE
  tbl record;
  policy_count int := 0;
BEGIN
  FOR tbl IN
    SELECT DISTINCT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'tenantId'
    ORDER BY c.table_name
  LOOP
    -- Activer RLS (idempotent — pas d'erreur si déjà activé)
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl.table_name);

    -- Drop des policies existantes (idempotence)
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_runtime ON %I', tbl.table_name);
    EXECUTE format('DROP POLICY IF EXISTS bypass_admin ON %I', tbl.table_name);

    -- Policy app_runtime : isolation tenant avec fallback NULL/empty (backward compat)
    -- Le cast ::text gère les colonnes UUID et TEXT uniformément.
    EXECUTE format($f$
      CREATE POLICY tenant_isolation_runtime ON %I
        AS PERMISSIVE FOR ALL TO app_runtime
        USING (
          current_tenant_id() IS NULL
          OR current_tenant_id() = ''
          OR "tenantId"::text = current_tenant_id()
        )
        WITH CHECK (
          current_tenant_id() IS NULL
          OR current_tenant_id() = ''
          OR "tenantId"::text = current_tenant_id()
        )
    $f$, tbl.table_name);

    -- Policy app_admin : bypass total (migrations, seeds, support)
    EXECUTE format($f$
      CREATE POLICY bypass_admin ON %I
        AS PERMISSIVE FOR ALL TO app_admin
        USING (true)
        WITH CHECK (true)
    $f$, tbl.table_name);

    policy_count := policy_count + 1;
  END LOOP;

  RAISE NOTICE 'RLS activée sur % tables (mode PERMISSIVE backward-compat)', policy_count;
END $rls_runtime$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Vérification
-- ─────────────────────────────────────────────────────────────────────────────
SELECT count(*) AS tables_with_rls
FROM pg_tables
WHERE schemaname = 'public' AND rowsecurity = true;

SELECT count(*) AS total_policies
FROM pg_policies
WHERE schemaname = 'public';
