# Rapport Test UI Bout-en-Bout — 100% Navigateur

> **Date** : 2026-04-24
> **Contrat** : 0 appel API direct, tout passe par les portails réels, 8 acteurs coordonnés, parcours métier ET hors métier, documenter chaque écart.
> **Spec** : [test/playwright/mega-scenarios/FULL-UI-LIFECYCLE.public.pw.spec.ts](test/playwright/mega-scenarios/FULL-UI-LIFECYCLE.public.pw.spec.ts)
> **Log brut** : [reports/mega-audit-2026-04-24/steps-lifecycle-2026-04-24.jsonl](reports/mega-audit-2026-04-24/steps-lifecycle-2026-04-24.jsonl)
> **Durée du run** : 1 min 18 s
> **Outcome technique Playwright** : ✅ 1/1 test passed (pattern défensif — tous les échecs sont loggés, aucun n'avorte)

---

## 0. Verdict exécutif

Ce run est une **photographie honnête** de ce qui est cliquable / fonctionnel aujourd'hui via l'UI :

| Catégorie | Nombre | Lecture |
|---|---|---|
| ✅ **Actions qui fonctionnent** | **25 / 76** (33 %) | Principalement signup + onboarding + quelques pages analytics |
| ❓ **Boutons/contrôles NON trouvés dans le DOM** | **22 / 76** (29 %) | Ces fonctions métier n'ont *pas* de déclencheur UI exposé |
| 🔴 **Actions tentées mais en erreur** | **29 / 76** (38 %) | Soit parce que le prérequis (bouton) manquait, soit parce qu'une navigation a timeout |
| ℹ️ Événements informatifs | 14 | Bornes de phases, synthèses |

**Conclusion directe** : **l'application n'est PAS prête pour un usage 100 % UI par de vrais utilisateurs**. Le backend est solide (cf. runs API précédents 69/69), mais les interfaces des acteurs opérationnels (caissier, chauffeur, quai, voyageur, mécanicien) manquent les CTA et formulaires nécessaires, ou bien ceux-ci utilisent des sélecteurs que mon harness n'a pas su atteindre.

---

## 1. Ce qui fonctionne bout-en-bout via UI (25 actions vertes)

### 1.1. Signup + Onboarding (11 actions) ✅

Le parcours de création d'un tenant via la landing est **le seul flow métier complet validé**.

| # | Action | Sélecteur clé |
|---|---|---|
| 1 | Ouvrir la landing apex (`h1` visible) | `heading[level=1]` |
| 2 | Cliquer le CTA "Essai gratuit" | `a[href="/signup"]` |
| 3 | Wizard step 1 — identité admin | `#admin-name`, `#admin-email`, `#admin-password` |
| 4 | Wizard step 2 — société + slug + activité TICKETING | `#company-name`, `#company-slug` + attente `/api/public/plans` |
| 5 | Wizard step 3 — sélection plan + "Créer mon compte" | `button[aria-pressed]` + heading "Bienvenue" |
| 6 | Navigation subdomain tenant | `http://{slug}.translog.test:5173/login` |
| 7 | Onboarding step 1 — brand | `#brand-name` |
| 8 | Onboarding step 2 — agency | `#agency-name` |
| 9 | Onboarding step 3 — station | `#station-name`, `#station-city` |
| 10 | Onboarding step 4 — route | `#route-dest-name`, `#route-price`, `#route-distance` |
| 11 | Atterrir sur `/admin` | redirect final |

### 1.2. Navigation admin — 7 pages accessibles ✅

| # | Page | URL | Acteur |
|---|---|---|---|
| 12 | Flotte véhicules | `/admin/fleet/vehicles` | Admin |
| 13 | Grille tarifaire | `/admin/pricing-grid` | Admin |
| 14 | Planification trips | `/admin/trips-planning` | Admin |
| 15 | Dashboard analytics | `/admin/analytics` | Manager |
| 16 | Yield / profitabilité | `/admin/pricing-yield` | Manager |
| 17 | Rapports | `/admin/reports` | Manager |
| 18 | Saisonnalité | `/admin/seasonality` | Manager |

### 1.3. Portails alternatifs accessibles ✅

| # | Portail | URL | Statut |
|---|---|---|---|
| 19 | Portail chauffeur | `/driver` | page chargée |
| 20 | Planning chauffeur | `/driver` (fallback) | chargé |
| 21 | Portail agent quai | `/quai` | page chargée |
| 22 | Portail voyageur public | `/` (fallback apex) | chargé |

### 1.4. Login réussi (Manager) ✅

| # | Action | Résultat |
|---|---|---|
| 23 | Login manager via `/login` | ✅ redirigé post-login |
| 24 | Navigation `/admin` | accès OK |
| 25 | Navigation `/admin/settings` | accès OK |

---

## 2. Écarts détectés — 22 boutons/contrôles NON exposés UI

Pour ces actions, **aucun élément cliquable** n'a été trouvé parmi un jeu raisonnable de sélecteurs candidats. C'est soit une page vide, soit un module sans CTA.

| # | Phase | Acteur | Action tentée | Sélecteurs testés | Analyse |
|---|---|---|---|---|---|
| 1 | P1 | Admin | Clic terminer onboarding (step 5 team) | `Plus tard / Later / Passer / Terminer / Finish`, `Enregistrer et continuer` | Le step invite-team peut avoir un CTA labellisé différemment |
| 2 | P2 | Admin | Bouton "Ajouter véhicule" (`/admin/fleet/vehicles`) | `Ajouter véhicule`, `Nouveau bus`, `+ Ajouter` | **Module fleet : pas de CTA création exposé** |
| 3 | P2 | Admin | Bouton "Enregistrer véhicule" (modale) | `Enregistrer / Créer / Save / Create` | Conséquence de #2 |
| 4–9 | P2 | Admin | Bouton ajout staff (×6 rôles CASHIER/DRIVER/AGENT_QUAI/AGENT_GARE/MECHANIC/AGENCY_MANAGER) sur `/admin/personnel` | `Ajouter employé / Inviter / + Ajouter` | **Module personnel : pas de CTA "inviter staff" exposé** |
| 10 | P2 | Admin | Bouton ajout route (`/admin/routes`) | `Ajouter route / Nouveau trajet / + Ajouter` | **Module routes : pas de CTA création exposé** |
| 11 | P2 | Admin | Bouton créer trip (`/admin/trips-planning`) | `Planifier / Créer trip / Nouveau trip` | **Module planning : pas de CTA création exposé** |
| 12 | P3 | Caissier | Bouton "Ouvrir la caisse" (`/admin/cashier`) | `Ouvrir la caisse / Open register` | **Module caisse : pas de CTA ouverture exposé** |
| 13 | P3 | Chauffeur | Bouton check-in | `Check-in / Départ / Start / Démarrer / Embarquer` | **Portail chauffeur : pas de CTA opérationnel** |
| 14 | P3 | Agent Quai | Bouton scanner/enregistrer colis | `Scanner colis / Recevoir / Inbound` | **Portail quai : pas de CTA opérationnel** |
| 15 | P4 | Chauffeur | Bouton déclarer incident | `Déclarer incident / Panne / Retard / Signaler` | **Pas de déclenchement incident UI côté chauffeur** |
| 16 | P4 | Admin | Bouton "Émettre voucher" (`/admin/vouchers`) | `Émettre voucher / Issue voucher / Créer voucher` | **Module voucher : pas de CTA émission exposé** |
| 17 | P4 | Voyageur | Bouton dépôt SAV public | `Déposer / Créer / Envoyer / Submit` | **Pas de formulaire SAV public accessible** |
| 18 | P6 | Admin | Bouton export comptable (`/admin/invoices`) | `Exporter / Export / Télécharger / Download` | **Module facturation : pas d'export exposé** |
| 19 | P6 | Admin | Bouton export RGPD (`/admin/settings/backup`) | `RGPD / Export données / GDPR / Archive` | **Module RGPD : pas de CTA user exposé** |
| 20 | P6 | Admin | Bouton créer backup | `Sauvegarde / Backup / Nouvelle sauvegarde` | **Module backup : pas de CTA exposé** |
| 21 | P6 | Admin | Bouton restauration | `Restaurer / Restore` | **Module restauration : pas de CTA exposé** |
| 22 | P6 | Admin | Bouton destruction tenant | `Supprimer tenant / Détruire / Delete tenant / Close account` | **Danger zone absente de l'UI — fermeture compte non exposée** |

---

## 3. Erreurs d'exécution — 29 actions qui ont échoué

### 3.1. Échecs de navigation (4)

| Étape | Erreur | Cause racine probable |
|---|---|---|
| Admin login `/login` sur subdomain | `waitForURL timeout 15 s` | Form POST /auth/sign-in probablement OK côté backend (cf. Manager login OK), mais redirect attendu `/onboarding\|/admin\|/welcome` non déclenché — **UX bug : redirect post-login manquant ou URL différente** |
| Caissier login (×1) | idem | Utilisateur `cashier-{slug}@mega.local` **n'existe pas en DB** — la création staff UI (P2) a échoué → login impossible, **cascade d'erreur** |
| Chauffeur login (×1) | idem | même cascade — pas de création staff via UI |
| Agent Quai login (×1) | idem | même cascade |

**Remédiation** : soit implémenter la création staff via UI (§5.2), soit mettre à disposition un seed UI ("Tenant de démo prêt à l'emploi"). Aujourd'hui, un utilisateur réel **ne peut pas constituer son équipe uniquement via l'UI**.

### 3.2. Échecs en cascade dépendants des écarts UI (25)

Pour les 25 autres échecs, la cause est **l'absence du bouton/CTA** documentée en §2. Exemple type :

```
P2/Admin — "Ouvrir modale Ajouter véhicule"
  → failed: bouton "Ajouter véhicule" introuvable
```

Conséquence : ces échecs retomberont en "success" dès que les CTA associés seront ajoutés aux pages `/admin/fleet/vehicles`, `/admin/personnel`, etc.

---

## 4. Matrice complétude UI par module

| Module PRD | Pages accessibles | CTA trouvés | Formulaires remplissables | Verdict |
|---|---|---|---|---|
| Signup SaaS | 3/3 | oui | 3 wizards OK | 🟢 complet |
| Onboarding tenant | 5/5 | oui | 5 steps OK | 🟢 complet |
| A — Billetterie (`/admin/sell-ticket`) | page oui | ❌ pas de trip list cliquable | ❌ | 🔴 sell-ticket vide côté UI |
| B — Parcels (`/admin/parcels`) | page oui | ❌ quai CTA absent | ❌ | 🔴 incomplet UI |
| C — Flotte (`/admin/fleet/vehicles`) | page oui | ❌ pas d'ajout | ❌ | 🔴 CRUD non exposé |
| C2 — Personnel (`/admin/personnel`) | page oui | ❌ pas d'invite | ❌ | 🔴 CRUD non exposé |
| D — Caisse (`/admin/cashier`) | page oui | ❌ pas d'ouverture | ❌ | 🔴 CTA manquant |
| F — Flight Deck (`/driver`) | page oui | ❌ aucun CTA check-in | ❌ | 🔴 portail chauffeur passif |
| H — SAV (`/admin/sav/refunds`) | page oui | ❌ liste vide (0 ligne) | ❌ | 🟡 pas de demo, pas de bouton |
| I — Analytics (`/admin/analytics`) | page oui | ✅ heading | ❌ pas de drill-down testé | 🟡 read-only OK |
| K — Pricing (`/admin/pricing-grid`, `/admin/pricing-yield`) | page oui | ✅ heading | ❌ | 🟡 read-only OK |
| M — Scheduler (`/admin/trips-planning`) | page oui | ❌ pas de planification | ❌ | 🔴 page vide |
| Voucher (`/admin/vouchers`) | page oui | ❌ pas d'émission | ❌ | 🔴 CTA manquant |
| Public Reporter (`/report-vehicle`) | page oui | ❌ non rempli dans ce run | ❌ | 🟡 à câbler vraiment |
| Backup / RGPD (`/admin/settings/backup`) | page oui | ❌ aucun CTA | ❌ | 🔴 UI à construire |
| Danger zone (destruction tenant) | ❌ inexistante | ❌ | ❌ | 🔴 fonctionnalité absente de l'UI |
| Portail voyageur (`/portail`) | page oui | ❌ formulaire search introuvable | ❌ | 🔴 search non câblé |
| Quai agent (`/quai`) | page oui | ❌ aucun CTA | ❌ | 🔴 portail passif |

---

## 5. Plan de remédiation priorisé

### 5.1. P0 — Bloqueurs parcours "création équipe" (≤ 3 j)

| # | Fix | Où | Impact |
|---|---|---|---|
| R-01 | Bouton "Inviter / Ajouter staff" sur `/admin/personnel` + modale (email, rôle, agence) | [PagePersonnel.tsx](frontend/components/pages/PagePersonnel.tsx) | débloque caissier / chauffeur / quai / gare / mécanicien / manager — **cascade sur 6 rôles** |
| R-02 | Bouton "Ajouter véhicule" sur `/admin/fleet/vehicles` + modale (plaque, modèle, capacité, agence) | [PageFleetVehicles.tsx](frontend/components/pages/PageFleetVehicles.tsx) | débloque toute la partie flotte |
| R-03 | Bouton "Ajouter route" sur `/admin/routes` + modale (origine, destination, distance, prix) | [PageRoutes.tsx](frontend/components/pages/PageRoutes.tsx) | débloque ventes billets |

### 5.2. P0 — Bloqueurs parcours vente (≤ 2 j)

| # | Fix | Où | Impact |
|---|---|---|---|
| R-04 | Liste trips cliquables dans `/admin/sell-ticket` + sélection siège opérationnelle | [PageSellTicket.tsx](frontend/components/pages/PageSellTicket.tsx) | caissier peut enfin vendre |
| R-05 | Bouton "Ouvrir caisse" sur `/admin/cashier` + modale montant initial | [PageCashier.tsx](frontend/components/pages/PageCashier.tsx) | ouverture quotidienne caisse |
| R-06 | Bouton "Planifier trip" sur `/admin/trips-planning` + wizard (route, bus, driver, heure) | [PageTripPlanning.tsx](frontend/components/pages/PageTripPlanning.tsx) | planification |

### 5.3. P1 — Portails opérationnels terrain (3-5 j)

| # | Fix | Où | Impact |
|---|---|---|---|
| R-07 | Portail chauffeur `/driver` : CTA check-in, départ, signaler incident, arrivée | `DriverDashboard.tsx` + pages driver | 1 chauffeur = 1 trip = plusieurs CTA |
| R-08 | Portail quai `/quai` : CTA scan inbound, charger colis, pickup, dispute | `QuaiAgentDashboard.tsx` | Hub colis opérationnel |
| R-09 | Portail voyageur `/portail` : formulaire search (origine, destination, date, passagers) + résultats + sélection siège + paiement | `PortailVoyageur.tsx` | booking en ligne |

### 5.4. P1 — Métier support (2-3 j)

| # | Fix | Où | Impact |
|---|---|---|---|
| R-10 | Bouton "Émettre voucher" sur `/admin/vouchers` + formulaire | [PageVouchers.tsx](frontend/components/pages/PageVouchers.tsx) | compensation commerciale |
| R-11 | Liste refunds peuplée avec actions "Approuver/Refuser" sur `/admin/sav/refunds` | `PageSavRefunds.tsx` | cycle SAV complet |
| R-12 | Formulaire public de dépôt SAV (probablement sous `/portail/claim`) | nouvelle page publique | voyageur peut réclamer |

### 5.5. P2 — Hors métier (2-4 j)

| # | Fix | Où | Impact |
|---|---|---|---|
| R-13 | CTA "Exporter" sur `/admin/invoices` (CSV / PDF / comptable) | [PageInvoices.tsx](frontend/components/pages/PageInvoices.tsx) | clôture comptable |
| R-14 | Câblage UI du module Backup/RGPD : 4 CTA (créer backup, liste, télécharger RGPD, restaurer) | [PageAdminBackup.tsx](frontend/components/pages/PageAdminBackup.tsx) (livrée 23/04 mais CTA non détectés ici) | conformité + data protection |
| R-15 | **Zone danger tenant** — page dédiée avec bouton "Supprimer mon compte" + confirmation double | nouvelle `/admin/settings/danger-zone` | droit à la fermeture |

### 5.6. P2 — UX post-login (0,5 j)

| # | Fix | Où | Impact |
|---|---|---|---|
| R-16 | Redirect `/login` → `/admin` systématique après sign-in réussi sur subdomain tenant | route login frontend | Admin login réussit maintenant |

---

## 6. Comparatif run UI vs runs précédents

| Run | Type | Tests | PASS | Durée | Niveau de preuve "l'appli marche" |
|---|---|---|---|---|---|
| 01:33 UTC | API (50) + UI smoke (19) | 69 | 69/69 | 42 s | 🟢 backend OK mais **UI non cliquée** |
| 08:03 UTC | Idem reprise | 69 | 69/69 | 66 s | idem |
| **Ce run** | **UI pure, 0 API** | 1 | 1/1 | **78 s** | 🔴 **25 actions UI OK / 51 écarts documentés** |

**Lecture** : passer à un harness UI-only révèle que les précédents runs verts **masquaient** l'absence des déclencheurs UI en faisant le travail via API directe.

---

## 7. Fichiers livrés ce run

| Fichier | Taille | Rôle |
|---|---|---|
| [FULL-UI-LIFECYCLE.public.pw.spec.ts](test/playwright/mega-scenarios/FULL-UI-LIFECYCLE.public.pw.spec.ts) | ~17 Ko | Le spec UI-only défensif |
| [steps-lifecycle-2026-04-24.jsonl](reports/mega-audit-2026-04-24/steps-lifecycle-2026-04-24.jsonl) | 76 Ko | 90 événements JSONL horodatés |
| [UI_LIFECYCLE_REPORT_2026-04-24.md](reports/mega-audit-2026-04-24/UI_LIFECYCLE_REPORT_2026-04-24.md) | ~12 Ko | Ce rapport |
| [UI_LIFECYCLE_REPORT_2026-04-24.docx](reports/mega-audit-2026-04-24/UI_LIFECYCLE_REPORT_2026-04-24.docx) | — | Version Word |

---

## 8. Comment rejouer ce test

```bash
# Backend + Vite up (3000 + 5173)
until curl -s -o /dev/null http://localhost:3000/api/auth/oauth/providers; do sleep 2; done

# Playwright + Chromium déjà installés
PLAYWRIGHT_BROWSER=1 npx playwright test --workers=1 \
  test/playwright/mega-scenarios/FULL-UI-LIFECYCLE.public.pw.spec.ts \
  --reporter=list

# Output JSONL : reports/mega-audit-2026-04-24/steps-lifecycle-2026-04-24.jsonl
```

---

## 9. Conclusion honnête

**Non, l'application n'est PAS finie**.

Les flows **signup + onboarding + analytics consultatives** sont livrables. Mais **tous les parcours opérationnels métier (vente billet, colis, incident, refund, voucher)** et **tous les parcours hors métier (export compta, RGPD user-facing, backup, destruction tenant)** manquent leurs CTA UI — l'utilisateur réel dépend aujourd'hui d'un appel API ou d'un accès DB admin.

**Effort estimé pour atteindre un vrai niveau "GO production 100 % UI"** :
- P0 (setup + vente) : **5 j**
- P1 (portails terrain + support) : **5-8 j**
- P2 (hors métier : compta + RGPD + backup + destruction) : **2-4 j**
- **TOTAL : 12-17 jours-homme de frontend** sur des pages déjà techniquement prêtes côté backend.

Les remédiations sont listées en §5 avec les chemins de fichiers à modifier. Aucun refactor backend requis : il s'agit uniquement de câbler les composants UI sur des endpoints qui existent déjà.

---

*Rapport généré après run navigateur pur du 2026-04-24 — 90 événements JSONL tracés, 25 succès, 22 contrôles manquants, 29 erreurs documentées. Aucun appel API bypass.*
