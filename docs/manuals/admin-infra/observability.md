# Manuel Admin-Infra — Observabilité & Sécurité

> Stack monitoring + sécurité passive de TransLog Pro en production.
> Cible : root VPS, ops infra. Tu y trouves tout ce qu'il faut pour voir, comprendre, intervenir.

---

## 1. Vue d'ensemble

Deux blocs distincts mais déployés ensemble dans la stack Docker Swarm `translog-obs`, sur le réseau overlay `translog_obs_net` :

| Bloc | Composants | Rôle |
|---|---|---|
| **Observabilité** (Lot 1) | Prometheus, Grafana, Loki, Promtail, node-exporter, cAdvisor, postgres-exporter, redis-exporter, blackbox-exporter | Métriques + logs + dashboards + uptime |
| **Sécurité passive** (Lot 2) | CrowdSec | Détection d'attaques (brute force, scan, SQLi) sans blocage tant que tu ne l'as pas activé scenario par scenario |

### Pourquoi en deux lots ?

- Lot 1 ne touche à rien d'autre que ses propres conteneurs. Risque deploy : nul.
- Lot 2 ajoute un module au binaire Caddy custom (recompile). Risque deploy : ~5-10s de Caddy si scale 0/1, comme tout CUTOVER habituel.
- En mode simulation par défaut, **Lot 2 ne bloque AUCUNE requête réelle**. Il observe et écrit des décisions taggées `simulated` que le bouncer ignore. C'est de l'intelligence pure jusqu'à activation explicite.

### Une stack séparée

Tout ce qui est observabilité/sécurité tourne dans `translog-obs`, **pas** dans la stack applicative `translog`. Avantages :
- `docker stack rm translog-obs` enlève toute la couche obs sans toucher à l'app
- Le réseau `translog_obs_net` est isolé : Prometheus voit `translog_net` (pour scraper l'API/Postgres/Redis), mais l'app ne voit pas Prometheus
- Volumes nommés (`translog_prometheus_data`, `translog_grafana_data`, `translog_loki_data`, `translog_crowdsec_data`) survivent aux redéploiements

---

## 2. Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                          INTERNET                                       │
│                             │                                           │
│                             ▼                                           │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Caddy 2.x (mode:host, ports 80/443)                             │  │
│  │  - reverse proxy *.translog.dsyann.info → SPA + API              │  │
│  │  - reverse proxy grafana.translog.dsyann.info → Grafana          │  │
│  │  - module crowdsec (interroge LAPI sur chaque requête, fail-open)│  │
│  │  - écrit access logs JSON dans /var/log/caddy/                   │  │
│  └────────┬─────────────────────────────────────────────────────────┘  │
│           │                                                             │
│           ▼                                                             │
│  ┌──────────────────────┐    ┌───────────────────────────────────┐     │
│  │  Stack `translog`    │    │  Stack `translog-obs`             │     │
│  │  (overlay translog_  │    │  (overlay translog_obs_net)       │     │
│  │   net)               │    │                                   │     │
│  │                      │    │  ┌──────────────────────────────┐ │     │
│  │  - api (NestJS)      │◄───┼──┤  Prometheus                  │ │     │
│  │  - postgres          │◄───┼──┤  (scrape via translog_net)   │ │     │
│  │  - redis             │◄───┼──┤                              │ │     │
│  │  - minio             │    │  └────────┬─────────────────────┘ │     │
│  │  - vault             │    │           │                       │     │
│  │  - bind9             │    │  ┌────────▼─────────────────────┐ │     │
│  └──────────────────────┘    │  │  Grafana                     │ │     │
│                              │  │  (datasources : Prometheus,  │ │     │
│                              │  │   Loki ; dashboards seedés)  │ │     │
│                              │  └──────────────────────────────┘ │     │
│                              │                                   │     │
│                              │  ┌──────────────────────────────┐ │     │
│                              │  │  Loki + Promtail             │ │     │
│                              │  │  (logs Docker + syslog)      │ │     │
│                              │  └──────────────────────────────┘ │     │
│                              │                                   │     │
│                              │  ┌──────────────────────────────┐ │     │
│                              │  │  CrowdSec (agent + LAPI)     │ │     │
│                              │  │  - lit logs Caddy + auth.log │ │     │
│                              │  │  - détecte attaques          │ │     │
│                              │  │  - écrit décisions simulées  │ │     │
│                              │  └──────────────────────────────┘ │     │
│                              │                                   │     │
│                              │  Exporters (mode global) :        │     │
│                              │  - node-exporter (host metrics)   │     │
│                              │  - cadvisor (container metrics)   │     │
│                              │  - postgres-exporter              │     │
│                              │  - redis-exporter                 │     │
│                              │  - blackbox-exporter (probes HTTP)│     │
│                              └───────────────────────────────────┘     │
└────────────────────────────────────────────────────────────────────────┘
```

### Flux principaux

- **Prometheus → cibles** : scrape toutes les 30s sur les exporters (host, conteneurs, DB, cache, probes uptime) + l'API NestJS qui expose `/metrics`
- **Promtail → Loki** : tail continu des logs Docker (`/var/lib/docker/containers/*/*-json.log`) + syslog (`/var/log/syslog` pour SSH auth, kernel)
- **Caddy → CrowdSec** : à chaque requête, le bouncer Caddy interroge la LAPI CrowdSec ; **en mode simulation**, la décision retournée est ignorée. Latence : ~1ms.
- **CrowdSec agent → LAPI** : l'agent lit en continu les access logs Caddy + auth.log, applique les scenarios (brute force, scan, SQLi…), écrit des décisions taggées `simulated` dans la LAPI
- **Grafana → Prometheus + Loki** : panneaux qui interrogent les deux datasources

---

## 3. Accès

### Tableau de bord public

| Service | URL | Auth |
|---|---|---|
| **Grafana** (dashboards) | https://grafana.translog.dsyann.info/ | `admin` / mot de passe stocké dans `.env.prod` (variable `GRAFANA_ADMIN_PASSWORD`) |

Toutes les autres composantes (Prometheus, Loki, exporters, CrowdSec LAPI) sont **internes uniquement** — pas exposées via Caddy. Tu y accèdes en SSH via `docker exec`.

### Récupérer le mot de passe Grafana

Le mot de passe est généré aléatoirement au premier déploiement et stocké dans `.env.prod` sur le VPS. Pour le voir :

```bash
ssh root@72.61.108.160
grep ^GRAFANA_ADMIN_PASSWORD= /opt/TranslogPro/infra/prod/.env.prod
```

Format de la valeur : 48 caractères hexadécimaux. C'est bien le mot de passe (pas un hash) — copie-colle-le tel quel dans le formulaire de login.

### Réinitialiser le mot de passe Grafana

Si tu perds le mot de passe ou si Grafana refuse le login avec celui de `.env.prod` (peut arriver si Grafana a été initialisé avec une valeur différente avant que la variable ne soit propagée) :

```bash
ssh root@72.61.108.160
docker exec $(docker ps -q -f name=translog-obs_grafana | head -1) grafana cli admin reset-admin-password 'TonMotDePasse'
```

**Important sur le quoting** :
- Single quotes (`'...'`) → désactive l'expansion bash et de l'historique. Sûr pour tout caractère, **y compris `!`**
- Double quotes (`"..."`) → expansion variables OK mais `!` peut être interprété comme history expansion (`!IUT: event not found`)

Tu dois voir `Admin password changed successfully ✔`. Login immédiat avec le nouveau mot de passe.

### Login en cas de cookie corrompu

Si tu vois "Sign in" alors que tu viens de te logger, ou si tu reviens en boucle sur `/login` avec « Invalid username or password », c'est un cookie de session pourri dans ton navigateur. Solution : **onglet privé/incognito** sur https://grafana.translog.dsyann.info/login. L'incognito part de zéro côté cookies. Une fois que tu y es loggé, tu peux purger les cookies du domaine `translog.dsyann.info` dans ton onglet normal (DevTools F12 → Application → Cookies).

---

## 4. Opérations courantes

### Voir les dashboards

Une fois loggé sur Grafana, menu hamburger ☰ → **Dashboards** → folder **TransLog**. Sept dashboards prêts :

| Dashboard | UID | Couvre |
|---|---|---|
| **VPS — Host metrics** | `translog-host` | CPU, mémoire, disque, réseau du serveur |
| **Containers — Docker stats** | `translog-containers` | CPU/mem/réseau par conteneur Docker |
| **Postgres** | `translog-postgres` | Connexions, commits/rollbacks, cache hit, tailles |
| **Redis** | `translog-redis` | Mémoire, ops/sec, hit ratio |
| **API NestJS — Endpoints & latence** | `translog-api` | Top endpoints, latence p50/p95/p99, taux d'erreur |
| **Uptime — Sous-domaines publics** | `translog-blackbox` | UP/DOWN par sous-domaine, expiration TLS |
| **Logs — Recherche live** | `translog-logs` | Logs API/Caddy/infra/SSH en live |
| **Sécurité — Détections live** | `translog-security` | Top IPs détectées, scenarios déclenchés, distribution géographique (Lot 2) |

URLs directes (utiles si la home affiche n'importe quoi) :
- https://grafana.translog.dsyann.info/d/translog-host
- https://grafana.translog.dsyann.info/d/translog-api
- https://grafana.translog.dsyann.info/d/translog-security
- (etc., remplace par l'UID du dashboard cherché)

### Stocker un dashboard édité dans le repo

Les dashboards sont seedés depuis `infra/prod/observability/grafana/dashboards/*.json` via le mécanisme de provisioning Grafana. Tu peux modifier un dashboard dans l'UI mais **les changements seront écrasés au prochain redéploiement**. Pour persister :

1. Ouvrir le dashboard dans Grafana
2. Settings (icône engrenage en haut) → JSON Model
3. Copier le JSON complet
4. Coller dans le fichier correspondant `infra/prod/observability/grafana/dashboards/<nom>.json`
5. Commit + push → le redéploiement répandra le nouveau JSON

### Requêter Loki en mode Explorer

Menu ☰ → Explore → datasource Loki → en haut. Quelques requêtes utiles :

```logql
# Erreurs récentes côté API
{container_name="translog_api"} |~ "(?i)error|exception|fail"

# Caddy access logs ≥ 400
{container_name="translog_caddy"} | json | status >= 400

# Tentatives SSH échouées (utile pour repérer les brute force avant CrowdSec)
{job="syslog", process="sshd"} |= "Failed password"

# Tous les logs translog
{container_name=~"translog_.+"}
```

### Vérifier qu'une cible Prometheus est UP

Menu ☰ → Explore → datasource Prometheus → tape :

```promql
up
```

Liste de toutes les cibles avec `1` (up) ou `0` (down). Si une cible est down, le filtre :

```promql
up == 0
```

ne montre que les cibles cassées. Ouvre la cible dans Status → Targets dans Grafana ou directement via `docker exec`.

### Voir les détections de sécurité (CrowdSec en simulation)

Le dashboard **Sécurité — Détections live** affiche en continu :
- Compteur d'événements par scenario sur les dernières 24h
- Top 10 IPs source de détections
- Distribution par pays (CrowdSec enrichit les IPs avec géoloc MaxMind GeoLite2 si configuré)
- Liste des décisions actives (taggées `simulated` tant que le scenario n'est pas activé)
- Logs raw des matches CrowdSec (via Loki)

Tant que tous les scenarios sont en simulation, **rien ne se passe pour les utilisateurs réels** — c'est purement informatif.

---

## 5. Investigation / debug

### Une cible Prometheus est down

```bash
ssh root@72.61.108.160
docker exec $(docker ps -q -f name=translog-obs_prometheus | head -1) wget -qO- http://localhost:9090/api/v1/targets | python3 -c "import json,sys; [print(t['labels']['job'], t['labels'].get('instance',''), t['health']) for t in json.load(sys.stdin)['data']['activeTargets']]"
```

Liste lisible : `<job> <instance> <up|down>`. Pour debugger une cible précise (ex: `translog-api` instance `api:3000`) :

```bash
docker exec $(docker ps -q -f name=translog-obs_prometheus | head -1) wget -qO- http://api:3000/metrics | head -20
```

Si la commande retourne du texte qui commence par `# HELP ...`, l'API expose bien ses métriques. Si erreur de connexion, c'est le réseau (l'API n'est pas joignable depuis Prometheus). Si 404, c'est le module métrique de NestJS qui n'est pas chargé.

### Promtail ne ramène rien de Loki

```bash
docker service logs --tail 50 translog-obs_promtail
```

Si tu vois des erreurs de parsing JSON, c'est que la regex pipeline_stages n'arrive pas à extraire les labels. Vérifier la dernière config dans `infra/prod/observability/promtail/promtail-config.yaml`.

### Caddy ne route pas vers Grafana

```bash
docker exec $(docker ps -q -f name=translog_caddy | head -1) wget -qO- http://translog-obs_grafana:3000/api/health
```

Doit retourner `{"database":"ok","version":"10.4.x",...}`. Si `Connection refused`, Caddy n'a pas le réseau `translog_obs_net` — vérifier `docker service inspect translog_caddy --format '{{range .Spec.TaskTemplate.Networks}}{{.Target}} {{end}}'` (devrait inclure `translog_obs_net`).

⚠️ **Toujours utiliser le nom complet `translog-obs_grafana`**, pas l'alias court `grafana`. Si tu utilises l'alias court, Docker DNS peut résoudre vers `gmp_grafana` (Easypanel) qui est sur un autre réseau partagé par Caddy. Cf. [feedback CSP/DNS](#9-limites-connues).

### CrowdSec ne détecte rien

```bash
# Statut de l'agent CrowdSec
docker exec $(docker ps -q -f name=translog-obs_crowdsec | head -1) cscli metrics

# Liste des scenarios installés
docker exec $(docker ps -q -f name=translog-obs_crowdsec | head -1) cscli scenarios list

# Liste des décisions actives (incluant simulées)
docker exec $(docker ps -q -f name=translog-obs_crowdsec | head -1) cscli decisions list

# Vérifier que les sources de logs sont bien acquises
docker exec $(docker ps -q -f name=translog-obs_crowdsec | head -1) cscli metrics show acquisition
```

Si `cscli metrics show acquisition` montre 0 lignes lues, c'est que CrowdSec ne voit pas les logs (mauvais path ou permissions).

---

## 6. Activation / désactivation des scenarios CrowdSec

**État par défaut au déploiement** : tous les scenarios sont en **simulation**. Aucune IP n'est réellement bannie. Le bouncer Caddy ignore les décisions taggées `simulated`.

### Lister les scenarios actuellement en simulation

```bash
ssh root@72.61.108.160
docker exec $(docker ps -q -f name=translog-obs_crowdsec | head -1) cscli simulation status
```

Tu obtiens deux listes :
- **Inclus dans la simulation** : actuellement non-bloquants (ce qu'on a au démarrage)
- **Exclus de la simulation** : actuellement bloquants

### Activer le blocage pour un scenario (= sortir de la simulation)

```bash
docker exec $(docker ps -q -f name=translog-obs_crowdsec | head -1) cscli simulation disable crowdsecurity/http-bf-wordpress_bf
```

À partir de ce moment, toute IP qui matche `crowdsecurity/http-bf-wordpress_bf` sera réellement bloquée par Caddy (HTTP 403). Aucune coupure de service, l'effet est immédiat.

**Suggestion d'ordre d'activation** (du moins risqué au plus impactant) :
1. `crowdsecurity/http-crawl-non_statics` — scrapers qui ratissent en masse les pages dynamiques
2. `crowdsecurity/http-probing` — sondes 404 répétitives type scanner
3. `crowdsecurity/http-bf-wordpress_bf` — brute force sur WordPress (TransLog n'expose pas WordPress, donc 100% de matches sont malveillants)
4. `crowdsecurity/http-cve` — exploits CVE connus
5. `crowdsecurity/ssh-bf` — brute force SSH (si tu as déjà fail2ban-like ailleurs, attention)
6. `crowdsecurity/http-sensitive-files` — accès à /.env, /.git, etc.

Pour chaque scenario, **observe 24h** dans Grafana avant le suivant. Si zéro faux positif, passe au suivant.

### Désactiver un scenario (le repasser en simulation)

```bash
docker exec $(docker ps -q -f name=translog-obs_crowdsec | head -1) cscli simulation enable crowdsecurity/http-bf-wordpress_bf
```

Effet immédiat : plus de nouveaux bans pour ce scenario. **Les bans déjà en cours restent actifs** jusqu'à expiration ou purge manuelle (cf. § Recovery).

### Activer tous les scenarios d'un coup (déconseillé sans observation)

```bash
docker exec $(docker ps -q -f name=translog-obs_crowdsec | head -1) cscli simulation disable --all
```

Si tu fais ça, garde la commande inverse (`enable --all`) sous la main au cas où.

### Whitelist d'une IP / CIDR

La whitelist par défaut est dans `infra/prod/observability/crowdsec/whitelists.yaml` (commit dans le repo, écrasable au redéploiement). Pour une whitelist permanente : éditer ce fichier + commit + push.

Pour une whitelist temporaire (test, intervention) :

```bash
docker exec $(docker ps -q -f name=translog-obs_crowdsec | head -1) cscli decisions add --ip 1.2.3.4 --type whitelist --duration 24h --reason "intervention IP X"
```

---

## 7. Recovery

### Désannuler un ban accidentel sur une IP

```bash
docker exec $(docker ps -q -f name=translog-obs_crowdsec | head -1) cscli decisions delete --ip 1.2.3.4
```

L'IP retrouve l'accès en ~5 secondes (le bouncer Caddy a un cache court de la liste des bans).

### Purger toutes les décisions CrowdSec actives

```bash
docker exec $(docker ps -q -f name=translog-obs_crowdsec | head -1) cscli decisions delete --all
```

Effet : aucune IP n'est plus bannie. Tous les scenarios actifs continuent de fonctionner et peuvent rebannir, mais l'ardoise est repartie de zéro. Utile si tu as activé un scenario trop large par erreur.

### Désactiver complètement le bouncer Caddy (= retour à 100% sans CrowdSec)

Modifier le Caddyfile pour commenter la directive `crowdsec` globale (ou retirer son utilisation par site), puis :

```bash
ssh root@72.61.108.160
cd /opt/TranslogPro/infra/prod
docker service scale translog_caddy=0
sleep 3
docker service scale translog_caddy=1
```

Caddy redémarre en ~5-10s sans le bouncer. CrowdSec continue d'observer, mais plus aucun bouncer ne consulte ses décisions.

Pour un retour propre : push un commit avec le Caddyfile modifié, le rsync du workflow GitHub Actions pousse la modif et le CUTOVER fait le scale 0/1 automatiquement.

### Stack obs entièrement cassée

```bash
docker stack rm translog-obs
```

L'app continue de tourner normalement (stack `translog` indépendante). Tu re-déploies obs ensuite via :

```bash
docker stack deploy -c /opt/TranslogPro/infra/prod/observability/docker-stack.observability.yml translog-obs
```

Ou plus simple : un nouveau push GitHub déclenche `04-deploy.sh` qui re-déploie tout.

### Caddy ne démarre plus après un commit mal foutu (bouncer cassé)

```bash
docker service rollback translog_caddy
```

Swarm garde l'image précédente comme rollback. Cette commande remet l'ancienne version en ~30s. Ensuite tu fix le commit et tu rejoues le deploy.

### Restore complet du VPS

Le script `snapshot-good-state.sh` est exécuté automatiquement par `04-deploy.sh` à la fin de chaque deploy réussi. Il sauvegarde dans `/root/snapshots/good-state-deploy-<sha>/` :
- Tous les volumes critiques (postgres_data, redis_data, vault_data, caddy_data, grafana_data, crowdsec_data)
- `.env.prod`
- `Caddyfile` + `docker-stack.prod.yml` + `docker-stack.observability.yml` + zone BIND9

Pour restaurer le dernier snapshot :

```bash
bash /opt/TranslogPro/infra/prod/scripts/restore-good-state.sh latest
```

Pour lister les snapshots disponibles :

```bash
ls -1dt /root/snapshots/good-state-* | head -10
```

Pour restaurer un snapshot précis :

```bash
bash /opt/TranslogPro/infra/prod/scripts/restore-good-state.sh good-state-deploy-abc1234
```

---

## 8. Mise à jour et maintenance

### Augmenter la rétention Prometheus / Loki

Éditer dans `infra/prod/observability/docker-stack.observability.yml` :

- Prometheus : flag `--storage.tsdb.retention.time=15d` (passe à `30d` par exemple) **et** `--storage.tsdb.retention.size=4GB` (à augmenter en parallèle)
- Loki : `retention_period: 168h` dans `infra/prod/observability/loki/loki-config.yaml` (en heures, 168h = 7 jours)

Commit + push → redeploy.

### Ajouter un nouveau dashboard Grafana

1. Le créer dans l'UI Grafana
2. Settings → JSON Model → copier
3. Coller dans `infra/prod/observability/grafana/dashboards/<nom>.json`
4. Ajouter une entrée `dash_<nom>` dans la section `configs:` de `docker-stack.observability.yml` (cf. patterns existants)
5. Commit + push

### Ajouter un nouveau scenario CrowdSec depuis le hub communautaire

```bash
docker exec $(docker ps -q -f name=translog-obs_crowdsec | head -1) cscli scenarios install crowdsecurity/<nom>
docker service update --force translog-obs_crowdsec    # reload pour pickup
```

Le scenario démarre **en simulation** par défaut (cf. profile.yaml). À toi de l'activer plus tard via `cscli simulation disable`.

### Mettre à jour CrowdSec hub (parsers, scenarios, listes)

```bash
docker exec $(docker ps -q -f name=translog-obs_crowdsec | head -1) cscli hub update
docker exec $(docker ps -q -f name=translog-obs_crowdsec | head -1) cscli hub upgrade
```

---

## 9. Limites connues

### Patterns à éviter (incidents 2026-04-26)

| Anti-pattern | Conséquence | Fix |
|---|---|---|
| `docker service update --force translog_caddy` depuis SSH | Casse la session SSH du runner GitHub Actions (broken pipe ~4 min) — race iptables sur reconfig réseau d'un service mode:host | Modifier le stack file et laisser Swarm rolling update |
| `reverse_proxy grafana:3000` (alias court) | Collision DNS si Caddy est sur plusieurs overlay (translog_obs_net + easypanel-gmp ont tous deux un service `grafana`) → résolution aléatoire entre stacks | Utiliser `<stack>_<service>` (ex: `translog-obs_grafana:3000`) |
| `import translog_headers` dans le bloc Grafana du Caddyfile | Le CSP du SPA TransLog bloque les inline scripts + eval() de Grafana → tous les panels affichent "Panel plugin not found" | Headers minimalistes (HSTS + Referrer-Policy) sans CSP, laisser Grafana set ses propres en-têtes |

### Promtail ne tag pas `container_name` correctement

Promtail extrait `container_name` depuis `attrs.tag` du JSON Docker. Mais Docker ne met pas de `tag` dans `attrs` par défaut. Conséquence : sur le dashboard **Logs — Recherche live**, certaines queries `{container_name="translog_api"}` peuvent ne rien renvoyer.

À fixer : configurer Promtail pour utiliser `docker_sd_configs` (lit la socket Docker pour mapper container_id → service_name) ou tagger via daemon.json. À planifier.

### cAdvisor scrape via `tasks.cadvisor` peut échouer

Si le dashboard **Containers** est vide, c'est que la résolution DNS `tasks.cadvisor` ne fonctionne pas dans l'overlay. À investiguer (probablement collision avec un service homonyme dans une autre stack ou ordre de résolution).

### Mode bouncer Caddy

Le bouncer Caddy est en mode `fail-open` : si la LAPI CrowdSec est inaccessible (ex: container crashé), Caddy laisse passer toutes les requêtes. C'est un choix délibéré pour éviter qu'une panne CrowdSec ne casse la prod. Inconvénient : pendant ce temps, plus aucun ban n'est appliqué.

### Sauvegarde des dashboards édités UI

Les modifs faites directement dans l'UI Grafana **sont écrasées** au prochain redéploiement (provisioning lit le JSON du repo). Toujours réimporter les modifs dans le repo (cf. § 4).

### Pas d'alerting actif

Phase 1 et 2 ne configurent **pas** d'alerting Grafana ni d'Alertmanager Prometheus. Tu vois les choses mais tu ne reçois pas de ping sur Slack/Email/SMS. À ajouter en Phase 3 si besoin.

---

## 10. Annexes

### Fichiers de référence

| Fichier | Rôle |
|---|---|
| [infra/prod/observability/docker-stack.observability.yml](../../../infra/prod/observability/docker-stack.observability.yml) | Stack Swarm complète (Prometheus, Grafana, Loki, exporters, CrowdSec) |
| [infra/prod/observability/prometheus/prometheus.yml](../../../infra/prod/observability/prometheus/prometheus.yml) | Configuration scrape Prometheus |
| [infra/prod/observability/loki/loki-config.yaml](../../../infra/prod/observability/loki/loki-config.yaml) | Configuration Loki (rétention, storage) |
| [infra/prod/observability/promtail/promtail-config.yaml](../../../infra/prod/observability/promtail/promtail-config.yaml) | Pipeline d'extraction labels logs Docker |
| [infra/prod/observability/grafana/](../../../infra/prod/observability/grafana/) | Provisioning datasources + dashboards |
| [infra/prod/observability/blackbox/blackbox.yml](../../../infra/prod/observability/blackbox/blackbox.yml) | Modules de probes uptime |
| [infra/prod/observability/crowdsec/](../../../infra/prod/observability/crowdsec/) | Configs CrowdSec (acquis, profiles, whitelists) |
| [infra/prod/caddy/Dockerfile](../../../infra/prod/caddy/Dockerfile) | Build Caddy custom (rfc2136 + crowdsec bouncer) |
| [infra/prod/caddy/Caddyfile](../../../infra/prod/caddy/Caddyfile) | Configuration Caddy avec directive `crowdsec` globale |
| [infra/prod/scripts/04-deploy.sh](../../../infra/prod/scripts/04-deploy.sh) | Script de déploiement idempotent (les 2 stacks) |
| [.github/workflows/deploy.yml](../../../.github/workflows/deploy.yml) | CI/CD GitHub Actions (build + push GHCR + SSH deploy) |
