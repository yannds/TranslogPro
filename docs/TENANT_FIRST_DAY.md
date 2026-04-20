# Manuel — Jour 1 sur un nouveau tenant TransLog Pro

Tu viens de signer ton espace via `/signup`, tu as cliqué sur « Accéder
à mon espace » et tu es connecté en **TENANT_ADMIN**. Ce manuel te
donne **l'ordre exact** pour configurer ton tenant sans tomber sur un
écran qui te réclame un prérequis non fait.

> Ce document complète [DEV_MANUAL_SIGNUP.md](DEV_MANUAL_SIGNUP.md)
> (création du tenant). Ici on part du moment où tu es **à l'intérieur**
> du tenant.

---

## Ce qui est DÉJÀ fait automatiquement au signup

Tu n'as pas à les recréer — ils existent dès que ton tenant est né :

| Élément                 | Comment                                                |
|-------------------------|--------------------------------------------------------|
| **Agence par défaut**   | « Siège » / « Headquarters » — invariant ≥ 1 agence    |
| **TENANT_ADMIN user**   | Toi, avec le couple email/password du wizard           |
| **Rôles système**       | `TENANT_ADMIN`, `AGENCY_MANAGER`, `CASHIER`, `DRIVER`, `DISPATCHER` (non supprimables, 30+ permissions fines chacun) |
| **Devise / locale / timezone** | Dérivés du pays choisi au wizard                 |
| **WorkflowConfigs**     | 40+ blueprints seedés (`DEFAULT_WORKFLOW_CONFIGS`) pour Trip, Ticket, Parcel, Invoice, Staff, etc. |
| **Plan + trial 30 j**   | Abonnement actif, tous les modules du plan débloqués   |

Tu ne vois donc jamais un écran « créez d'abord une agence » ou
« créez d'abord un rôle ».

---

## Étape 1 — Finir le wizard d'onboarding (≈ 5 min)

Tu y es redirigé automatiquement : **`/onboarding`**

| # | Étape                  | Obligatoire ? | À remplir                                                     |
|---|------------------------|---------------|---------------------------------------------------------------|
| 1 | **Branding**           | Non           | Nom commercial, logo (URL), couleur primaire, email support   |
| 2 | **Agence principale**  | **Oui**       | Renommer l'agence par défaut (« Siège Dakar »…)               |
| 3 | **Première station**   | **Oui**       | Nom, ville, type (PRINCIPALE / RELAIS)                        |
| 4 | **Première route**     | Oui pour TICKETING/MIXED | Origine → destination + prix de base           |
| 5 | **Inviter l'équipe**   | Non           | Emails + rôles (à faire maintenant ou plus tard)              |

> **Pourquoi c'est important** : l'étape 4 auto-crée les
> `PricingRules` par défaut sur la route. Si tu la sautes, tu devras
> créer un tarif à la main avant la première vente.

Tu peux sauter une étape optionnelle — tu reviendras dessus plus tard.

---

## Étape 2 — Remplir 3 configs tenant avant d'opérer

Accès : **`/admin/settings`** (TENANT_ADMIN).

### a. Règles métier — `/admin/settings/rules`

Sans cette page, ton tenant fonctionne avec les fallbacks legacy
(2 tiers hardcoded). Tu veux tes vraies règles :

- **Annulation** : N tiers `{ hoursBeforeDeparture, penaltyPct }`
- **No-show** : délai de grâce (min après départ) + TTL billet
- **Incident en route** : palier compensation (suspend / cancel / major delay)
- **Colis** : TTL stockage hub avant retour automatique

> Règle d'or projet : **zéro magic number**. Tous ces seuils passent
> par `TenantBusinessConfig`, jamais hardcodés. Voir
> [WORKFLOWS.md](WORKFLOWS.md).

### b. Taxes — `/admin/settings/taxes`

CRUD de tes taxes (TVA, frais gare, timbres…). Appliquées au
checkout billet / colis / facture. Sans saisie → 0 %. **À remplir
avant la première vente** sinon tu devras re-facturer.

### c. Pricing rules par route — `/admin/settings/pricing`

Auto-créées à l'étape 4 du wizard, mais tu dois y passer pour :
- Ajouter les classes tarifaires (STANDARD / CONFORT / VIP)
- Configurer le prix bagage
- Régler les multiplicateurs saisonniers

---

## Étape 3 — Inviter l'équipe

**`/admin/iam/users`** → bouton « Inviter »

Flux : email + rôle → un compte est créé avec un password aléatoire,
un email reset est envoyé → l'invité clique le lien, définit son mot
de passe, et se connecte.

Rôles à inviter par priorité (cas MIXED) :

| Priorité | Rôle             | Pourquoi maintenant ?                               |
|----------|------------------|-----------------------------------------------------|
| 1        | `AGENCY_MANAGER` | Gère trajets/billets/colis sur l'agence             |
| 2        | `CASHIER`        | Ouvre la caisse et vend les 1ᵉʳˢ billets            |
| 3        | `DISPATCHER`     | Affecte véhicules/chauffeurs, planifie les trips    |
| 4        | `DRIVER`         | Profil conducteur, démarre trip, scan boarding      |

> **Sans SMTP configuré** (cas dev ou tenant sans fournisseur email) :
> l'invitation échoue silencieusement côté envoi. L'utilisateur est
> créé en DB, mais il ne reçoit pas le lien. Tu peux alors lui
> communiquer l'URL reset à la main via `/admin/iam/users`.

---

## Étape 4 — Créer ta première vraie offre

### TICKETING (voyageurs)

**Chaîne obligatoire** (chaque étape est un prérequis de la suivante) :

```
Agence ✓ (déjà là) → Station A → Station B → Route → Trip → Ticket
```

- **Routes** : `/flights/manage` (ou `/flights` en lecture)
- **Trajets** : `/planning` ou `/trips` — une fois la route créée
- **Vente** : `/counter/sales` côté caisse, ou portail public côté client

### PARCELS (colis)

**Chaîne obligatoire** :

```
Station destination ✓ → Shipment (groupage) → Parcel → Shipment LOAD → Trip
```

- **Dépôt** : `/parcels/register`
- **Suivi** : `/parcels/tracking`
- **Gestion** : `/parcels/manage`

---

## Étape 5 — Activer les intégrations (optionnel)

`/admin/integrations`. **Aucune n'est bloquante** pour démarrer.

| Intégration            | Type         | Impact si absente                                  |
|------------------------|--------------|-----------------------------------------------------|
| MTN / Airtel / Wave    | PAYMENT      | Encaissement cash/crédit uniquement, pas de mobile money |
| Stripe                 | PAYMENT      | Pas de CB                                           |
| Google / Microsoft OAuth | AUTH       | Login email + password uniquement                   |
| SMTP                   | NOTIFICATION | Pas d'invitations users, pas de reset password email |
| WhatsApp / SMS         | NOTIFICATION | Pas de notifs voyageurs, pas de retrait colis auto  |

Mode activation : `DISABLED → SANDBOX → LIVE`. Les secrets vont dans
Vault (path masqué dans l'UI). Healthcheck automatique sur chaque
provider. Détails : [INTEGRATIONS.md](INTEGRATIONS.md).

---

## Les 7 pièges « prérequis oublié » les plus fréquents

| Piège                                       | Symptôme                                              | Correction                                               |
|---------------------------------------------|-------------------------------------------------------|----------------------------------------------------------|
| Créer un Trip sans Route                    | `500 ForeignKeyError`                                 | Créer la route d'abord sur `/flights/manage`             |
| Vendre un Ticket sans Trip planifié         | Caisse affiche liste vide                             | `/planning` → créer un trip                              |
| Trip mode `NUMBERED` sans `bus.seatLayout`  | `400 BadRequest "plan de sièges manquant"`            | `/admin/fleet/{busId}/seats` avant                       |
| Caissier pas encore invité                  | Tu n'as personne pour ouvrir `/cashier/open`          | Inviter un CASHIER avant d'émettre                       |
| Caisse non ouverte                          | Transaction vente → erreur                            | `/cashier/open` côté caissier                            |
| Pas de `TenantBusinessConfig`               | Annulation/no-show utilisent les fallbacks legacy     | `/admin/settings/rules`                                  |
| Taxes non saisies                           | Tickets émis à 0 % TVA — impossible de régulariser    | `/admin/settings/taxes` **avant** la 1ʳᵉ vente           |

---

## Ordre optimal Jour 1 (15 à 30 min)

1. ✅ Finir le wizard d'onboarding (`/onboarding`)
2. ✅ `/admin/settings/rules` — `TenantBusinessConfig`
3. ✅ `/admin/settings/taxes` — ajouter TVA et frais applicables
4. ✅ `/admin/settings/pricing` — compléter les classes tarifaires
5. ✅ `/admin/iam/users` — inviter AGENCY_MANAGER, CASHIER, DISPATCHER
6. ⬜ (Optionnel) `/admin/integrations` — activer mobile money si pertinent
7. ✅ Faire une **vente test** de bout en bout :
   - Créer 1 trip sur ta route
   - `/counter/sales` → vendre 1 billet test
   - `/parcels/register` → déposer 1 colis test (si MIXED/PARCELS)
8. ⬜ (Optionnel) Flotte, chauffeurs, profils RH, campagnes CRM — semaines 2-4

Tout ce qui n'est pas numéroté en ✅ peut attendre. Les ✅ sont les
prérequis pour que ton tenant soit réellement exploitable.

---

## Routes admin — Cheat-sheet

| Zone              | Route                         | Rôle requis                  |
|-------------------|-------------------------------|------------------------------|
| Dashboard         | `/`                           | Tout rôle authentifié         |
| Onboarding        | `/onboarding`                 | TENANT_ADMIN                 |
| Règles métier     | `/admin/settings/rules`       | TENANT_ADMIN                 |
| Taxes             | `/admin/settings/taxes`       | TENANT_ADMIN                 |
| Pricing           | `/admin/settings/pricing`     | TENANT_ADMIN, AGENCY_MANAGER |
| Utilisateurs      | `/admin/iam/users`            | TENANT_ADMIN                 |
| Flotte            | `/admin/fleet`                | TENANT_ADMIN, DISPATCHER     |
| Intégrations      | `/admin/integrations`         | TENANT_ADMIN                 |
| Routes / lignes   | `/flights/manage`             | TENANT_ADMIN, AGENCY_MANAGER |
| Planning          | `/planning`                   | AGENCY_MANAGER, DISPATCHER   |
| Caisse            | `/counter/sales`, `/cashier/open` | CASHIER                  |
| Colis             | `/parcels/manage`             | AGENCY_MANAGER               |
| Flight deck       | `/flight-deck`                | DISPATCHER, AGENCY_MANAGER   |

---

## Pour aller plus loin

- [docs/WORKFLOWS.md](WORKFLOWS.md) — tous les workflows blueprint-driven (Trip, Ticket, Parcel…) avec états, actions, permissions
- [docs/INTEGRATIONS.md](INTEGRATIONS.md) — setup complet mobile money, OAuth, WhatsApp
- `CLAUDE.md` à la racine — règles projet (zéro magic number, i18n 8 locales, blueprint-driven, security first)
