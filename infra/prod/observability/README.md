# Observabilité — Lot 1

Stack séparée déployée parallèlement à la stack applicative `translog`. Couvre métriques (Prometheus) + logs (Loki) + dashboards (Grafana) + uptime (Blackbox).

## Composants

| Service | Image | Rôle | Port interne | Mémoire max |
|---|---|---|---:|---:|
| `prometheus`     | `prom/prometheus:v2.55.1` | Collecte métriques (rétention 15j) | 9090 | 384M |
| `grafana`        | `grafana/grafana:10.4.12` | Dashboards | 3000 | 256M |
| `loki`           | `grafana/loki:2.9.10` | Agrégation logs (rétention 7j) | 3100 | 256M |
| `promtail`       | `grafana/promtail:2.9.10` | Shipper logs Docker → Loki | 9080 | 128M |
| `node-exporter`  | `prom/node-exporter:v1.8.2` | Host (CPU/RAM/disk/net) | 9100 | 64M |
| `cadvisor`       | `gcr.io/cadvisor/cadvisor:v0.49.1` | Conteneurs Docker | 8080 | 256M |
| `postgres-exporter` | `prometheuscommunity/postgres-exporter:v0.16.0` | Postgres | 9187 | 64M |
| `redis-exporter` | `oliver006/redis_exporter:v1.66.0` | Redis | 9121 | 64M |
| `blackbox-exporter` | `prom/blackbox-exporter:v0.25.0` | Probes HTTP sous-domaines | 9115 | 64M |

**Total ~1.5 Go RAM** sur les 8 Go du VPS.

## Accès

Une seule URL exposée publiquement, derrière Caddy + TLS wildcard :

| URL | Auth |
|---|---|
| `https://grafana.translog.dsyann.info` | `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` (dans `.env.prod`) |

`Prometheus`, `Loki` et les exporters sont **non exposés publiquement**. Ils restent sur le réseau Docker overlay `translog_obs_net`. Pour les debugger en SSH :

```bash
# Prometheus UI
docker exec -it $(docker ps -q -f name=translog-obs_prometheus) wget -qO- http://localhost:9090/-/ready

# Loki ready
docker exec -it $(docker ps -q -f name=translog-obs_loki) wget -qO- http://localhost:3100/ready
```

## Mot de passe Grafana initial

Le déploiement (cf. [`scripts/04-deploy.sh`](../scripts/04-deploy.sh)) génère automatiquement `GRAFANA_ADMIN_PASSWORD` dans `.env.prod` au premier deploy si la variable n'est pas présente. Pour le récupérer :

```bash
ssh root@72.61.108.160 "grep ^GRAFANA_ADMIN_PASSWORD= /opt/TranslogPro/infra/prod/.env.prod"
```

Pour le rotater : édite `.env.prod` et redéploie via GitHub Actions.

## Dashboards inclus

Provisionnés automatiquement au démarrage Grafana (folder « TransLog ») :

| Dashboard | UID | Couvre |
|---|---|---|
| **VPS — Host metrics** | `translog-host` | CPU, mémoire, disque, réseau du serveur |
| **Containers — Docker stats** | `translog-containers` | CPU/mem/réseau par service Docker |
| **Postgres** | `translog-postgres` | Connexions, commits/rollbacks, cache hit, tailles |
| **Redis** | `translog-redis` | Mémoire, ops/sec, hit ratio |
| **API NestJS — Endpoints & latence** | `translog-api` | Top endpoints, latence p50/p95/p99, taux d'erreur |
| **Uptime — Sous-domaines publics** | `translog-blackbox` | UP/DOWN par sous-domaine, expiration TLS |
| **Logs — Recherche live** | `translog-logs` | Logs API/Caddy/infra/SSH en live |

Les dashboards sont éditables dans l'UI mais **les modifications ne sont pas persistées** (chaque redeploy réécrase depuis le repo). Pour personnaliser durablement : copier-coller le JSON depuis Grafana → mettre à jour le fichier dans `grafana/dashboards/`.

## Logs Loki — requêtes utiles

```logql
# Erreurs API live
{container_name="translog_api"} |~ "(?i)error|exception|fail"

# Caddy access logs ≥ 400
{container_name="translog_caddy"} | json | status >= 400

# Toutes les requêtes vers /api/auth/login
{container_name="translog_api"} |~ "POST /api/auth/login"

# Tentatives SSH échouées
{job="syslog", process="sshd"} |= "Failed password"
```

## Ajout d'un dashboard

1. Copier le JSON du dashboard depuis Grafana (`Dashboard settings > JSON Model`).
2. Le sauvegarder sous `grafana/dashboards/<nom>.json`.
3. Ajouter une nouvelle entrée `dash_<nom>` dans la section `configs:` de [`docker-stack.observability.yml`](docker-stack.observability.yml).
4. Re-déployer (push sur `main`).

## Backup / restauration

| Volume | Critique ? | Quoi restaurer |
|---|---|---|
| `translog_grafana_data` | Oui | Dashboards édités UI, users supplémentaires créés |
| `translog_prometheus_data` | Non (rétention 15j) | Métriques historiques — perte tolérable |
| `translog_loki_data` | Non (rétention 7j) | Logs historiques — perte tolérable |
| `translog_promtail_positions` | Non | Recréé au prochain démarrage |

Le script [`backup.sh`](../scripts/backup.sh) sauvegarde quotidiennement les volumes critiques. Pour restaurer Grafana :

```bash
docker run --rm \
  -v translog_grafana_data:/target \
  -v /root/backups/latest:/backup \
  alpine sh -c "cd /target && tar xzf /backup/grafana_data.tgz"
```

## Snapshots good-state

Le déploiement [snapshot good-state](../scripts/snapshot-good-state.sh) tag aussi les volumes obs après un déploiement réussi. Rollback complet via :

```bash
bash /opt/TranslogPro/infra/prod/scripts/restore-good-state.sh latest
```

## Dépannage

### Grafana : « 502 Bad Gateway » via Caddy

Le service Caddy n'a pas encore joint `translog_obs_net`. Forcer :
```bash
docker service update --network-add translog_obs_net translog_caddy
```

### Prometheus : « target down » sur `translog-api`

L'API expose `/metrics` (sans préfixe `/api`). Vérifier :
```bash
docker exec -it $(docker ps -q -f name=translog_api) wget -qO- http://localhost:3000/metrics | head -20
```

Si vide ou 404, le module `MetricsModule` n'a pas été enregistré dans `app.module.ts`.

### Loki : « no logs found »

Promtail tourne en mode `global` (1 instance par node Swarm). Vérifier :
```bash
docker service ps translog-obs_promtail
```

Si pas en running, vérifier les volumes `/var/lib/docker/containers` montés en read-only.

### Le Grafana est dispo mais les dashboards sont vides

Les datasources sont mal connectées. Vérifier dans l'UI : `Configuration > Data sources > Prometheus / Loki` → bouton « Save & Test ». Le statut doit être vert.

## Détails techniques

- **Routing par hostname** : Caddy résout `grafana.translog.dsyann.info` via le wildcard A record `*.translog.dsyann.info → 72.61.108.160` (zone BIND9 [translog.db](../bind9/zones/translog.db)). Le cert TLS est le même wildcard `*.translog.dsyann.info` déjà acquis par Caddy via DNS-01.
- **Découpage stack** : la stack obs est entièrement séparée (`docker stack deploy translog-obs`) — supprimable indépendamment sans toucher l'app : `docker stack rm translog-obs`.
- **Réseau partagé** : `translog_obs_net` est créé par `04-deploy.sh` AVANT les deux stacks (sinon poulet/œuf : Caddy de la stack `translog` le référence aussi).
- **Métriques applicatives NestJS** : module [`src/modules/metrics/`](../../../src/modules/metrics/) — `prom-client` natif + interceptor global qui mesure latence + status code de toute requête.

## Roadmap

- **Lot 2 — CrowdSec** : détection brute force / scan / SQLi → ban IP automatique (à livrer après stabilisation Lot 1).
- **Alerting** : Alertmanager + canal WhatsApp / Email pour seuils critiques (CPU > 90% 5min, p95 > 2s 5min, probes DOWN).
- **Tracing** : OpenTelemetry collector + Tempo si besoin de tracer une requête bout-en-bout.
