-- ============================================================
-- Multi-Tenant Isolation — Phase 1
-- ============================================================
-- Idempotent — safe à rejouer.
--
-- Changements :
--   1. users.email : drop unique global (si existe), add unique (tenant_id, email)
--   2. accounts : add tenant_id (backfill from users), NOT NULL, FK, unique (tenant_id, provider_id, account_id)
--   3. tenant_domains : nouvelle table + seed 1 ligne par tenant ({slug}.translogpro.com)
--
-- Ordre d'exécution :
--   - Ce script est appelé par dev.sh AVANT `prisma db push`
--     pour que les données soient en place avant que Prisma valide les contraintes.
--   - En prod : appliqué via `psql` pendant la fenêtre de maintenance du cutover
--     (voir runbook PHASE1_CUTOVER.md).
-- ============================================================

-- ─── 1. users : unique par (tenant_id, email) ──────────────────────────────

-- Drop l'index unique global sur email (peut ne pas exister si déjà migré)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'users' AND indexname = 'users_email_key'
  ) THEN
    EXECUTE 'DROP INDEX IF EXISTS public.users_email_key';
    RAISE NOTICE 'Dropped index users_email_key (global unique on email)';
  END IF;
END $$;

-- Add unique (tenant_id, email) si pas déjà présent
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'users' AND indexname = 'users_tenantId_email_key'
  ) THEN
    CREATE UNIQUE INDEX "users_tenantId_email_key" ON public.users ("tenantId", email);
    RAISE NOTICE 'Created unique index users_tenantId_email_key';
  END IF;
END $$;

-- ─── 2. accounts : add tenant_id + backfill + NOT NULL + FK + unique ──────

-- 2a. Ajout de la colonne nullable
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS "tenantId" TEXT;

-- 2b. Backfill depuis User (idempotent via WHERE tenantId IS NULL)
UPDATE public.accounts AS a
SET    "tenantId" = u."tenantId"
FROM   public.users AS u
WHERE  a."userId" = u.id
  AND  a."tenantId" IS NULL;

-- 2c. Vérification : aucune ligne ne doit rester avec tenantId NULL
DO $$
DECLARE orphans INT;
BEGIN
  SELECT COUNT(*) INTO orphans FROM public.accounts WHERE "tenantId" IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION 'Backfill failed: % account(s) without tenantId', orphans;
  END IF;
END $$;

-- 2d. NOT NULL
ALTER TABLE public.accounts
  ALTER COLUMN "tenantId" SET NOT NULL;

-- 2e. Foreign Key vers tenants (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'accounts_tenantId_fkey'
  ) THEN
    ALTER TABLE public.accounts
      ADD CONSTRAINT "accounts_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES public.tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 2f. Drop ancien unique (providerId, accountId), add nouveau (tenantId, providerId, accountId)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'accounts' AND indexname = 'accounts_providerId_accountId_key'
  ) THEN
    EXECUTE 'DROP INDEX IF EXISTS public."accounts_providerId_accountId_key"';
    RAISE NOTICE 'Dropped accounts_providerId_accountId_key (legacy global unique)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'accounts' AND indexname = 'accounts_tenantId_providerId_accountId_key'
  ) THEN
    CREATE UNIQUE INDEX "accounts_tenantId_providerId_accountId_key"
      ON public.accounts ("tenantId", "providerId", "accountId");
    RAISE NOTICE 'Created accounts_tenantId_providerId_accountId_key';
  END IF;
END $$;

-- 2g. Index secondaire sur tenantId seul (pour lookups tenant-scoped)
CREATE INDEX IF NOT EXISTS "accounts_tenantId_idx" ON public.accounts ("tenantId");

-- ─── 3. tenant_domains : nouvelle table ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tenant_domains (
  id           TEXT         NOT NULL,
  "tenantId"   TEXT         NOT NULL,
  hostname     TEXT         NOT NULL,
  "isPrimary"  BOOLEAN      NOT NULL DEFAULT FALSE,
  "verifiedAt" TIMESTAMP(3),
  "certStatus" TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tenant_domains_pkey PRIMARY KEY (id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_domains_tenantId_fkey') THEN
    ALTER TABLE public.tenant_domains
      ADD CONSTRAINT "tenant_domains_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES public.tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_domains_hostname_key"
  ON public.tenant_domains (hostname);

CREATE INDEX IF NOT EXISTS "tenant_domains_tenantId_idx"
  ON public.tenant_domains ("tenantId");

CREATE INDEX IF NOT EXISTS "tenant_domains_tenantId_isPrimary_idx"
  ON public.tenant_domains ("tenantId", "isPrimary");

-- ─── 4. Seed tenant_domains — DÉPLACÉ dans scripts/seed-tenant-domains.sh
-- Pourquoi : le hostname dépend de $PLATFORM_BASE_DOMAIN (dev vs prod).
-- Hardcoder 2 valeurs ici aboutissait à des lignes "fantômes" (ex: seed
-- "*.translog.test" sur une DB prod). Le seed est maintenant shell-templated
-- et tire sa valeur de scripts/dev.config.sh (dev) ou du runbook prod.
--
-- Ce fichier ne fait donc plus QUE du schema migration (idempotent).
