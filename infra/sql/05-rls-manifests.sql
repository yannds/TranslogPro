-- ============================================================
-- TransLog Pro — RLS pour la table `manifests`
--
-- Contexte : la table manifests a été ajoutée le 2026-04-19 pour aligner le
-- cycle de vie des manifestes sur le blueprint `manifest-standard` via le
-- WorkflowEngine. Elle doit être isolée par tenant au niveau PG (même pattern
-- que les autres tables tenant-scoped — cf. 02-rls-new-tables.sql).
--
-- Idempotent : peut être rejoué sans effet.
-- ============================================================

ALTER TABLE manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE manifests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation  ON manifests;
DROP POLICY IF EXISTS superadmin_bypass ON manifests;

-- Politique RESTRICTIVE : 0 ligne si app.tenant_id non défini
CREATE POLICY tenant_isolation ON manifests
  AS RESTRICTIVE FOR ALL TO app_user
  USING ("tenantId" = current_tenant_id());

-- Super-Admin bypass complet (Control Plane audit)
CREATE POLICY superadmin_bypass ON manifests
  AS PERMISSIVE FOR ALL TO app_superadmin
  USING (true);

-- Vérif rapide : affiche la config RLS
SELECT relname,
       relrowsecurity   AS enabled,
       relforcerowsecurity AS forced
  FROM pg_class
 WHERE relname = 'manifests';
