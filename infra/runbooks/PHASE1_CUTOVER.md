# Phase 1 — Cutover multi-tenant isolation

**Objectif** : basculer le routing de `app.translogpro.com` + path-based vers `{slug}.translogpro.com` (subdomain-per-tenant), avec remplacement nginx → Caddy.

## Pré-requis (à compléter AVANT le jour J)

- [ ] DNS wildcard `*.translogpro.com` → IP serveur (propagation ≥24h)
- [ ] Cloudflare API Token créé (permission Zone:DNS:Edit sur translogpro.com)
- [ ] Fichier `./secrets/cloudflare_api_token` en place, mode 600 root:root
- [ ] Fichier `./secrets/domain_check_api_key` (32 chars aléatoires)
- [ ] Backup DB avant migration (`pg_dump` complet)
- [ ] Build frontend prêt : `npm run build --prefix frontend`
- [ ] Image backend buildée et taguée avec version de la release

## Séquence de cutover (J-1 → J+0)

### J-1 : Staging ring

1. Pointer `staging.translogpro.com` vers staging serveur
2. Déployer Caddy + nouveau backend en staging
3. Tester complet : signup sur 2 tenants avec même email, cookie isolé entre sous-domaines, reset password
4. Vérifier `_prisma_migrations` absent ou aligné (le projet utilise `db push`)

### J+0 : Migration data

```bash
# 1. Appliquer la migration SQL idempotente (safe à rejouer)
docker exec -i translog-postgres psql -U app_user -d translog \
  < infra/sql/03-multi-tenant-isolation-phase1.sql

# 2. Synchroniser Prisma avec le nouveau schema
npx prisma db push --skip-generate
npx prisma generate
```

### J+0 : Swap reverse proxy

```bash
# 3. Caddy UP en parallèle de nginx (port 8443 pour test)
# Ajuster temporairement docker-compose.prod.yml : port 8443:443 sur caddy
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d caddy

# 4. Vérification :
curl -k https://tenanta.translogpro.com:8443/health/live
# → 200 OK

# 5. Arrêter nginx, remettre Caddy sur 80/443
docker stop translog-nginx
# Ajuster docker-compose.prod.yml (80:80, 443:443) et redémarrer
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d caddy
```

### J+0 : Cookie transition (éviter déconnexion de masse)

**Problème** : les cookies `translog_session` posés sur `app.translogpro.com` ne seront PAS envoyés à `tenanta.translogpro.com` (origine différente). Tous les users authentifiés seront déconnectés au cutover.

**Option A (acceptée)** : accepter la déconnexion. Message d'annonce 24h avant ("reconnectez-vous après la mise à jour"). Simple, aucun code.

**Option B (complexe)** : endpoint de transfert `POST /api/auth/transfer-session` qui lit le cookie sur l'ancien domaine, émet un token one-shot, redirige vers le sous-domaine du user pour l'échanger contre un nouveau cookie. Environ 1 jour de dev si nécessaire.

Pour TransLog Pro early stage → **Option A recommandée**.

### Vérifications post-cutover

- [ ] Login depuis `https://tenanta.translogpro.com/login` fonctionne
- [ ] Login depuis `https://tenantb.translogpro.com/login` avec le même email fonctionne et crée une session distincte
- [ ] Ouvrir les deux dans 2 onglets : pas de mélange de données
- [ ] `curl https://tenanta.translogpro.com/api/auth/me -H "Cookie: translog_session=..."` ← cookie de tenantA → 200
- [ ] `curl https://tenantb.translogpro.com/api/auth/me -H "Cookie: translog_session=...A..."` ← cookie de tenantA sur host B → 403 Forbidden (TenantIsolationGuard)
- [ ] Reset password envoie un lien `https://{slug}.translogpro.com/auth/reset?token=...`
- [ ] Caddy logs : `docker logs translog-caddy | jq 'select(.level=="error")'` → zéro

## Rollback (si Caddy instable)

```bash
# 1. Redémarrer nginx
docker compose up -d nginx

# 2. Arrêter Caddy
docker stop translog-caddy

# 3. Les cookies existants sur app.translogpro.com sont toujours valides —
# aucun user n'est déconnecté.
```

Le schéma DB n'a PAS besoin de rollback — les contraintes ajoutées sont compatibles avec l'ancien code (qui ne les utilise juste pas).

## Activation future du TenantIsolationGuard global

Par défaut `TenantIsolationGuard` est **registered mais pas wiré globalement**. Pour l'activer après stabilisation Phase 1 :

```typescript
// src/app.module.ts — ajouter dans providers :
{ provide: APP_GUARD, useClass: TenantIsolationGuard },
```

Ne l'activer qu'APRÈS avoir confirmé que :
- Aucun client ne frappe encore `app.translogpro.com` (legacy)
- Les tests E2E cross-subdomain passent tous
- 7 jours sans regression en prod

## Activation future du on-demand TLS (Phase 3)

Dans `infra/caddy/Caddyfile.prod` :
1. Dé-commenter le bloc `:443 { tls { on_demand } ... }`
2. Activer la section `on_demand_tls { ask ... }` dans les globals (déjà prête)
3. Vérifier que l'endpoint `/internal/domain-check` est implémenté côté backend (Phase 3 task)

## Monitoring post-cutover

À surveiller les 7 premiers jours :
- Taux d'erreur 403 sur `/api/auth/*` (TenantIsolationGuard trop strict ?)
- Latence ajoutée par Caddy vs nginx (attendu : +5-10ms)
- Expiration des certs LE : Caddy auto-renew à 30 jours du expiry
- Volume `caddy_data` : backup quotidien `rsync -a caddy_data/ backup-server:caddy_data_$(date +%F)/`
