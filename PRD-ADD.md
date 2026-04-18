**🏛️ 1. MODULE : CRM & EXPÉRIENCE CLIENT (360°)**

Ce module centralise l'intelligence "Client" et la gestion des litiges.

-   **Profil Client Enrichi :** Historique des trajets, préférences (siège, gares), cumul des bagages, et **indice de fidélité**.

-   **Gestion des Réclamations (Ticketing SAV) :**

    -   Ouverture automatique d'un ticket lors d'un signalement.

    -   Suivi du statut : OPEN → UNDER_INVESTIGATION → RESOLVED → CLOSED.

-   **Campagnes & Marketing :** Analyse de la pertinence des campagnes selon le taux de conversion et les retours clients.

---

**🛡️ 2. MODULE : SAFETY & FEEDBACK (TEMPS RÉEL & POST-TRIP)**

C'est ici que l'on traite la sécurité et la notation.

-   **Signalement Temps Réel (Panic/Alert Button) :**

    -   Depuis l'App Voyageur : Bouton "Signalement conduite dangereuse" (Vitesse, dépassement, franchissement de ligne).

    -   **Action :** Envoi immédiat d'un événement safety.alert via **NATS** vers le Dashboard Dispatch/Admin.

-   **Système de Notation (Aggregated Ratings) :**

    -   **Chauffeur :** Note calculée sur la moyenne pondérée (Conduite, Ponctualité, Comportement).

    -   **Bus :** État de propreté, confort, clim, pannes rencontrées.

    -   **Agence/Gare :** Accueil, temps d'attente, gestion des bagages.

    -   **Colis :** Qualité de l'emballage, état à la livraison, attitude de l'agent.

---

**🛰️ 3. MODULE : IN-BUS DISPLAY (SMART BUS)**

Interface visuelle pour les passagers.

-   **Jauge de Progression :** Affichage de la position actuelle entre la gare A et B récupérée via le Tracking Service.

-   **Status du Trip :** ETA (Heure d'arrivée estimée), météo à destination, prochaines gares.

-   **Interaction :** QR Code affiché sur l'écran pour permettre au voyageur de noter le trajet en direct ou signaler un problème.

---

**👨‍✈️ 4. MODULE : OPÉRATIONS RH & ÉQUIPAGE (CREW)**

Amélioration de la préparation terrain.

-   **Crew Assignment :** Le chauffeur voit dans son App son équipage (Hôtesse, Co-pilote, Agent de sécurité).

-   **Module "Pre-Trip Meeting" :** Espace collaboratif digital ou checklist partagée pour valider que l'équipage s'est briefé avant l'ouverture du BOARDING.

-   **Checklist Chauffeur ++ :** Ajout de champs de remarques libres et structurés pour signaler des anomalies non bloquantes (ex: bruit suspect, clim faible).

---

**📊 5. MODULE : ANALYTICS & BI (DASHBOARD EXÉCUTIF)**

Le cerveau stratégique pour le "Tenant".

-   **Performance Financière :** Ligne la plus rentable, taux de remplissage moyen, revenus colis vs passagers.

-   **Performance Opérationnelle :** Gares les plus ponctuelles, bus ayant le plus de problèmes mécaniques récurrents.

-   **Classement Qualité :** Top/Bottom 10 des chauffeurs et des agences selon les avis CRM.

-   **Analyse Logistique :** Taux de perte/dégradation des colis, délais de livraison moyens.

---

**🔐 6. NOUVELLES PERMISSIONS GRANULAIRES**

| **Module**    | **Permission**                  | **Action**                                                    |
|---------------|---------------------------------|---------------------------------------------------------------|
| **CRM**       | data.crm.read.tenant            | Voir le profil complet et les préférences d'un client.        |
| **CRM**       | control.campaign.manage.tenant  | Créer et analyser des campagnes de satisfaction.              |
| **Feedback**  | data.feedback.submit.own        | (Voyageur) Soumettre une note ou un signalement.              |
| **Safety**    | control.safety.monitor.global   | (Dispatch) Voir les alertes de conduite dangereuse en temps réel. |
| **Stats**     | control.stats.read.tenant       | Accéder aux rapports de rentabilité et performances.          |
| **Crew**      | data.crew.manage.tenant         | Assigner l'équipage aux trajets.                              |

---

**🔄 7. MISE À JOUR DU WORKFLOW ENGINE (ÉVÉNEMENTS)**

Pour ne rien casser, chaque avis ou signalement est un **Side-Effect** du Workflow :

1.  **Event :** trip.completed

2.  **Action Automatique :** Le système envoie une notification Push au Voyageur : *"Comment s'est passé votre voyage ?"*.

3.  **Transition de Réclamation :** Si Note \< 2/5 → Passage automatique en état CLAIM_PENDING dans le module CRM pour traitement prioritaire.

---

**📺 1. AFFICHAGE PUBLIC (DISPLAY TYPE AÉROPORT)**

Le module d'affichage doit être dynamique et lié en temps réel au moteur de workflow.

-   **Champ Display_Note :** Ajout d'un champ texte court et d'un code couleur sur l'entité Trip.

    -   *Exemple :* "Retard de 25 min --- départ prévu 07:25" (Couleur : Ambre).

-   **Calcul Automatique :** Si l'action START_TRIP n'est pas déclenchée à Heure_Prevue + 5 min, le statut passe automatiquement en "Retard" sur les écrans.

---

**🚨 2. SIGNALEMENT CITOYEN & SÉCURITÉ (PUBLIC REPORTER)**

Ouverture du système aux usagers hors-application.

-   **Portail Public (Web léger / QR Code sur les bus) :**

    -   Possibilité de signaler un véhicule via son **immatriculation** ou **numéro de parc**.

    -   **Types de signalements :** Conduite dangereuse, véhicule accidenté, panne sur voie publique.

-   **Validation Géo-Temporelle (Anti-Fraude) :**

    -   Lorsqu'un signalement arrive, le système compare les **coordonnées GPS du déclarant** (navigateur) et l'heure avec les **données GPS du bus** à cet instant.

    -   Si corrélation \> 90% (proximité physique), le signalement est marqué comme "Vérifié" et envoyé en priorité au Dispatch.

---

**⏱️ 3. GESTION DES DÉLAIS ET ANNULATIONS (DROITS OPÉRATIONNELS)**

Le contrôle du temps doit être décentralisé pour coller à la réalité du terrain.

-   **Permissions de Modification de Planning :**

    -   control.trip.delay.agency : Permet à l'agent ou au chauffeur d'injecter un délai (ex: panne au départ).

    -   control.trip.cancel.tenant : Droit de vie ou de mort sur un trajet (Annulation avec notification automatique aux voyageurs).

-   **Validation du "Départ Effectif" (Double Check) :**

    -   L'action DEPART est logguée par l'agent ou le chauffeur.

    -   **Fencing GPS :** Le système vérifie que le bus a effectivement quitté le rayon de la gare (ex: 200m). Si le bus est déclaré "Parti" mais que le GPS le situe toujours au quai après 10 min, une alerte "Suspicion de Fraude / Anomalie" est levée.

---

**🛣️ 4. SUIVI DE ROUTE AVANCÉ (PAUSES & WAYPOINTS)**

Le plan de route devient un journal de bord vivant.

-   **Journal des Pauses :**

    -   Boutons START_PAUSE / END_PAUSE (Motifs : Pipi, Repas, Imprévu, Contrôle Police).

    -   Mesure de la durée réelle vs durée prévue pour alimenter les stats de performance.

-   **Recalage Automatique via Points de Passage (Checkpoints) :**

    -   Le système définit des zones GPS sur les villes étapes.

    -   Dès que le bus entre dans la zone d'une ville étape, l'état du trajet est mis à jour : *"Arrivé à [Ville] à 10:15 (Avance de 5 min)"*.

    -   Cela permet de recalculer l'ETA pour les gares suivantes sans intervention humaine.

---

**📈 5. INDICATEURS DE PONCTUALITÉ (KPIs)**

Ces données alimentent le module Stats pour générer les scores suivants :

1.  **Indice de Ponctualité Chauffeur (IPC) :** Écart moyen entre le plan de route et la réalité (hors imprévus validés).

2.  **Efficacité Agence (Gare) :** Temps moyen entre le "Boarding" et le "Départ Effectif".

3.  **Taux de Disponibilité Flotte :** Temps d'immobilisation pour pannes (signalées par chauffeur ou public).

---

**🚀 MISE À JOUR TECHNIQUE DU PRD**

**Nouvelles Tables/Entités :**

-   TripEvent : Logue chaque pause, retard, et checkpoint GPS.

-   PublicReport : Stocke les signalements externes avec metadata (GPS, Immatriculation).

**Permissions à ajouter :**

-   control.trip.log_event.own : Permet au chauffeur d'enregistrer ses pauses.

-   data.display.update.agency : Droit de modifier les remarques sur les écrans d'affichage de la gare.

---

**🚀 PROMPT DE MISE À JOUR (POUR CLAUDE/CURSOR)**

"Ajoute au projet le module **CRM & Analytics**.

1.  Implémente une table Feedback liée aux User, Trip, Bus et Staff.

2.  Crée un service d'agrégation qui calcule la note moyenne des chauffeurs en temps réel.

3.  Ajoute un endpoint POST /safety/report protégé par la permission data.feedback.submit.own qui émet un événement prioritaire sur **NATS** en cas de conduite dangereuse.

4.  Développe le module **StatisticsService** qui effectue des jointures complexes pour ressortir la rentabilité par ligne et par gare, ainsi que l'état de santé de la flotte (Mechanical issues count)."

---

## 💳 MODULE : PAIEMENT & FACTURATION MULTI-PROVIDER

Architecture hexagonale : le code métier ne dépend que de `PaymentOrchestrator`. Ajouter ou retirer un provider se fait en déposant un fichier dans `src/infrastructure/payment/providers/` et en le branchant dans `PaymentModule` — **zéro autre modification**.

### Domaine canonique
- `PaymentIntent` (1 par achat) — idempotent par `(tenantId, idempotencyKey)`.
- `PaymentAttempt` (N) — chaque tentative provider, payload chiffré AES-256-GCM.
- `PaymentEvent` (N, append-only) — journal audit immuable.
- `PaymentProviderState` — toggle DISABLED / SANDBOX / LIVE par (tenant, provider). Activation LIVE requiert MFA step-up.
- `TenantTax` — taxes empilables (TVA, timbre, taxe gare...), cascade `SUBTOTAL` ou `TOTAL_AFTER_PREVIOUS`, scoping `appliesTo`, versioning `validFrom/validTo`.
- `TenantPaymentConfig` — TOUTES les constantes paiement par tenant (aucun magic number côté code).
- `PlatformPaymentConfig` — singleton plateforme.

### Providers livrés
| Key | Méthodes | Pays | Sandbox | Live |
|---|---|---|---|---|
| `mtn_momo_cg` | MoMo push | CG | ✅ | toggle via UI |
| `airtel_cg` | MoMo push | CG | ✅ | toggle via UI |
| `wave` | Wave Business | SN/CI/ML/BF | ✅ | toggle via UI |
| `flutterwave_agg` | MoMo + Card + USSD + Transfer | 11 pays | ✅ | toggle via UI |
| `paystack_agg` | Card + MoMo | NG/GH/KE/ZA | ✅ | toggle via UI |
| `stripe_cards` | Card hosted | FR/UE/US/CA/UK | câblé, non activable en Afrique | — |

### Webhooks
- Endpoint unique `POST /webhooks/payments/:providerKey`.
- Raw-body HMAC temps constant, throttle 60/min/IP.
- Réponse 200 après vérification pour éviter retries agressifs — orphans rattrapés par la réconciliation cron (10 min).

### UI Intégrations API
- Page unifiée `/integrations` : paiement + OAuth + (futur) SMS/email/storage.
- Par provider : état effectif (DISABLED/SANDBOX/LIVE), healthcheck temps réel, empreinte du path Vault, date de dernière rotation.
- **Aucune valeur de secret exposée** — seulement des indications "configuré ✓ / manquant ⚠".
- Passage LIVE nécessite `mfaVerified=true` + permission `control.integration.setup.tenant`.

### Frontend réutilisable
- `PaymentMethodPicker` : radio-cards par type, WCAG AA, 8 locales, dark/light.
- `PaymentFlowDialog` : parcours complet (méthode → détails → processing → success/error).
- `usePaymentIntent` : hook polling /confirm avec timeout 5 min.

### Flux CRUD taxes
`/tenants/:id/settings/taxes` — TenantTax CRUD via `DataTableMaster`-friendly tableau.
Le `TaxCalculatorService` consomme la liste filtrée/triée pour chaque Intent — la décomposition fiscale est figée dans `PaymentIntent.taxBreakdown` pour audit.

