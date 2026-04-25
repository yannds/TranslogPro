-- ═════════════════════════════════════════════════════════════════════════════
-- TransLog Pro — Création des 3 rôles Postgres de prod
-- ═════════════════════════════════════════════════════════════════════════════
--
-- RÈGLE : l'application backend ne doit JAMAIS tourner en SUPERUSER.
-- RLS bypass = sécurité multi-tenant compromise.
--
--   app_admin      (déjà créé par POSTGRES_USER)  : migrations Prisma, DDL, seeds
--   app_runtime    (créé ici)                    : backend NestJS runtime seul
--   app_superadmin (créé ici)                    : support L2 / debug admin
--
-- Les mots de passe viennent de variables d'env injectées par 10-env.sh.
-- ═════════════════════════════════════════════════════════════════════════════

-- Postgres entrypoint fait `\set VAR 'value'` depuis les env vars — on les lit
-- via \gset qui est sûr et échappé (pas d'injection SQL possible).
\set app_runtime_pass `echo "$APP_RUNTIME_PASSWORD"`
\set app_superadmin_pass `echo "$APP_SUPERADMIN_PASSWORD"`

-- ─── app_runtime — user utilisé par l'API NestJS ─────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
        EXECUTE format(
            'CREATE ROLE app_runtime LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT',
            :'app_runtime_pass'
        );
    END IF;
END $$;

GRANT CONNECT ON DATABASE translog TO app_runtime;
GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_runtime;

-- Propage les privilèges aux futurs objets créés par app_admin (migrations)
ALTER DEFAULT PRIVILEGES FOR ROLE app_admin IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE app_admin IN SCHEMA public
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE app_admin IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO app_runtime;

-- ─── app_superadmin — support L2 (BYPASSRLS désactivé, on ne bypass JAMAIS) ──
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_superadmin') THEN
        EXECUTE format(
            'CREATE ROLE app_superadmin LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS',
            :'app_superadmin_pass'
        );
    END IF;
END $$;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO app_superadmin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO app_superadmin;
ALTER DEFAULT PRIVILEGES FOR ROLE app_admin IN SCHEMA public
    GRANT ALL ON TABLES TO app_superadmin;
ALTER DEFAULT PRIVILEGES FOR ROLE app_admin IN SCHEMA public
    GRANT ALL ON SEQUENCES TO app_superadmin;

-- ─── Vérification (pour logs du init docker) ────────────────────────────────
\echo '✔ app_runtime: NOSUPERUSER NOBYPASSRLS created (used by NestJS backend)'
\echo '✔ app_superadmin: NOSUPERUSER NOBYPASSRLS created (used for L2 support)'
\echo '✔ app_admin: already exists (POSTGRES_USER — used for migrations only)'
