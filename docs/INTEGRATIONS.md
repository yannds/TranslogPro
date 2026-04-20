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

| Key | Display name | Implémentation | Vault path |
|---|---|---|---|
| `google` | Google | [google.provider.ts](../src/modules/oauth/providers/google.provider.ts) | `platform/auth/google` |
| `microsoft` | Microsoft | [microsoft.provider.ts](../src/modules/oauth/providers/microsoft.provider.ts) | `platform/auth/microsoft` |
| `facebook` | Facebook | [facebook.provider.ts](../src/modules/oauth/providers/facebook.provider.ts) | `platform/auth/facebook` |

À quoi ça sert : bouton « Se connecter avec Google » sur la page de login tenant et le portail voyageur.

**Alignement sur PAYMENT** (migration 19/04/2026) — les providers OAuth lisent désormais leurs credentials **depuis Vault** (plus d'env vars). Même cache 5 min que Twilio/payments. Un provider non configuré reste visible dans l'UI mais grisé avec un badge « Non configuré » et un message « Demandez à l'admin plateforme de provisionner Vault ». Les actions SANDBOX/LIVE sont verrouillées tant que les secrets manquent — évite une erreur opaque au premier clic. Voir §9.

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
| **Provisionner les secrets du provider** (config partagée) | Admin plateforme (SUPER_ADMIN) | Vault (`http://localhost:8200` en dev, Vault cluster en prod) | `vault kv put secret/platform/payments/mtn_momo_cg …` ou script TS dans `infra/vault/`. |
| **Saisir ses propres credentials** (BYO) | Admin tenant avec `control.integration.setup.tenant` | Page `/admin/integrations` → bouton "Saisir mes identifiants" | Voir §13. |
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

**Depuis la migration du 19/04/2026, les credentials OAuth vivent dans Vault** (comme PAYMENT). Les 3 providers sont **toujours visibles** dans l'onglet AUTH ; ils apparaissent grisés avec badge « Non configuré » tant que Vault n'a pas leurs secrets. Les boutons SANDBOX/LIVE sont verrouillés dans cet état.

### Activer Google en dev

1. Crée un projet OAuth sur https://console.cloud.google.com/apis/credentials → OAuth client ID, type « Web application ».
2. Ajoute les URIs de redirection, au minimum :
   - `https://trans-express.translog.test/api/auth/oauth/google/callback`
   - `https://citybus-congo.translog.test/api/auth/oauth/google/callback`
3. Provisionne Vault :
   ```bash
   vault kv put secret/platform/auth/google \
     CLIENT_ID="xxx.apps.googleusercontent.com" \
     CLIENT_SECRET="GOCSPX-yyy"
   ```
   En UI Vault (`http://localhost:8200`, token `dev-root-token`) : secret/ → platform/auth/google → deux clés `CLIENT_ID` et `CLIENT_SECRET`.
4. Recharge `/admin/integrations` → Google perd le badge « Non configuré » et les boutons DISABLED/SANDBOX/LIVE deviennent cliquables.
5. Clique l'icône refresh (healthcheck) → vérifie que les credentials sont bien présents et accessibles.
6. Bascule en **SANDBOX** → le tenant peut tester « Se connecter avec Google » sans risque prod. Puis **LIVE** avec confirmation MFA.

### Microsoft / Facebook

Même principe, chemins Vault respectifs :
- **Microsoft** : https://entra.microsoft.com/ → App registrations. Chemin Vault `platform/auth/microsoft` :
  ```bash
  vault kv put secret/platform/auth/microsoft \
    CLIENT_ID="..." CLIENT_SECRET="..." TENANT_SEGMENT="common"
  ```
  `TENANT_SEGMENT` est optionnel (défaut `common`). Valeurs possibles : `common` (multi-tenant Azure), `consumers`, `organizations`, ou un GUID Azure AD pour un tenant spécifique.
- **Facebook** : https://developers.facebook.com/ → Create App. Chemin Vault `platform/auth/facebook` :
  ```bash
  vault kv put secret/platform/auth/facebook \
    CLIENT_ID="facebook-app-id" CLIENT_SECRET="facebook-app-secret"
  ```

### Mode SANDBOX pour OAuth — comment ça marche

Contrairement à PAYMENT, Google/Microsoft/Facebook n'ont pas d'endpoint sandbox natif — tu crées soit une app « test » soit une app « prod » chez eux. Dans notre modèle, `SANDBOX` côté base = « provider activable pour tenant mais reconnu comme environnement de test » : même endpoint public, juste un flag sémantique. Concrètement tu peux créer **2 apps OAuth distinctes** chez Google (`translogpro-sandbox` + `translogpro-prod`) et provisionner deux Vault paths (`platform/auth/google-sandbox` + `platform/auth/google`) si tu veux une vraie isolation. À ce stade, on garde le modèle simple : un seul Vault path par provider, et `SANDBOX` / `LIVE` sont des indicateurs métier enregistrés en DB (`oauth_provider_states.mode`).

---

## 10. Chemins backend utiles

| Fichier | Rôle |
|---|---|
| [src/modules/tenant-settings/tenant-settings.controller.ts](../src/modules/tenant-settings/tenant-settings.controller.ts) | Endpoints REST `/api/v1/tenants/:tid/settings/integrations` + `/credentials` + `/schema`. |
| [src/modules/tenant-settings/integrations.service.ts](../src/modules/tenant-settings/integrations.service.ts) | Logique métier : agrégation PAYMENT + AUTH, changement de mode, healthcheck, BYO-credentials. |
| [src/infrastructure/payment/payment-provider.registry.ts](../src/infrastructure/payment/payment-provider.registry.ts) | Registre plateforme des providers PAYMENT avec lecture du mode effectif par tenant + `getCredentialSchema()`. |
| [src/infrastructure/payment/providers/types.ts](../src/infrastructure/payment/providers/types.ts) | Types `PaymentProviderMeta` (incl. `credentialFields: CredentialFieldSpec[]`) et `CredentialFieldSpec`. |
| [src/modules/oauth/providers/oauth-provider.registry.ts](../src/modules/oauth/providers/oauth-provider.registry.ts) | Registre OAuth — tous providers visibles, filtrage à l'appel via `isConfigured()`. |
| [src/modules/oauth/providers/base-oauth.provider.ts](../src/modules/oauth/providers/base-oauth.provider.ts) | Base class abstraite : cache Vault 5 min, `isConfigured()`, exécution des credentials. |
| Table `payment_provider_states` | État d'activation PAYMENT : (tenantId\|null, providerKey, mode, vaultPath, lastHealthCheckAt, activatedBy). |
| Table `oauth_provider_states` | État d'activation OAuth : même schéma que PAYMENT, tenant-scopable. |
| [frontend/components/pages/PageIntegrations.tsx](../frontend/components/pages/PageIntegrations.tsx) | Page UI avec onglets PAYMENT / AUTH, bouton "Saisir mes identifiants" par provider PAYMENT. |
| [frontend/components/pages/integrations/IntegrationCredentialsDialog.tsx](../frontend/components/pages/integrations/IntegrationCredentialsDialog.tsx) | Modale formulaire dynamique BYO-credentials par provider. |

---

## 11. Roadmap connue (à faire)

- Remplacer le `confirm()` UI pour le passage LIVE par un vrai TOTP step-up via `/auth/mfa/verify`.
- Table d'audit dédiée `integration_audit_log` (actuellement seul `activatedBy` + timestamp sont conservés).
- Catégories NOTIFICATION (Twilio, Brevo) et STORAGE (S3, Cloudflare R2).
- Providers OAuth configurables par tenant avec Vault paths tenant-scopés (aujourd'hui plateforme-global).
- Apps OAuth distinctes sandbox/prod pour Google/Microsoft/Facebook si vrai besoin d'isolation test/prod (cf. §9).
- IHM de rotation de credentials : bouton "Révoquer mes identifiants" pour revenir à la config plateforme.

## 12. Email transactionnel

La partie email (envoi de billets, rappels, magic links) n'est **pas** dans la page Intégrations. C'est par design — l'email est un canal technique plateforme-global, pas un service tenant-activable. Voir la documentation dédiée : [EMAIL.md](./EMAIL.md).

---

## 13. BYO-credentials — saisie des identifiants par le tenant

**Modèle B** : le tenant fournit ses propres clés API sans passer par l'admin plateforme.

### Flux complet

1. **Admin tenant** ouvre `/admin/integrations`, onglet **Paiement**.
2. Il clique le bouton **"Saisir mes identifiants"** (ou "Mettre à jour") sur la ligne du provider souhaité.
3. La modale `IntegrationCredentialsDialog` s'ouvre avec un formulaire dynamique dérivé du schéma du provider (champs requis/optionnels, type text/password/select, help contextuel).
4. Il saisit ses clés (obtenues sur le portail développeur du provider) et clique **Enregistrer**.
5. L'API valide le payload contre le schéma (`CredentialFieldSpec[]`), écrit dans Vault à `tenants/<tenantId>/payments/<providerKey>`, et crée/met à jour la ligne `paymentProviderState` avec `vaultPath = tenants/<tid>/...` et `scopedToTenant = true`.
6. La ligne affiche désormais le badge **"Mes identifiants"** (teal). Le provider est activable en SANDBOX puis LIVE normalement.

**Garde-fou** : si le provider était en mode LIVE lors de la sauvegarde, il est automatiquement rétrogradé en SANDBOX (les credentials viennent de changer — il faut re-valider).

### Champs par provider (référence rapide)

| Provider | Champs requis | Optionnels |
|---|---|---|
| **MTN MoMo Congo** | COLLECTION_SUBSCRIPTION_KEY, COLLECTION_API_USER, COLLECTION_API_KEY, DISBURSEMENT_SUBSCRIPTION_KEY, DISBURSEMENT_API_USER, DISBURSEMENT_API_KEY, TARGET_ENVIRONMENT (sandbox\|mtncongo), WEBHOOK_HMAC_KEY | BASE_URL |
| **Airtel Money Congo** | CLIENT_ID, CLIENT_SECRET, X_COUNTRY (ex: CG), X_CURRENCY (ex: XAF), WEBHOOK_HMAC_KEY | BASE_URL |
| **Wave** | API_KEY, WEBHOOK_SECRET | BASE_URL |
| **Flutterwave** | SECRET_KEY, WEBHOOK_HASH | — |
| **Paystack** | SECRET_KEY | — |
| **Stripe** | API_KEY, WEBHOOK_SECRET | — |

Le schéma complet (avec labels et help contextuel) est disponible via `GET /api/v1/tenants/:tid/settings/integrations/:key/schema`.

### Endpoints BYO-credentials

| Méthode | Chemin | Description |
|---|---|---|
| `GET`    | `/tenants/:tid/settings/integrations/:key/schema`      | Schéma des champs (sans valeurs — jamais de secret). |
| `PUT`    | `/tenants/:tid/settings/integrations/:key/credentials` | Enregistre les credentials dans Vault tenant-scoped. |
| `DELETE` | `/tenants/:tid/settings/integrations/:key/credentials` | Supprime de Vault et revient à la config plateforme (si disponible). |

### Vault path tenant-scoped

```
tenants/<tenantId>/payments/<providerKey>
```

Exemple : `tenants/tenant-abc-123/payments/wave`

Jamais exposé dans l'UI — l'`IntegrationItem.vaultPathPreview` masque le milieu (`ten•••abc/payments/wav•••`).

### Sécurité

- Seules les clés déclarées dans `credentialFields` du provider sont acceptées — rejet 400 de tout champ hors schéma (impossible d'injecter un path Vault arbitraire).
- La permission `control.integration.setup.tenant` est requise sur les 3 endpoints — isolation cross-tenant garantie par la condition `tenantId` du guard.
- `deleteSecret` utilise `DELETE /secret/metadata/<path>` en KV v2 — supprime toutes les versions.
