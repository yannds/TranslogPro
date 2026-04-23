# Guide d'activation — Distance routière (ROUTING_ENGINE)

## Vue d'ensemble

Le module **ROUTING_ENGINE** remplace le calcul haversine (ligne droite) par une vraie distance routière entre gares, via Google Maps Directions API ou Mapbox Directions API.

**État par défaut** : désactivé. Le système retombe toujours sur haversine si le module est off ou si une clé API manque.

---

## Architecture

```
PlatformConfig
  routing.enabled     (boolean, défaut: false)
  routing.provider    ('haversine' | 'google' | 'mapbox', défaut: 'haversine')

Vault
  platform/google-maps  →  { API_KEY: '...' }
  platform/mapbox       →  { API_KEY: '...' }

RoutingService
  ├── HaversineProvider   (toujours disponible, aucune clé)
  ├── GoogleMapsProvider  (lit Vault, fallback haversine si clé absente)
  └── MapboxProvider      (lit Vault, fallback haversine si clé absente)

Cache Redis   routing:v1:{provider}:{lat1}:{lng1}:{lat2}:{lng2}   TTL 30 jours
```

Le frontend appelle `GET /api/v1/tenants/:tenantId/routes/suggest-distance?originId=&destinationId=`
qui retourne `{ distanceKm, durationMin, provider, estimated }`.

---

## Étapes d'activation

### 1. Obtenir une clé API

**Google Maps Directions API**
1. Aller sur [Google Cloud Console](https://console.cloud.google.com/)
2. Créer un projet ou utiliser un projet existant
3. Activer l'API **Directions API**
4. Créer une clé API → restreindre aux IPs serveur en production
5. Quota gratuit : 200 $/mois (≈ 40 000 requêtes/mois)

**Mapbox Directions API**
1. Créer un compte sur [mapbox.com](https://www.mapbox.com/)
2. Générer un token public avec scope `directions:read`
3. Quota gratuit : 100 000 requêtes/mois

### 2. Stocker la clé dans Vault

```bash
# Google Maps
curl -s -X POST \
  -H "X-Vault-Token: ${VAULT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"data": {"API_KEY": "VOTRE_CLE_GOOGLE"}}' \
  http://localhost:8200/v1/secret/data/platform/google-maps

# Mapbox
curl -s -X POST \
  -H "X-Vault-Token: ${VAULT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"data": {"API_KEY": "VOTRE_TOKEN_MAPBOX"}}' \
  http://localhost:8200/v1/secret/data/platform/mapbox

# Vérifier
curl -s -H "X-Vault-Token: ${VAULT_TOKEN}" \
  http://localhost:8200/v1/secret/data/platform/google-maps | python3 -m json.tool
```

### 3. Activer via l'UI plateforme

1. Se connecter en tant que **SUPER_ADMIN**
2. Aller dans `/platform/settings`
3. Groupe **"Routage & Distance"** :
   - `routing.enabled` → `true`
   - `routing.provider` → `google` ou `mapbox`
4. Enregistrer — effet sous 60 secondes (cache TTL)

### 4. Activer pour le tenant

1. Aller dans **Paramètres → Modules & Extensions**
2. Le module **Distance routière** n'est plus grisé
3. Activer le toggle

---

## Comparaison des providers

| Provider    | Couverture Congo/Afrique centrale | Coût           | Latence |
|-------------|-----------------------------------|----------------|---------|
| haversine   | N/A (ligne droite)                | Gratuit        | <1 ms   |
| google      | ★★★★☆ (données propriétaires)   | 200 $/mois gratuit puis ~5 $/1000 req | 200–500 ms |
| mapbox      | ★★★☆☆ (données OSM enrichies)   | 100k req/mois gratuit puis ~0,50 $/1000 req | 150–400 ms |

**Recommandation pour Congo / Afrique centrale** : `google` offre la meilleure couverture routière (RN1, N2, etc.). Mapbox est acceptable pour les corridors majeurs.

---

## Caching

Les résultats sont mis en cache Redis avec une TTL de **30 jours** :
- Clé : `routing:v1:{provider}:{lat1}:{lng1}:{lat2}:{lng2}` (arrondi à 4 décimales)
- Invalider manuellement si les routes changent :
  ```bash
  # Invalider tout le cache routing
  redis-cli KEYS "routing:v1:*" | xargs redis-cli DEL
  ```

---

## Fallbacks

Le système ne crashe jamais. Chaîne de fallback :

1. Provider sélectionné → appel API externe
2. Si erreur réseau / clé invalide → haversine (logged `WARN`)
3. Si gares sans coordonnées GPS → `null` (l'endpoint retourne 404)

Le champ `estimated: true` dans la réponse indique un résultat haversine, quelle qu'en soit la raison.

---

## Variables d'environnement Vault (production AppRole)

```env
VAULT_ADDR=https://vault.internal:8200
VAULT_ROLE_ID=<appRole roleId>
VAULT_SECRET_ID=<appRole secretId>
```

Les secrets sont lus depuis `secret/data/platform/google-maps` et `secret/data/platform/mapbox`.
