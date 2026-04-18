#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# TransLog Pro — Seed tenant_domains (shell-templated)
# ═══════════════════════════════════════════════════════════════════
# Seede une ligne tenant_domains PRIMARY par tenant existant :
#   {slug}.${PLATFORM_BASE_DOMAIN}
#
# Idempotent : ON CONFLICT (hostname) DO NOTHING.
#
# Source de vérité du domaine : scripts/dev.config.sh (en dev)
# ou override via `PLATFORM_BASE_DOMAIN=... ./seed-tenant-domains.sh`.
#
# Pré-requis :
#   - Container translog-postgres en cours d'exécution
#   - Table tenants remplie (ce script tourne APRÈS le seed tenants)
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/dev.config.sh"

# Container name (ou override via env, si besoin staging/local différent)
PG_CONTAINER="${PG_CONTAINER:-translog-postgres}"
PG_USER="${PG_USER:-app_user}"
PG_DB="${PG_DB:-translog}"

docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" <<SQL
INSERT INTO public.tenant_domains (id, "tenantId", hostname, "isPrimary", "verifiedAt", "createdAt", "updatedAt")
SELECT
  'td_' || t.slug || '_${PLATFORM_BASE_DOMAIN//./_}',
  t.id,
  t.slug || '.${PLATFORM_BASE_DOMAIN}',
  TRUE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM public.tenants t
ON CONFLICT (hostname) DO NOTHING;

SELECT COUNT(*) AS seeded_domains FROM public.tenant_domains WHERE hostname LIKE '%.${PLATFORM_BASE_DOMAIN}';
SQL
