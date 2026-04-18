-- ============================================================
-- TransLog Pro — RLS backfill complet Phase 1
-- ============================================================
-- Idempotent — safe à rejouer à chaque dev-up.sh.
--
-- Objectif : couvrir TOUTES les tables qui ont une colonne `tenantId` avec
-- la RLS RESTRICTIVE + WITH CHECK, non plus juste les 29 tables initiales.
--
-- Le script précédent (01-rls.sql) listait 29 tables. Depuis, 65+ tables
-- ont été ajoutées au schéma et n'ont jamais été couvertes — faille
-- critique identifiée par audit sécu infra (rapport 2026-04-18).
--
-- Ce script :
--   1. Active RLS + FORCE sur toutes les tables avec `tenantId`
--   2. Policy RESTRICTIVE `tenant_isolation` avec WITH CHECK
--      (couvre SELECT/INSERT/UPDATE/DELETE, bloque cross-tenant write)
--   3. Policy PERMISSIVE `superadmin_bypass` pour app_superadmin
--   4. Index sur `tenantId` si absent (perf)
--
-- POLICY WITH CHECK ajouté VS les anciennes politiques — un INSERT/UPDATE
-- avec un mauvais tenantId est maintenant REJETÉ (pas juste ignoré).
-- ============================================================

-- Helper current_tenant_id() garanti présent (copie défensive de 01-rls.sql)
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS TEXT AS $$
BEGIN
  RETURN current_setting('app.tenant_id', true);
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- ─────────────────────────────────────────────────────────────
-- Rôle RUNTIME dédié (non-superuser) pour les requêtes applicatives.
--
-- POURQUOI : en dev, Docker Postgres crée `app_user` comme SUPERUSER (via
-- POSTGRES_USER). Un SUPERUSER bypasse TOUTES les policies RLS (règle PG).
-- Résultat : même avec RLS activée, les queries app_user ignorent les
-- policies — RLS inefficace !
--
-- FIX : créer `app_runtime` (NOSUPERUSER, NOBYPASSRLS) avec juste les
-- privilèges DML. L'application NestJS se connecte en app_runtime via la
-- DATABASE_URL dans Vault. Les migrations Prisma continuent d'utiliser
-- app_user (SUPERUSER) via .env local / connexion admin en prod.
--
-- En prod (Postgres managé : Neon, AWS RDS, etc.), la convention est déjà
-- qu'il y ait un admin role pour migrations + un app role non-superuser
-- pour le runtime. Ce script pose le même pattern en dev.
-- ─────────────────────────────────────────────────────────────
DO $create_runtime$ BEGIN
  CREATE ROLE app_runtime
    LOGIN PASSWORD 'app_runtime_password'
    NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
EXCEPTION WHEN duplicate_object THEN
  -- S'assurer qu'il n'a toujours PAS les attributs dangereux (idempotence)
  ALTER ROLE app_runtime NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
END $create_runtime$;

-- Grants pour les rôles applicatifs (idempotent)
GRANT CONNECT ON DATABASE translog TO app_runtime;
GRANT USAGE   ON SCHEMA public     TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT, UPDATE           ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
-- Auto-grant sur les futures tables créées par les migrations
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE           ON SEQUENCES TO app_runtime;

-- Conservation des grants pour app_user (migration) et app_superadmin (control plane)
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO app_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO app_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO app_superadmin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO app_superadmin;

-- ─────────────────────────────────────────────────────────────
-- Application auto : pour chaque table dans information_schema.columns
-- ayant la colonne `tenantId`, on applique la RLS.
-- ─────────────────────────────────────────────────────────────
DO $apply_rls_all$ DECLARE
  tbl   TEXT;
  idx   TEXT;
  cnt   INTEGER := 0;
BEGIN
  FOR tbl IN
    SELECT c.table_name
    FROM   information_schema.columns c
    WHERE  c.table_schema = 'public'
      AND  c.column_name  = 'tenantId'
      -- Exclure les tables partitionnées mères (audit_logs_YYYY_MM)
      AND  c.table_name NOT LIKE 'audit_logs_%'
    ORDER  BY c.table_name
  LOOP
    -- 1. Enable + FORCE RLS
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', tbl);

    -- 2. Drop policies existantes (tolère les deux variantes : ancienne sans
    --    WITH CHECK, nouvelle avec WITH CHECK) puis recrée proprement.
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation     ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_restrict_rw   ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS superadmin_bypass    ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS runtime_default_visibility ON %I', tbl);

    -- 3a. Policy PERMISSIVE pour app_runtime : base de visibilité (OR-combined
    --     avec les autres permissives). Sans ça, une RESTRICTIVE seule laisse
    --     toujours 0 ligne (règle PostgreSQL : il faut au moins une PERMISSIVE
    --     qui passe AND-ée avec toutes les RESTRICTIVE qui passent).
    EXECUTE format(
      'CREATE POLICY runtime_default_visibility ON %I
       AS PERMISSIVE FOR ALL TO app_runtime
       USING (true)
       WITH CHECK (true)',
      tbl
    );

    -- 3b. Policy RESTRICTIVE : filter tenant-scope. AND-ée avec 3a pour
    --     app_runtime. Bloque TOUTE lecture/écriture cross-tenant.
    --     Sans app.tenant_id défini, current_tenant_id() = NULL → 0 ligne
    --     (NULL = NULL est toujours FALSE en SQL 3VL).
    EXECUTE format(
      'CREATE POLICY tenant_restrict_rw ON %I
       AS RESTRICTIVE FOR ALL TO app_runtime
       USING       ("tenantId" = current_tenant_id())
       WITH CHECK  ("tenantId" = current_tenant_id())',
      tbl
    );

    -- 4. Super-Admin bypass (control plane — SA plateforme)
    EXECUTE format(
      'CREATE POLICY superadmin_bypass ON %I
       AS PERMISSIVE FOR ALL TO app_superadmin
       USING (true)
       WITH CHECK (true)',
      tbl
    );

    -- 5. Index sur tenantId si absent (perf). Nom canonique : idx_{tbl}_tenant.
    idx := format('idx_%s_tenant', tbl);
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = tbl AND indexname = idx
    ) THEN
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("tenantId")', idx, tbl);
    END IF;

    cnt := cnt + 1;
  END LOOP;

  RAISE NOTICE '[RLS backfill] Applied to % tables', cnt;
END $apply_rls_all$;

-- ─────────────────────────────────────────────────────────────
-- Sanity check : s'assurer qu'app_runtime (role utilisé par le backend)
-- N'A PAS l'attribut BYPASSRLS ni SUPERUSER, sinon RLS contournée.
-- ─────────────────────────────────────────────────────────────
DO $bypass_check$ DECLARE
  byp BOOLEAN;
  sup BOOLEAN;
BEGIN
  SELECT rolbypassrls, rolsuper INTO byp, sup FROM pg_roles WHERE rolname = 'app_runtime';
  IF byp OR sup THEN
    RAISE EXCEPTION 'SECURITY: app_runtime has SUPERUSER or BYPASSRLS — RLS is INEFFECTIVE';
  END IF;

  -- app_user reste SUPERUSER dans le setup Docker dev (POSTGRES_USER) ; c'est
  -- ATTENDU — utilisé pour migrations/admin. Le backend NE DOIT PAS utiliser
  -- app_user en runtime (switcher DATABASE_URL vers app_runtime via Vault).
  SELECT rolsuper INTO sup FROM pg_roles WHERE rolname = 'app_user';
  IF sup THEN
    RAISE NOTICE 'INFO: app_user is SUPERUSER — réservé MIGRATIONS. Backend doit connect via app_runtime.';
  END IF;
END $bypass_check$;

-- ─────────────────────────────────────────────────────────────
-- Back-update des policies qui existaient SANS WITH CHECK
-- (01-rls.sql et 02-rls-new-tables.sql original n'avaient que USING).
-- Le DO block ci-dessus les a déjà droppées+recréées avec WITH CHECK,
-- mais ce bloc final log un verdict.
-- ─────────────────────────────────────────────────────────────
DO $verify_with_check$ DECLARE
  missing_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO missing_count
  FROM   pg_policies
  WHERE  schemaname = 'public'
    AND  policyname = 'tenant_restrict_rw'
    AND  with_check IS NULL;

  IF missing_count > 0 THEN
    RAISE WARNING '[RLS] % restrictive policies without WITH CHECK (needs re-run)', missing_count;
  ELSE
    RAISE NOTICE '[RLS] All tenant_restrict_rw policies have WITH CHECK ✓';
  END IF;
END $verify_with_check$;
