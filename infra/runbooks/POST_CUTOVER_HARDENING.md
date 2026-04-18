# Hardening post-cutover — à faire "dès que possible mais pas bloquant"

Items identifiés par les audits sécu mais **non bloquants** pour le cutover Phase 1+2. À traiter en sprint hardening après stabilisation prod.

## 1. Vault AppRole per-tenant

**État actuel** : policy `translog-api` accorde `read, create, update` sur `secret/data/tenants/*` — l'API backend peut lire/écrire les secrets de TOUS les tenants.

**Risque** : si le backend est compromis (RCE), l'attaquant accède aux HMAC keys, tokens OAuth, configs paiement de TOUS les tenants simultanément.

**Fix** : générer une AppRole par tenant avec policy templatée :
```hcl
path "secret/data/tenants/{{identity.entity.metadata.tenant_id}}/*" {
  capabilities = ["read", "create", "update"]
}
```

**Complexité** : moyenne — nécessite refacto du `VaultService` pour obtenir un token tenant-scoped par requête (cache 5 min). Impacte `QrService`, secret pay providers, etc.

**Priorité** : P2 (post-MVP, sprint hardening)

## 2. PgBouncer TLS interne

**État actuel** : connexion `backend → pgbouncer → postgres` en clair sur le network Docker bridge.

**Risque** : attaquant sur le même network Docker peut sniff les requêtes SQL (credentials, données). Nécessite pivot préalable depuis Redis/MinIO/Vault.

**Fix** : Docker secrets pour certs + `CLIENT_TLS_SSLMODE: require` sur PgBouncer.

**Complexité** : faible — juste config PgBouncer + génération cert interne.

**Priorité** : P2 (devient P1 si passage à Kubernetes shared namespace ou multi-host).

## 3. Vault Raft HA 3-nodes

**État actuel** : dev mode single-node, root token en env var.

**Fix** : cluster Raft 3 nodes, Shamir unseal 5/3, auto-unseal KMS (AWS/GCP) — documenté dans [PROD_INITIALIZATION.md](PROD_INITIALIZATION.md#3-vault--mode-production-pas-dev).

**Priorité** : **P1** — à faire AVANT le cutover prod réel (pas bloquant en dev/staging).

## 4. Phase 3 — domaines custom white-label

**État actuel** : code et config prêts (Caddy `on_demand_tls` commenté, `TenantDomain` table, `resolveTenantFromHost` supporte les custom domains).

**Fix au moment opportun** :
- Implémenter `/internal/domain-check` endpoint sécurisé par `X-Domain-Check-Key`
- Dé-commenter le bloc `on_demand_tls` dans Caddyfile.prod
- UI admin tenant pour ajouter/vérifier un domaine custom

**Priorité** : **sur demande business** (premier client premium qui demande). ~3 jours de dev.

## 5. Phase 4 — multi-tenant humain (TenantMembership)

**État actuel** : `User.tenantId` FK unique. Un humain = un compte par tenant.

**Refactor lourd** : User global + TenantMembership[] table pivot. Impacte IAM, permissions, CRM, sessions, audit. 1-2 semaines.

**Priorité** : **sur demande business uniquement** (ex: comptable facture 3 compagnies avec un seul login).

## 6. Autres hardening mineurs

- **Secret rotation Vault** (SecretID 30j) — cron + runbook
- **Backup auto `caddy_data`** — restic ou rsync nightly (actuellement manuel)
- **Trivy CI scan** des images Docker dans la pipeline
- **Docker Bench for Security** — audit manuel trimestriel
- **Vault policy `tenants/*`** → cf. item 1

## Ce qui N'EST PAS dans cette liste (déjà fixé avant cutover)

- RLS PostgreSQL 98 tables + WITH CHECK ✅ ([04-rls-phase1-backfill.sql](../sql/04-rls-phase1-backfill.sql))
- `app_runtime` role non-SUPERUSER ✅
- Vault audit logs enabled ✅
- Frontend XSS DOMPurify ✅
- Prisma error masking prod ✅
- Caddy error pages custom ✅
- Docker images pinnées ✅
- `.dockerignore` ✅
- `dumb-init` signal handling ✅
- OAuth returnTo whitelist stricte ✅
- Nginx obsolete retiré ✅
- 20 fixes cross-tenant ORM (update/delete avec `tenantId`) ✅
- `PathTenantMatchGuard` cross-tenant path-vs-host ✅
- `TenantHostMiddleware` global ✅
- Phase 2 impersonation cross-subdomain ✅
