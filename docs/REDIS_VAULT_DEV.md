# Redis — configuration Vault en développement

## Symptôme

Au démarrage de l'API (`npm run start:dev`), ioredis crash immédiatement :

```
RangeError [ERR_SOCKET_BAD_PORT]: Port should be >= 0 and < 65536. Received type number (NaN).
```

## Cause

L'API lit la config Redis depuis Vault à l'adresse `secret/platform/redis` (chemin KV v2).
Elle attend trois clés : `HOST`, `PORT`, `PASSWORD`.

Si le secret n'existe pas — ou s'il a été créé avec le mauvais format (ex. une seule clé `REDIS_URL`) —,
`redisConfig.PORT` est `undefined` → `parseInt(undefined, 10)` → `NaN` → crash ioredis.

Fichiers concernés :
- `src/main.ts` (RedisIoAdapter)
- `src/infrastructure/eventbus/eventbus.module.ts` (REDIS_CLIENT provider)
- `src/modules/display/display.gateway.ts` (subscriber afterInit)
- `src/infrastructure/eventbus/redis-publisher.service.ts`

## Fix — provisionner le secret dans Vault

```bash
docker exec -e VAULT_TOKEN=dev-root-token translog-vault \
  vault kv put secret/platform/redis \
  HOST="localhost" PORT="6379" PASSWORD="redis_password"
```

Valeurs dev (alignées sur `docker-compose.yml`) :

| Clé        | Valeur          |
|------------|-----------------|
| `HOST`     | `localhost`     |
| `PORT`     | `6379`          |
| `PASSWORD` | `redis_password`|

## Vérification

```bash
docker exec -e VAULT_TOKEN=dev-root-token translog-vault \
  vault kv get secret/platform/redis
```

Doit afficher les trois clés. Si le résultat montre seulement `REDIS_URL`, re-lancer le `vault kv put` ci-dessus (il écrase le secret — idempotent).

## Idempotence dans dev-up.sh

`scripts/dev-up.sh` provisionne ce secret automatiquement à chaque `./scripts/dev-up.sh`.
Le bloc est idempotent : il ne touche pas au secret s'il est déjà présent avec le bon format.

```bash
# Extrait de scripts/dev-up.sh
info "Vault : provision secret/platform/redis…"
if docker exec -e VAULT_TOKEN=dev-root-token translog-vault \
    vault kv get secret/platform/redis >/dev/null 2>&1; then
  ok "Config Redis déjà présente"
else
  docker exec -e VAULT_TOKEN=dev-root-token translog-vault \
    vault kv put secret/platform/redis \
    HOST="localhost" PORT="6379" PASSWORD="redis_password" >/dev/null
  ok "Config Redis provisionnée"
fi
```

> **Note** : le check ci-dessus ne vérifie que la présence du secret, pas son format.
> Si tu suspectes un mauvais format, force l'écrasement avec le `vault kv put` manuel.

## En production

Remplacer `localhost` par l'hôte interne du cluster Redis (ex. `redis.internal`, `elasticache-endpoint.aws.com`).
`PORT` et `PASSWORD` proviennent du secret manager du cloud cible (AWS Secrets Manager, GCP Secret Manager, etc.).
