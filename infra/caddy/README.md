# Caddy — Reverse proxy multi-tenant

## Structure

```
infra/caddy/
├── Caddyfile.dev     — HTTPS local via mkcert (translog.test)
├── Caddyfile.prod    — ACME DNS-01 Cloudflare (translogpro.com)
├── certs/            — Certs mkcert locaux (gitignored)
│   ├── dev.crt
│   └── dev.key
└── README.md         — ce fichier
```

## Setup dev local (une seule fois)

### 1. Installer mkcert et les dépendances NSS (Firefox)

```bash
brew install mkcert nss
mkcert -install    # installe le CA local dans macOS keychain + Firefox
```

### 2. Générer le cert wildcard

```bash
mkdir -p infra/caddy/certs
mkcert \
  -cert-file infra/caddy/certs/dev.crt \
  -key-file  infra/caddy/certs/dev.key \
  "*.translog.test" translog.test localhost
```

### 3. DNS local — 2 options

**Option A : /etc/hosts** (simple, par-tenant)

```
127.0.0.1 tenanta.translog.test
127.0.0.1 tenantb.translog.test
127.0.0.1 admin.translog.test
```

**Option B : dnsmasq** (wildcard, zéro maintenance, recommandé)

```bash
# Installer + configurer
brew install dnsmasq
echo 'address=/.translog.test/127.0.0.1' > \
  /opt/homebrew/etc/dnsmasq.d/translog.conf

# Démarrer le service
sudo brew services start dnsmasq

# macOS System Settings → Network → Wi-Fi → Details → DNS :
#   1. 127.0.0.1        ← en première position
#   2. 1.1.1.1 (ou votre DNS habituel)
```

Tester :

```bash
dig +short foo.translog.test @127.0.0.1    # → 127.0.0.1
```

### 4. Lancer la stack

```bash
# Terminal 1 : API (hot-reload)
npm run start:dev

# Terminal 2 : Frontend (hot-reload)
npm run dev --prefix frontend

# Terminal 3 : Caddy (dockerisé)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up caddy
```

### 5. Naviguer

- `https://tenanta.translog.test` — portail tenant
- `https://admin.translog.test` — zone super-admin (Phase 2)
- `https://tenantb.translog.test` — autre tenant dans un deuxième onglet

## Setup prod

Voir [PHASE1_CUTOVER.md](../runbooks/PHASE1_CUTOVER.md) pour la procédure complète.

**Résumé** :

1. DNS : wildcard `*.translogpro.com` → IP serveur
2. Secrets : `./secrets/cloudflare_api_token` + `./secrets/domain_check_api_key`
3. Build : `npm run build --prefix frontend` + build Docker backend
4. Déploiement : `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`

Caddy gère ACME DNS-01 automatiquement — un seul cert wildcard couvre tous les tenants + admin.

## Troubleshooting

| Symptôme | Cause | Solution |
|----------|-------|----------|
| Browser refuse le cert en dev | mkcert CA pas installé | `mkcert -install` |
| `https://xxx.translog.test` → NXDOMAIN | dnsmasq pas démarré OU DNS système pas réordonné | Vérifier avec `dig` et les paramètres DNS |
| 502 Bad Gateway en dev | API (3000) ou Vite (5173) pas démarrés | Lancer `start:dev` et `dev --prefix frontend` |
| 503 en prod + log "domain-check failed" | Endpoint backend `/internal/domain-check` absent ou `DOMAIN_CHECK_API_KEY` non partagé | Vérifier l'implémentation Phase 3 + rotation des secrets |
| Cert renewal échoue en prod | Token Cloudflare expiré ou permission manquante | Régénérer token avec scope Zone:DNS:Edit |

## Ajout d'un nouveau tenant (Phase 1)

Rien à faire côté Caddy — le wildcard couvre `*.translogpro.com`. Il suffit que :

1. Le tenant existe en DB (`tenants` + seed `tenant_domains.{slug}.translogpro.com`)
2. Le seed `infra/sql/03-multi-tenant-isolation-phase1.sql` a été rejoué, OU `TenantDomainRepository.invalidate()` est appelé si tenant créé hot

## Ajout d'un custom domain (Phase 3)

Non implémenté au boot Phase 1. Voir la feature flag dans `Caddyfile.prod` — tout est prêt, juste à décommenter les 2 blocs + implémenter l'endpoint `/internal/domain-check`.
