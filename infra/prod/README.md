# `infra/prod/` — Stack de production TransLog Pro

Déploiement **auto-hébergé** complet pour VPS Linux (Hostinger KVM 8 Go testé).

## Architecture

- **Caddy** unique sur `:80/:443` (ACME wildcard via DNS-01, proxy TransLog + gmp coexistence)
- **BIND9** sur `:53` (authoritative `translog.dsyann.info` + TSIG updates pour ACME)
- **Postgres 16 + PostGIS** avec 3 rôles distincts (`app_admin`/`app_runtime`/`app_superadmin`, RLS strict)
- **PgBouncer** (mode session, obligatoire pour `SET LOCAL app.tenant_id`)
- **Redis 7** (session, rate-limit, cache)
- **MinIO** (object storage)
- **Vault** (mode raft production, pas dev)
- **API NestJS** + **Frontend Vite nginx**

Coexistence avec **Easypanel/gmp** existant : Caddy remplace Traefik sur 80/443 et proxy les containers gmp via le network `easypanel-gmp` (attachable).

## Démarrage rapide (45 min)

```bash
ssh root@<VPS>

cd /opt
git clone <repo>   # ou rsync
cd TranslogPro/infra/prod

chmod +x scripts/*.sh

./scripts/01-preflight.sh        # vérifs + désactive systemd-resolved stub
./scripts/02-gen-secrets.sh      # génère .env.prod + tsig.key
./scripts/03-import-traefik-certs.sh   # import certs gmp → Caddy
./scripts/04-deploy.sh           # cutover (pause pour vault init au 1er run)
```

Cf. [`runbooks/CUTOVER.md`](runbooks/CUTOVER.md) pour le pas-à-pas détaillé.

## Structure

```
infra/prod/
├── docker-compose.prod.yml   Stack 9 services
├── .env.prod.example         Template secrets
├── .env.prod                 (généré, gitignore, chmod 600)
│
├── caddy/
│   ├── Dockerfile            Build custom avec plugin rfc2136
│   └── Caddyfile             Reverse proxy unifié
│
├── bind9/
│   ├── named.conf            Config BIND9 + TSIG
│   └── zones/
│       ├── translog.db       Zone file translog.dsyann.info
│       └── tsig.key          (généré)
│
├── vault/
│   └── config.hcl            Raft backend prod
│
├── postgres/
│   ├── 01-rls.sql            (copie de infra/sql/01-rls.sql)
│   ├── 02-roles.sql          Création app_runtime + app_superadmin
│   └── 10-env.sh             Export env vars pour .sql
│
├── scripts/
│   ├── 01-preflight.sh
│   ├── 02-gen-secrets.sh
│   ├── 03-import-traefik-certs.sh
│   ├── 04-deploy.sh
│   ├── rollback.sh
│   └── backup.sh             Cron quotidien 02:00
│
└── runbooks/
    ├── CUTOVER.md            Procédure déploiement initial
    └── DAY2_OPS.md           Backups, rotation, monitoring, incidents
```

## Commandes utiles

```bash
# État stack
docker compose -f docker-compose.prod.yml ps

# Logs d'un service
docker compose -f docker-compose.prod.yml logs -f api

# Reload Caddy sans restart
docker exec translog_caddy caddy reload --config /etc/caddy/Caddyfile

# Prisma shell
docker compose -f docker-compose.prod.yml run --rm api npx prisma studio

# Rollback d'urgence (restart Traefik Easypanel)
./scripts/rollback.sh

# Backup manuel
./scripts/backup.sh
```

## Sécurité — checklist

- [x] Postgres 3 rôles (pas de SUPERUSER en runtime)
- [x] RLS RESTRICTIVE activée (SET LOCAL app.tenant_id obligatoire)
- [x] Vault raft backend (pas dev-mode)
- [x] Secrets via env vars + Docker secrets (jamais en clair dans image)
- [x] TLS wildcard via DNS-01 (cert par tenant, pas wildcard = isolation)
- [x] Security headers HSTS/CSP/X-Frame-Options
- [x] UFW restrictif (22/80/443/53 only)
- [x] Backups quotidiens chiffrés AES-256-CBC
- [ ] Fail2ban (voir DAY2_OPS.md §5)
- [ ] Unattended-upgrades (voir DAY2_OPS.md §5)
- [ ] Rotation secrets 6 mois (voir DAY2_OPS.md §2)

## Support

- Logs structurés JSON dans `/var/lib/docker/volumes/translog_caddy_logs/`
- Healthcheck Docker automatique sur chaque service
- Rollback en <1 min si cutover foire
