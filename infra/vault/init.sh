#!/bin/sh
# ============================================================
# TransLog Pro — Vault Initialization Script (Dev)
# Exécuté une seule fois au démarrage du container vault-init
# ============================================================

set -e

echo "⏳ Waiting for Vault to be ready..."
until vault status > /dev/null 2>&1; do sleep 1; done
echo "✅ Vault is ready"

# ─── Audit logs (CRITIQUE sécu — toute opération Vault tracée) ───────
# Sans audit, aucune traçabilité des lectures/écritures de secrets → viole
# les exigences de compliance (ISO 27001, SOC 2).
echo "📋 Enabling audit logs..."
mkdir -p /vault/logs 2>/dev/null || true
vault audit enable -path=file_audit file file_path=/vault/logs/audit.log 2>/dev/null || echo "  (audit déjà activé)"

# ─── Secrets Engine ──────────────────────────────────────────
echo "📦 Enabling secrets engines..."
vault secrets enable -version=2 -path=secret kv || true
vault secrets enable -path=pki pki || true
vault secrets enable -path=transit transit || true

# ─── PKI Root CA ─────────────────────────────────────────────
echo "🔐 Configuring PKI..."
vault write pki/root/generate/internal \
  common_name="translog-ca" \
  ttl=87600h \
  > /dev/null 2>&1 || true

vault write pki/config/urls \
  issuing_certificates="http://vault:8200/v1/pki/ca" \
  crl_distribution_points="http://vault:8200/v1/pki/crl" \
  > /dev/null 2>&1 || true

# PKI role — restreint aux domaines internes, PAS de wildcard sous-domaines
# (prévention mis-issuance : un attaquant compromettant l'API ne doit pas
# pouvoir émettre un cert pour attacker.translog.internal).
vault write pki/roles/translog-services \
  allowed_domains="translog.internal,svc.cluster.local,backend.translog.internal,api.translog.internal" \
  allow_subdomains=false \
  max_ttl=72h \
  > /dev/null 2>&1 || true

# ─── Transit (pour chiffrement additionnel) ──────────────────
vault write transit/keys/qr-signing type=hmac || true

# ─── Auth AppRole ─────────────────────────────────────────────
echo "🔑 Configuring AppRole..."
vault auth enable approle || true

# ─── Politique applicative ────────────────────────────────────
vault policy write translog-api - <<'POLICY'
path "secret/data/platform/*" {
  capabilities = ["read"]
}
path "secret/data/tenants/*" {
  capabilities = ["read", "create", "update"]
}
path "pki/issue/translog-services" {
  capabilities = ["create", "update"]
}
path "transit/hmac/qr-signing" {
  capabilities = ["update"]
}
path "transit/verify/qr-signing" {
  capabilities = ["update"]
}
POLICY

# AppRole pour le service API
vault write auth/approle/role/translog-api \
  token_policies="translog-api" \
  token_ttl=1h \
  token_max_ttl=4h || true

# ─── Secrets de plateforme ────────────────────────────────────
echo "🔒 Loading platform secrets..."

# DATABASE_URL (runtime) — role app_runtime non-superuser NOBYPASSRLS.
#   → RLS effectivement appliquée (un SUPERUSER bypasse toutes les policies).
# DATABASE_URL_DIRECT — role app_user SUPERUSER réservé aux migrations Prisma.
#   → JAMAIS utilisé par le backend en runtime. Si c'est le cas en prod,
#     l'audit sécu signale un finding CRITIQUE (RLS inopérante).
#
# Dev : runtime = direct postgres (bypass pgbouncer qui ne gère qu'un user).
# Prod : runtime = pgbouncer:5432 avec userlist.txt contenant app_runtime
#        (voir runbook PROD_INITIALIZATION.md).
vault kv put secret/platform/db \
  DATABASE_URL="postgresql://app_runtime:app_runtime_password@postgres:5432/translog?schema=public" \
  DATABASE_URL_DIRECT="postgresql://app_user:app_password@postgres:5432/translog?schema=public"

vault kv put secret/platform/redis \
  HOST="localhost" PORT="6379" PASSWORD="redis_password"

vault kv put secret/platform/minio \
  ENDPOINT="minio" \
  PORT="9000" \
  ACCESS_KEY="minioadmin" \
  SECRET_KEY="minioadmin123" \
  USE_SSL="false"

vault kv put secret/platform/app \
  JWT_SECRET="dev-jwt-secret-change-in-production-$(date +%s)" \
  BETTER_AUTH_SECRET="dev-auth-secret-change-in-production-$(date +%s)"

# Clé HMAC pour les tokens d'impersonation cross-subdomain (Phase 2).
# ImpersonationService.signPayload la lit via secret/platform/impersonation_key.
# Doit faire ≥ 32 chars. En prod : rotation indépendante des autres clés.
vault kv put secret/platform/impersonation_key \
  KEY="dev-impersonation-hmac-$(date +%s)-$(openssl rand -hex 32 2>/dev/null || echo padding-padding-padding-padding)"

# ─── Tenant par défaut (développement) ───────────────────────
echo "🏢 Creating default dev tenant secrets..."

vault kv put secret/tenants/tenant-dev/hmac \
  KEY="dev-hmac-key-change-in-production-$(date +%s)"

# Seed tenant (UUID du seed DB)
vault kv put secret/tenants/11111111-1111-1111-1111-111111111111/hmac \
  KEY="a3f8b2c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1"

vault kv put secret/tenants/tenant-dev/pay \
  FLUTTERWAVE_SECRET="FLWSECK_TEST-dev-key" \
  PAYSTACK_SECRET="sk_test_dev-key"

vault kv put secret/tenants/tenant-dev/sms \
  TWILIO_ACCOUNT_SID="dev-twilio-sid" \
  TWILIO_AUTH_TOKEN="dev-twilio-token" \
  TWILIO_FROM_NUMBER="+1234567890" \
  WHATSAPP_TOKEN="dev-whatsapp-token"

echo ""
echo "✅ Vault initialization complete!"
echo "   Vault UI: http://localhost:8200"
echo "   Token:    dev-root-token"
echo ""
echo "⚠️  PRODUCTION: Replace all dev secrets with real values"
echo "⚠️  PRODUCTION: Use Vault Raft HA (3 nodes), not dev mode"
