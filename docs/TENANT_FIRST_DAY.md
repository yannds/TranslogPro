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

### Identité & IAM
| Élément                 | Détail                                                |
|-------------------------|-------------------------------------------------------|
| **Agence par défaut**   | « Siège » / « Headquarters » — invariant ≥ 1 agence   |
| **TENANT_ADMIN user**   | Toi, avec le couple email/password du wizard          |
| **Rôles système**       | `TENANT_ADMIN`, `AGENCY_MANAGER`, `CASHIER`, `ACCOUNTANT`, `DRIVER`, `DISPATCHER`, `MECHANIC` (~150 permissions mappées) |
| **Devise / locale / timezone** | Dérivés du pays choisi au wizard               |
| **Plan + trial 30 j**   | Abonnement actif, tous les modules du plan débloqués  |

### Workflows & Documents
| Élément                 | Détail                                                |
|-------------------------|-------------------------------------------------------|
| **WorkflowConfigs**     | ~25 blueprints (`DEFAULT_WORKFLOW_CONFIGS`) — Trip, Ticket, Parcel, Invoice, Staff, Voucher, Refund, Incident, MaintenanceReport, Claim, CashRegister, DriverTraining, QhseExecution… |
| **Templates documents** | Pack de démarrage dupliqué : billet A5, facture A4, manifeste, étiquette colis, ticket stub, invoice pro, envelope, baggage tag |
| **Types doc véhicule**  | Assurance, Carte grise, Visite technique, …           |

### Configuration métier (TenantBusinessConfig, ~30 champs)
Tu peux affiner via `/admin/settings/rules` — **mais tout est déjà rempli
avec des defaults raisonnables** :
- Proratisation (365 j/an, 30 trips/mois)
- Break-even ±5 %, commission agence 3 %
- Annulation 24h/2h + N-paliers, no-show grâce 15 min TTL 48h
- Compensation incident (désactivée par défaut), parcel hub 7 j
- Scoring conducteur (pondérations 50/30/20, fenêtre 30 j)
- Seuils dashboard anomalies, trajets intermédiaires activés

### 🆕 Pricing (Sprints S1-S5 — 2026-04-20)
| Élément                       | Détail                                                |
|-------------------------------|-------------------------------------------------------|
| **TVA seedée, désactivée**    | Code `TVA`, taux 18,9 %, `appliedToPrice=false` — l'admin active d'un clic s'il est assujetti (marché Afrique centrale) |
| **Classes de voyage × 4**     | STANDARD ×1.0, CONFORT ×1.4, VIP ×2.0, STANDING ×0.8 — éditables, non supprimables (`isSystemDefault=true`) |
| **Calendrier saisonnier**     | ~28 lignes selon ton pays : Noël +40 %, Nouvel An +30 %, Pâques +15 %, creux janvier −15 %, fêtes nationales, grandes vacances scolaires (CG/SN/CI/FR seedés) |
| **Yield Engine actif**        | `InstalledModule(YIELD_ENGINE, isActive=true)` — 5 règles en cascade (PEAK_PERIOD > GOLDEN_DAY > BLACK_ROUTE > LOW_FILL > HIGH_FILL), bornes [×0.7, ×2.0]. Désactivable via `/admin/modules` si tu ne le veux pas. |

### Sécurité
| Élément                 | Détail                                                |
|-------------------------|-------------------------------------------------------|
| **Clé HMAC Vault**      | `tenants/:id/hmac` — signatures webhooks paiement     |
| **RLS Postgres actif**  | isolation par `tenantId` au niveau DB                 |

Tu ne vois donc jamais un écran « créez d'abord une agence / un rôle /
une classe de voyage / une TVA ».

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

## Étape 2 — Vérifier/affiner 5 configs tenant (facultatif — tout est pré-rempli)

Accès : **`/admin/settings`** (TENANT_ADMIN).

> 💡 **Changement majeur post-Sprint S1-S5** : ton tenant démarre avec
> un pipeline tarifaire complet opérationnel (TVA saisie, classes de
> voyage × 4, calendrier peak periods selon ton pays, yield engine actif).
> Tu **peux** affiner, mais tu **peux aussi** vendre immédiatement.

### a. Règles métier — `/admin/settings/rules`

Tous les champs sont pré-remplis avec les defaults projet. Ajuste si besoin :

- **Annulation** : N-paliers `{ hoursBeforeDeparture, penaltyPct }` (JSON)
- **No-show** : délai de grâce (min après départ) + TTL billet
- **Incident en route** : paliers compensation (suspend / cancel / major delay)
- **Colis** : TTL stockage hub avant retour automatique
- **Scoring conducteur** : poids ponctualité/incidents/volume

> Règle d'or projet : **zéro magic number**. Tous ces seuils passent
> par `TenantBusinessConfig`, jamais hardcodés. Voir
> [WORKFLOWS.md](WORKFLOWS.md).

### b. Taxes — `/admin/settings/taxes`

La **TVA est déjà saisie** (18,9 %) mais **désactivée par défaut**
(cohérent marché Afrique centrale où beaucoup de transporteurs ne
sont pas assujettis).

Pour activer la TVA sur toutes les ventes :
1. Éditer la ligne `TVA` → ✅ cocher **« Appliquée au prix facturé »**
2. Sauver

Tu peux aussi ajouter d'autres taxes (timbre fiscal, taxe gare, taxe
municipale…) avec cascade ou non, appliesTo par type d'entité, et
2 flags séparés : *appliquée au prix* et *prise en compte par le
simulateur de rentabilité*.

> 🔎 **Affichage pédagogique caisse** : les taxes définies mais non
> appliquées apparaissent en italique barré dans le détail vente avec
> mention « serait X XOF » — le caissier voit ce qu'il n'applique pas,
> sans que ça change le total facturé.

### c. Classes de voyage — `/admin/settings/fare-classes` (🆕 Sprint S1)

4 classes déjà seedées (STANDARD, CONFORT, VIP, STANDING, avec
multipliers 1.0 / 1.4 / 2.0 / 0.8). Tu peux :
- Ajuster les **multipliers** (ex: CONFORT ×1.3 chez toi)
- Changer la **couleur** (badges UI / seatmap)
- **Ajouter tes propres classes** (ex: BUSINESS ×1.8 pour un tenant
  plus premium)
- **Désactiver une classe** (mais pas la supprimer si `isSystemDefault`)

Les classes actives sont proposées automatiquement à la caisse
(`PageSellTicket`) et sur le portail voyageur.

### d. Périodes peak (calendrier yield) — `/admin/settings/peak-periods` (🆕 Sprint S5)

Calendrier saisonnier pré-rempli pour ton pays (~28 lignes sur 2 ans).
Déclenche la **5ème règle yield PEAK_PERIOD** avec priorité maximale :
un événement calendrier prime sur la réaction fillRate.

Tu peux :
- **Ajuster les facteurs** (ex: Noël ×1.6 au lieu de ×1.4)
- **Ajouter une période custom** (ex: festival local du 15 au 22 août ×1.3)
- **Ajouter une période creux** (factor < 1, ex: reprise après fêtes ×0.8)
- **Désactiver le creux de janvier** si ton business ne le subit pas

### e. Pricing rules par route — `/admin/settings/pricing` + overrides par ligne

Auto-créées à l'étape 4 du wizard (prix de base + péages tenant + franchise
bagage tenant). Tu peux aussi **surcharger au niveau d'une ligne précise**
via `Route.pricingOverrides` (🆕 Sprint S2) :

- Override de taxe par code (ex: TVA 20 % sur la ligne internationale)
- Override de péages (ex: ligne urbaine sans péages → 0)
- Override franchise bagages (ex: ligne longue → 30 kg au lieu de 20)
- Restreindre les classes vendues (ex: uniquement STANDARD sur la ligne milk-run)

Dans la fiche ligne (édition), tu as aussi le 🆕 **simulateur de
rentabilité live** (Sprint S3) : sélectionne un bus + prix cible →
tableau marge nette à 50/70/90 % occupation + recommandation prix
break-even.

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
| Pas de `TenantBusinessConfig`               | ~~Annulation/no-show utilisent les fallbacks legacy~~ **Résolu S1** : TenantBusinessConfig seedé automatiquement avec defaults | vérifier quand même `/admin/settings/rules` |
| TVA non activée alors qu'on est assujetti   | Factures émises sans TVA — impossible de régulariser  | `/admin/settings/taxes` → cocher « Appliquée au prix » sur la ligne TVA **avant** la 1ʳᵉ vente |
| Bus sans `BusCostProfile`                   | Le simulateur de rentabilité (fiche ligne) répond « profil manquant » | `/admin/fleet/{busId}/cost-profile` avant de simuler |
| YIELD_ENGINE désactivé par erreur           | Plus de règles dynamiques (PEAK, GOLDEN_DAY…), retour à prix fixe | `/admin/modules` → activer YIELD_ENGINE |

---

## Ordre optimal Jour 1 (10 à 20 min — raccourci post-S1-S5)

1. ✅ Finir le wizard d'onboarding (`/onboarding`)
2. ⬜ (Facultatif) `/admin/settings/rules` — ajuster les defaults
3. ⬜ **Décider si tu es assujetti TVA** :
   - Si oui → `/admin/settings/taxes` → activer la ligne TVA
   - Si non → laisser en l'état (déjà désactivée par défaut)
4. ⬜ (Facultatif) `/admin/settings/fare-classes` — renommer ou ajouter tes classes
5. ⬜ (Facultatif) `/admin/settings/peak-periods` — affiner les facteurs de ton calendrier
6. ✅ `/admin/iam/users` — inviter AGENCY_MANAGER, CASHIER, DISPATCHER
7. ✅ Créer tes bus + **renseigner `BusCostProfile`** (sinon le simulateur ne marche pas)
8. ⬜ (Optionnel) `/admin/integrations` — activer mobile money si pertinent
9. ✅ Faire une **vente test** de bout en bout :
   - Créer 1 trip sur ta route
   - `/counter/sales` → vendre 1 billet test
   - `/parcels/register` → déposer 1 colis test (si MIXED/PARCELS)
10. ⬜ (Optionnel) Flotte, chauffeurs, profils RH, campagnes CRM — semaines 2-4

Tout ce qui n'est pas numéroté en ✅ peut attendre. Les ✅ sont les
prérequis pour que ton tenant soit réellement exploitable — les ⬜
sont des **affinages** puisque les defaults S1-S5 sont déjà en place.

---

## Routes admin — Cheat-sheet

| Zone              | Route                               | Permission requise              |
|-------------------|-------------------------------------|---------------------------------|
| Dashboard         | `/`                                 | Tout rôle authentifié            |
| Onboarding        | `/onboarding`                       | `control.tenant.manage.tenant`  |
| Règles métier     | `/admin/settings/rules`             | TENANT_ADMIN                    |
| Taxes             | `/admin/settings/taxes`             | `data.tax.read.tenant` / `control.tax.manage.tenant` |
| Classes voyage 🆕 | `/admin/settings/fare-classes`      | `data.fareClass.read.tenant` / `control.fareClass.manage.tenant` |
| Peak periods 🆕   | `/admin/settings/peak-periods`      | `data.peakPeriod.read.tenant` / `control.peakPeriod.manage.tenant` |
| Saisonnalité 🆕   | `/admin/analytics/seasonality`      | `data.stats.read.tenant`        |
| Pricing grid      | `/admin/settings/pricing`           | TENANT_ADMIN, AGENCY_MANAGER    |
| Modules SaaS      | `/admin/modules`                    | `control.module.install.tenant` |
| Utilisateurs      | `/admin/iam/users`                  | TENANT_ADMIN                    |
| Flotte            | `/admin/fleet`                      | TENANT_ADMIN, DISPATCHER        |
| Bus cost profile  | `/admin/fleet/{busId}/cost-profile` | `control.pricing.manage.tenant` |
| Intégrations      | `/admin/integrations`               | TENANT_ADMIN                    |
| Routes / lignes   | `/flights/manage`                   | TENANT_ADMIN, AGENCY_MANAGER    |
| Planning          | `/planning`                         | AGENCY_MANAGER, DISPATCHER      |
| Caisse            | `/counter/sales`, `/cashier/open`   | CASHIER                         |
| Colis             | `/parcels/manage`                   | AGENCY_MANAGER                  |
| Flight deck       | `/flight-deck`                      | DISPATCHER, AGENCY_MANAGER      |

---

## Pour aller plus loin

- [docs/WORKFLOWS.md](WORKFLOWS.md) — tous les workflows blueprint-driven (Trip, Ticket, Parcel…) avec états, actions, permissions
- [docs/INTEGRATIONS.md](INTEGRATIONS.md) — setup complet mobile money, OAuth, WhatsApp
- `CLAUDE.md` à la racine — règles projet (zéro magic number, i18n 8 locales, blueprint-driven, security first)
