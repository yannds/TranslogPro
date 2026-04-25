# Runbook — Cutover production TransLog Pro

**Durée totale** : ~30-45 min montre en main.
**Downtime gmp** : ~30-60s pendant le switch Traefik → Caddy.

## Pré-requis (à valider AVANT d'ouvrir SSH)

- [ ] Chez LWS : 2 NS + 2 glue A records créés (ns1/ns2.translog.dsyann.info → 72.61.108.160)
- [ ] DNS propagé : `dig +short NS translog.dsyann.info @1.1.1.1` retourne les 2 NS (si pas encore, attends, ou skip vers phase 3)
- [ ] Accès SSH root au VPS 72.61.108.160
- [ ] Clone TransLog Pro sur le VPS (ou scp de `infra/prod/` + `Dockerfile` + `prisma/` + `src/` + `frontend/`)

## Phase 0 — Préparation (5 min)

```bash
ssh root@72.61.108.160

# Si pas déjà cloné
cd /opt
git clone https://github.com/yannds/TranslogPro.git  # ou scp
cd TranslogPro

# Update système + reboot si requis
apt update && apt upgrade -y
[ -f /var/run/reboot-required ] && reboot    # reconnecte-toi après si reboot
```

## Phase 1 — Préflight (5 min)

```bash
cd /opt/TranslogPro/infra/prod

# Dépendances utilitaires
apt install -y jq openssl dnsutils curl ufw

chmod +x scripts/*.sh

./scripts/01-preflight.sh
```

Répond `y` à la question sur systemd-resolved. Script vérifie tout, s'arrête si KO.

## Phase 2 — Secrets (2 min)

```bash
./scripts/02-gen-secrets.sh
```

**⚠️ CRITIQUE** : ouvre `.env.prod` (dans `infra/prod/.env.prod`), **copie TOUT dans un password manager** (1Password, Bitwarden, KeePass). Sans ces secrets, tes données sont définitivement perdues.

## Phase 3 — Import certs Traefik → Caddy (1 min)

```bash
./scripts/03-import-traefik-certs.sh
```

Devrait afficher `importé : api.dsyann.info`, `importé : app.dsyann.info`, `importé : gmp-*.ufm9jv.easypanel.host` (8 certs total).

## Phase 4 — CUTOVER (≈ 5 min + downtime)

```bash
./scripts/04-deploy.sh
```

Le script fera :
1. Build images (api/web/caddy) — 2-3 min
2. Up Postgres/Redis/MinIO/Vault/BIND9 (sans Caddy encore) — ~30s
3. Migrations Prisma + seed IAM — ~30s
4. **PAUSE** si Vault pas encore init → tu lances `vault operator init` manuellement (voir §5 ci-dessous), puis re-lance le script
5. **CUTOVER** : stop Traefik Easypanel + start Caddy — ~30s de downtime
6. Healthchecks externes

Si une étape échoue, `rollback.sh` est appelé automatiquement → Traefik Easypanel redémarre.

## Phase 5 — Vault init (première fois seulement, ~3 min)

Au premier run, le script s'arrête après §3 et te demande d'init Vault :

```bash
docker exec -it translog_vault vault operator init
```

Tu obtiens 5 **Unseal Keys** + 1 **Root Token**. **SAUVEGARDE les 6 valeurs** dans ton password manager.

Remplis `VAULT_TOKEN=...` dans `.env.prod` avec le Root Token.

Unseal Vault (3 des 5 keys suffisent) :

```bash
docker exec -it translog_vault vault operator unseal <KEY_1>
docker exec -it translog_vault vault operator unseal <KEY_2>
docker exec -it translog_vault vault operator unseal <KEY_3>
```

Active l'audit log :

```bash
docker exec -it -e VAULT_TOKEN=<root-token> translog_vault \
    vault audit enable file file_path=/vault/logs/audit.log
```

Re-lance le script :

```bash
./scripts/04-deploy.sh
```

Cette fois il enchaîne jusqu'au cutover.

## Phase 6 — Vérification post-cutover (5 min)

```bash
# État containers
docker ps --filter "name=translog_" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Logs Caddy (doit pas d'erreur)
docker logs -f translog_caddy --tail 50

# Test HTTPS wildcard (peut prendre 30-60s au premier hit, cert émis à la volée)
curl -I https://translog-admin.dsyann.info/health
curl -I https://translog-api.dsyann.info/health
curl -I https://acme-test.translog.dsyann.info/   # wildcard multi-tenant (va émettre un cert à la volée via DNS-01)

# Test gmp (certs importés)
curl -I https://api.dsyann.info/
curl -I https://app.dsyann.info/
```

Tous doivent répondre HTTP 200/301/404 (pas de TLS error).

## Phase 7 — Configuration first tenant (10-15 min)

Crée le premier tenant via l'API platform :

```bash
# Obtient un token JWT pour l'admin plateforme (via /api/auth/sign-in avec les
# credentials bootstrapés par le seed IAM — voir scripts/seed-e2e.ts pour les
# credentials par défaut, à CHANGER IMMÉDIATEMENT en prod)

# Ensuite via l'UI admin :
#   https://translog-admin.dsyann.info
#   → login avec platform-admin@dsyann.info (bootstrapé)
#   → créer le premier tenant "democorp" → accessible sur democorp.translog.dsyann.info
```

## Rollback d'urgence

```bash
cd /opt/TranslogPro/infra/prod
./scripts/rollback.sh
```

→ Stop Caddy/api/web de TransLog, restart Traefik Easypanel. ~30s.
gmp redevient accessible, TransLog off.

## Post-deploy (Jour 2)

Voir [DAY2_OPS.md](./DAY2_OPS.md) : rotation secrets, backups, monitoring, scaling.
