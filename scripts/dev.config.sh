#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# TransLog Pro — Dev environment config (single source of truth)
# ═══════════════════════════════════════════════════════════════════
# À sourcer en haut de CHAQUE script bash qui manipule les hostnames
# ou configure le stack dev :
#
#   source "$(dirname "${BASH_SOURCE[0]}")/dev.config.sh"
#
# Les variables sont définies UNIQUEMENT si absentes (":= " parameter
# expansion) → respecte les overrides CI ou shell parent.
#
# MIROIR des configs runtime :
#   - Backend NestJS   : process.env.PLATFORM_BASE_DOMAIN
#                        (lu par src/core/tenancy/host-config.service.ts)
#   - Frontend Vite    : import.meta.env.VITE_PLATFORM_BASE_DOMAIN
#                        (lu par frontend/lib/tenancy/host.ts)
#   - /etc/hosts       : généré dynamiquement depuis tenants + admin
#   - Caddyfile.dev    : wildcard *.$PLATFORM_BASE_DOMAIN
#                        (règle unique Caddy — pas de liste à maintenir)
#   - SQL tenant_domains : seed via seed-tenant-domains.sh (shell-templated)
#
# Pour changer le domaine : UNE variable ici (ou override via env),
# partout ailleurs ça propage.
# ═══════════════════════════════════════════════════════════════════

# Domaine de base plateforme (dev). Conventions :
#   - dev  : translog.test  (TLD "test" RFC 2606, non routable — safe)
#   - prod : translogpro.com
# Override possible via `PLATFORM_BASE_DOMAIN=other.test ./scripts/dev-up.sh`.
: "${PLATFORM_BASE_DOMAIN:=translog.test}"

# Sous-domaine réservé à la zone super-admin plateforme (Phase 2).
# → admin.$PLATFORM_BASE_DOMAIN résout vers PLATFORM_TENANT_ID.
: "${ADMIN_SUBDOMAIN:=admin}"

export PLATFORM_BASE_DOMAIN ADMIN_SUBDOMAIN
