# Intégrations API — documentation complète

> Documentation de référence pour la page **Paramètres → Intégrations** (`/admin/integrations`).
> Cible : admin tenant, admin plateforme, intégrateur.

---

## 0. TL;DR — qui fait quoi en 2 étapes

**Admin plateforme** (toi, SUPER_ADMIN) provisionne les credentials dans Vault **une seule fois** :

```bash
vault kv put secret/platform/payments/mtn_momo_cg \
  PRIMARY_KEY=xxx \
  SECRET_KEY=yyy \
  CALLBACK_URL=https://trans-express.translog.test/api/webhooks/mtn
```

En dev, trois façons équivalentes d'écrire ce secret :
- **Script idempotent** : `./infra/vault/init.sh` (seeding dev complet — voir [STACK_INFRA_ACCESS.md §Vault](../STACK_INFRA_ACCESS.md#vault))
- **UI Vault** : `http://localhost:8200` avec le token `dev-root-token` (connexion → Method: Token)
- **Script TS dédié** : utiliser `VaultService.putSecret()` depuis un script ad hoc

**Admin du tenant** ouvre `/admin/integrations` et bascule simplement le mode `DISABLED → SANDBOX → LIVE`. Il ne voit **jamais** les secrets — seulement l'état du connecteur, un aperçu masqué du chemin Vault, et le résultat du healthcheck.

Pour les credentials eux-mêmes (Vault, Postgres, Redis, MinIO…) voir le guide d'accès complet : [STACK_INFRA_ACCESS.md](../STACK_INFRA_ACCESS.md).

---

## 1. À quoi sert cette page

La page « Intégrations » est le point de contrôle des **connecteurs tiers** de ton tenant. Chaque ligne = un service externe que la plateforme sait appeler pour ton compte (encaisser un paiement, authentifier un utilisateur via un IdP, envoyer un SMS, etc.).

La page **n'affiche jamais de secret** — seulement l'état du connecteur, son mode effectif, un aperçu masqué du chemin Vault, la date du dernier healthcheck, et l'acteur qui a activé le connecteur.

Source de vérité côté backend : [`src/modules/tenant-settings/integrations.service.ts`](../src/modules/tenant-settings/integrations.service.ts).

---

## 2. Définitions

| Terme | Définition |
|---|---|
| **Provider** | Un fournisseur tiers (MTN, Google, Stripe…). Implémenté par une classe dans `src/infrastructure/payment/providers/` ou `src/modules/oauth/providers/`. |
| **Provider key** | Identifiant stable d'un provider (`mtn_momo_cg`, `google`, `stripe`…). Jamais traduit, jamais typé par l'utilisateur. |
| **Catégorie** | Famille fonctionnelle du provider : `PAYMENT` ou `AUTH` aujourd'hui, `NOTIFICATION` / `STORAGE` prévus. |
| **Mode** | État effectif pour un couple (tenant × provider) : `DISABLED` / `SANDBOX` / `LIVE`. |
| **Vault path** | Chemin dans HashiCorp Vault où vivent les secrets du provider (clés API, webhook secret…). Jamais exposé en clair dans la page — on n'en montre qu'une empreinte (`platform/payments/•••_cg`). |
| **Scope** | `scopedToTenant = true` signifie « le provider peut utiliser des credentials spécifiques à ce tenant » (par ex. sous-compte MTN dédié). Sinon, tous les tenants partagent les credentials plateforme. |
| **Healthcheck** | Ping authentifié léger vers le provider pour vérifier que les credentials sont valides et que l'API répond. Résultat : `UP` / `DEGRADED` / `DOWN` / `UNKNOWN`. |
| **Step-up MFA** | Vérification MFA supplémentaire exigée au moment d'activer le mode `LIVE` (sécurité anti-erreur humaine). |

---

## 3. Catégories disponibles

### 3.1 PAYMENT — encaissement

Cinq providers implémentés à ce jour :

| Key | Display name | Implémentation | Vault path par défaut |
|---|---|---|---|
| `mtn_momo_cg` | MTN Mobile Money (Congo) | [mtn-momo-cg.provider.ts](../src/infrastructure/payment/providers/mtn-momo-cg.provider.ts) | `platform/payments/mtn_momo_cg` |
| `airtel_cg` | Airtel Money (Congo) | [airtel-cg.provider.ts](../src/infrastructure/payment/providers/airtel-cg.provider.ts) | `platform/payments/airtel_cg` |
| `wave` | Wave | [wave.provider.ts](../src/infrastructure/payment/providers/wave.provider.ts) | `platform/payments/wave` |
| `flutterwave` | Flutterwave (agrégateur) | [flutterwave-agg.provider.ts](../src/infrastructure/payment/providers/flutterwave-agg.provider.ts) | `platform/payments/flutterwave` |
| `paystack` | Paystack (agrégateur) | [paystack-agg.provider.ts](../src/infrastructure/payment/providers/paystack-agg.provider.ts) | `platform/payments/paystack` |
| `stripe` | Stripe | [stripe.provider.ts](../src/infrastructure/payment/providers/stripe.provider.ts) | `platform/payments/stripe` |

À quoi ça sert : encaissement des billets vendus sur le portail voyageur, des colis déposés au portail public, et **des abonnements SaaS de la plateforme** (`/admin/billing` → checkout).

### 3.2 AUTH — connexion OAuth

Trois providers implémentés :

| Key | Display name | Implémentation | Credentials |
|---|---|---|---|
| `google` | Google | [google.provider.ts](../src/modules/oauth/providers/google.provider.ts) | Env var `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| `microsoft` | Microsoft | [microsoft.provider.ts](../src/modules/oauth/providers/microsoft.provider.ts) | Env var `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` |
| `facebook` | Facebook | [facebook.provider.ts](../src/modules/oauth/providers/facebook.provider.ts) | Env var `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` |

À quoi ça sert : bouton « Se connecter avec Google » sur la page de login tenant et le portail voyageur.

**Différence notable avec PAYMENT** : les providers OAuth sont configurés **par variable d'environnement** (pas Vault). C'est historique et tient au fait que ce sont des credentials plateforme globaux, pas tenant-scoped. Sans ces env vars, `isEnabled = false` → le provider est **silencieusement ignoré** → n'apparaît pas dans la liste.

---

## 4. Les trois modes — ce que chaque bouton fait

| Bouton | Effet immédiat | Conséquence business |
|---|---|---|
| **DISABLED** | `mode = 'DISABLED'` en DB. | Aucun appel au provider. L'orchestrator refuse toute tentative avec ce provider key. Les tokens OAuth déjà émis restent valides mais plus aucune nouvelle auth ne passe. |
| **SANDBOX** | `mode = 'SANDBOX'`. Au prochain appel, le provider utilise **l'endpoint sandbox** et les **credentials sandbox** du Vault. | Mode test. Les `PaymentIntent` sont créés pour de vrai en DB (avec statut, montant, webhook…) mais les transactions ne débitent rien. Utile pour valider la chaîne end-to-end avant ouverture commerciale. |
| **LIVE** | `mode = 'LIVE'`, nécessite `mfaVerified: true` dans le payload. Trace `activatedAt` + `activatedBy`. | Production. Vraies transactions, vrai argent, webhooks vers l'URL de prod. |

La transition `DISABLED → SANDBOX` ne demande rien. La transition `SANDBOX → LIVE` **exige une confirmation MFA step-up** (actuellement une `confirm()` côté UI, à remplacer par un vrai challenge TOTP en production — cf. [integrations.service.ts:123](../src/modules/tenant-settings/integrations.service.ts#L123)).

### Ce qui change en coulisses quand tu bascules

```
Tenant clique SANDBOX
  → PATCH /api/v1/tenants/:tid/settings/integrations/mtn_momo_cg { mode: 'SANDBOX' }
  → IntegrationsService.updatePaymentMode()
  → INSERT/UPDATE payment_provider_states (tenantId, providerKey, mode='SANDBOX')
  → (aucun credential ajusté — ils vivent dans Vault)

Première transaction après bascule
  → PaymentOrchestrator.createIntent()
  → PaymentProviderRegistry.get('mtn_momo_cg', tenantId)
  → lecture du mode effectif → 'SANDBOX'
  → lecture des credentials Vault au chemin `platform/payments/mtn_momo_cg` (ou tenant-scoped si scopedToTenant=true)
  → appel MTN Momo sur l'endpoint sandbox
```

---

## 5. Où vivent les secrets et les paramètres

### Trois sources distinctes

| Type de donnée | Lieu de stockage | Qui y écrit | Format typique |
|---|---|---|---|
| **Secrets PAYMENT** (API key, webhook secret, merchant ID) | HashiCorp Vault — chemin `platform/payments/<key>` ou `tenants/<tenantId>/payments/<key>` | Admin plateforme, via CLI `vault kv put` ou script `infra/vault/init.sh` | `{ PRIMARY_KEY, SECRET_KEY, CALLBACK_URL, ... }` |
| **Secrets AUTH** (client_id, client_secret) | Variables d'environnement de l'API (`.env`, secrets de déploiement) | Admin plateforme, au déploiement | `GOOGLE_CLIENT_ID=xxx` dans `.env` |
| **État d'activation** (mode, healthcheck, activatedBy) | Table Postgres `payment_provider_states` | Admin tenant, via la page UI | Row par (tenantId, providerKey) |

**Règle d'or** : les secrets ne passent **jamais** par l'API applicative. Ni en écriture, ni en lecture, ni en log. Un dump de la base de l'application ne compromet aucun accès tiers.

### Aperçu Vault masqué dans l'UI

Ce que l'utilisateur voit : `platform/payments/•••_cg` (empreinte du path). Génération : [integrations.service.ts:189](../src/modules/tenant-settings/integrations.service.ts#L189) — on garde les 3 premiers + 3 derniers caractères du dernier segment.

---

## 6. Qui fait quoi — matrice de responsabilités

| Action | Rôle requis | Où | Comment |
|---|---|---|---|
| **Ajouter un nouveau provider** (code) | Dev | PR sur le repo | Implémenter `IPaymentProvider` ou `IOAuthProvider`, déclarer dans le module. |
| **Provisionner les secrets du provider** | Admin plateforme (SUPER_ADMIN) | Vault (`http://localhost:8200` en dev, Vault cluster en prod) | `vault kv put secret/platform/payments/mtn_momo_cg PRIMARY_KEY=… SECRET_KEY=…` ou script TS dans `infra/vault/`. |
| **Activer le provider pour un tenant** (mode) | Admin tenant avec `control.integration.setup.tenant` | Page `/admin/integrations` | Bouton SANDBOX ou LIVE. |
| **Confirmer le passage LIVE** | Même admin tenant + MFA TOTP valide | Page `/admin/integrations` | Confirm dialog aujourd'hui → TOTP step-up demain. |
| **Tester la connexion** | Admin tenant | Page `/admin/integrations` | Icône refresh à droite de la ligne → `POST /healthcheck`. |
| **Consulter l'audit** | SUPER_ADMIN ou admin tenant | Logs + table `payment_provider_states` (colonnes `activatedAt`, `activatedBy`) | Historique limité aujourd'hui, à enrichir avec table dédiée si besoin. |

**Permission frontend / backend** : la route est gardée par `Permission.INTEGRATION_SETUP_TENANT` (clé `control.integration.setup.tenant`). Les rôles par défaut qui l'ont : `TENANT_ADMIN`.

---

## 7. Workflow complet d'activation — exemple MTN Momo Congo sandbox

1. **Dev** a poussé le code `mtn-momo-cg.provider.ts` (déjà fait).
2. **Admin plateforme** récupère des credentials sandbox sur https://momodeveloper.mtn.com/ (gratuit, email requis) : un `Ocp-Apim-Subscription-Key`, un user ID/API key généré via leur console.
3. **Admin plateforme** provisionne Vault :
   ```bash
   vault kv put secret/platform/payments/mtn_momo_cg \
     PRIMARY_KEY="xxx" \
     USER_ID="yyy" \
     API_KEY="zzz" \
     CALLBACK_URL="https://trans-express.translog.test/api/webhooks/mtn"
   ```
4. **Admin tenant** ouvre `/admin/integrations`, voit MTN Momo avec statut `DISABLED` et healthStatus `UNKNOWN`.
5. **Admin tenant** clique **SANDBOX**. Ligne mise à jour. Clique ensuite l'icône refresh (healthcheck) → obtient `UP` si les credentials sont valides.
6. **Admin tenant** fait une vente test sur `/admin/pos` ou un `POST /subscription/checkout` → l'`PaymentIntent` part vers l'endpoint sandbox MTN → retour `SUCCEEDED` sans vrai débit.
7. Après validation complète, **Admin tenant** clique **LIVE**, confirme le MFA → le tenant passe en production. Les prochaines transactions iront sur `https://momoapi.mtn.com/` (prod).

---

## 8. Dépannage — symptômes courants

| Symptôme | Cause probable | Fix |
|---|---|---|
| Onglet `Intégrations API` vide (aucune ligne) | Aucun provider enregistré côté serveur. | Vérifier que `PaymentModule` et `OAuthModule` sont bien importés dans `app.module.ts`. |
| Onglet AUTH vide alors que PAYMENT en montre | Les env vars `GOOGLE_CLIENT_ID` / `MICROSOFT_CLIENT_ID` / `FACEBOOK_APP_ID` ne sont pas setées. C'est **le cas par défaut en dev**. | Ajouter les variables dans `.env` de l'API et redémarrer. Voir §9. |
| Ligne affichée avec icône `ShieldAlert` orange (secretsConfigured=false) | Aucune ligne `payment_provider_states` pour le tenant + Vault n'a pas de path enregistré. | Provisionner Vault ET cliquer SANDBOX au moins une fois (crée la ligne DB). |
| Healthcheck retourne `DOWN` | Credentials invalides ou expirés, ou provider tiers en panne. | Vérifier la valeur Vault, puis `vault kv rotate`. |
| Bascule en LIVE échoue `MFA step-up required` | Normal — la confirmation UI doit envoyer `mfaVerified: true`. | C'est le comportement attendu ; implémenter un vrai TOTP challenge en prod. |
| 404 sur `/api/v1/tenants/:tid/settings/integrations` | Controller sans version mappée sur `/api/v1/...`. | Vérifier que `TenantSettingsController` est bien `@Controller({ version: '1', path: '...' })`. Fixé le 19/04/2026. |

---

## 9. Activer les providers OAuth (Google/Microsoft/Facebook)

**Pourquoi l'onglet AUTH est vide** : les providers OAuth sont filtrés par `isEnabled`, qui est `true` **uniquement** si les variables d'environnement correspondantes sont setées. Sans elles, le registre n'enregistre rien → l'UI reçoit une liste vide pour la catégorie `AUTH`.

### Activer Google en dev

1. Crée un projet OAuth sur https://console.cloud.google.com/apis/credentials → OAuth client ID, type « Web application ».
2. Ajoute les URIs de redirection, au minimum :
   - `https://trans-express.translog.test/api/auth/oauth/google/callback`
   - `https://citybus-congo.translog.test/api/auth/oauth/google/callback`
3. Copie le Client ID et Client Secret dans l'`.env` de l'API :
   ```bash
   GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-yyy
   ```
4. Redémarre l'API (`./scripts/stop.sh --app && npm run start:dev`).
5. Au démarrage tu dois voir dans les logs : `[OAuth] provider "google" registered`. Si tu lis `provider "google" disabled (missing env) — skipped`, c'est que les vars ne sont pas correctement chargées.
6. Recharge `/admin/integrations` → Google apparaît dans l'onglet AUTH avec mode `LIVE` (les providers OAuth n'ont pas de mode SANDBOX côté registre — ils sont soit enregistrés soit pas).

### Microsoft / Facebook

Même principe :
- Microsoft : https://entra.microsoft.com/ → App registrations → ajouter l'app, récupérer client ID + secret → env vars `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`.
- Facebook : https://developers.facebook.com/ → Create App → env vars `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`.

---

## 10. Chemins backend utiles

| Fichier | Rôle |
|---|---|
| [src/modules/tenant-settings/tenant-settings.controller.ts](../src/modules/tenant-settings/tenant-settings.controller.ts) | Endpoints REST `/api/v1/tenants/:tid/settings/integrations`. |
| [src/modules/tenant-settings/integrations.service.ts](../src/modules/tenant-settings/integrations.service.ts) | Logique métier : agrégation PAYMENT + AUTH, changement de mode, healthcheck. |
| [src/infrastructure/payment/payment-provider.registry.ts](../src/infrastructure/payment/payment-provider.registry.ts) | Registre plateforme des providers PAYMENT avec lecture du mode effectif par tenant. |
| [src/modules/oauth/providers/oauth-provider.registry.ts](../src/modules/oauth/providers/oauth-provider.registry.ts) | Registre OAuth, filtré par `isEnabled` à l'init du module. |
| Table `payment_provider_states` | État d'activation : (tenantId|null, providerKey, mode, lastHealthCheckAt, activatedBy). |
| [frontend/components/pages/PageIntegrations.tsx](../frontend/components/pages/PageIntegrations.tsx) | Page UI avec onglets PAYMENT / AUTH. |

---

## 11. Roadmap connue (à faire)

- Remplacer le `confirm()` UI pour le passage LIVE par un vrai TOTP step-up via `/auth/mfa/verify`.
- Table d'audit dédiée `integration_audit_log` (actuellement seul `activatedBy` + timestamp sont conservés).
- UI de rotation de credentials (aujourd'hui il faut passer par Vault CLI).
- Catégories NOTIFICATION (Twilio, Brevo) et STORAGE (S3, Cloudflare R2).
- Providers OAuth configurables par tenant (aujourd'hui plateforme-global).
