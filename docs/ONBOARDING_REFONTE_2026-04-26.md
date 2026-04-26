# Refonte WelcomePage post-onboarding — 2026-04-26

## Problème

La WelcomePage affichait une checklist mensongère :

- ✅ Compte créé
- ✅ Espace configuré
- ⬜ **Vendre votre premier billet** ← *impossible* (pas de Bus, pas de Trip)
- ⬜ **Enregistrer votre premier colis** ← *impossible* (pas de destination)
- ⬜ Consulter votre premier rapport
- ⬜ Inviter votre équipe

L'admin cliquait "Vendre 1er billet" → arrivait sur un select vide → confusion + perte de confiance dès J0. URL utilisée par la page (`/admin/sell-ticket`) était même fausse — le vrai chemin est `/admin/tickets/new`.

## Diagnostic

L'API `POST /tickets` exige : `Trip` (avec `Bus.seatLayout` + `Driver` assigné), `FareClass`, deux `Station` (boarding + alighting). Le wizard ne crée que `Brand + Agency + Station + Route + Team`. Donc il manque structurellement **Bus** et **Trip** avant que la promesse "vendre un billet" devienne tenable.

## Solution livrée

### 1. Backend — `getState()` étendu

[onboarding-wizard.service.ts](../src/modules/onboarding-wizard/onboarding-wizard.service.ts)

Nouveau bloc `activation` retourné par `GET /onboarding/state` :

```ts
activation: {
  bus:          boolean,  // Bus.count > 0
  trip:         boolean,  // Trip.count > 0
  firstTicket:  boolean,  // Ticket.count > 0 (excluant CANCELLED/EXPIRED)
  firstParcel:  boolean,  // Parcel.count > 0
  team:         boolean,  // User.count > 1 (admin + au moins 1 invité)
  hasDemoSeed:  boolean,  // Bus.model startsWith "[DÉMO] " (préparation backlog)
}
```

Aucune migration Prisma — tout dérive des comptages.

### 2. Frontend — WelcomePage refondue

[WelcomePage.tsx](../frontend/components/onboarding/WelcomePage.tsx)

Checklist par **dépendance** avec 3 statuts par item :
- `done` : check vert, line-through.
- `active` : cliquable, CTA "Y aller →".
- `locked` : grisé, **non cliquable**, tooltip i18n `welcome.unlock.needsBus | needsTrip | needsRoute`.

**Variantes par `tenant.businessActivity`** :

| Activité | Items |
|---|---|
| TICKETING / null | account → onboarding → addBus → planTrip → sellFirstTicket → inviteTeam |
| PARCELS | account → onboarding → registerFirstParcel → inviteTeam |
| MIXED | account → onboarding → addBus → planTrip → sellFirstTicket → registerFirstParcel → inviteTeam |

Cascade de dépendance :
- `planTrip` → locked tant que `bus = false`
- `sellFirstTicket` → locked tant que `trip = false`
- `registerFirstParcel` → locked tant que `route = false` (car la route auto-crée la station de destination)

### 3. Frontend — Empty state PageSellTicket

[PageSellTicket.tsx](../frontend/components/pages/PageSellTicket.tsx)

Quand chargement terminé et `trips.length === 0` (et pas confirmed), le main layout est masqué et un encart explicatif prend sa place avec deux CTA :
- **Enregistrer un bus** → `/admin/fleet`
- **Programmer un départ** → `/admin/trips/planning`

Plus jamais de select vide menant à un formulaire inutile.

### 4. i18n

fr.ts + en.ts complétés (~25 nouvelles clés dans `welcome.*` et 6 dans `sellTicket.empty.*`).
Les 6 autres locales (es, pt, ar, wo, ln, ktu) sont en TODO documenté dans [TODO_i18n_propagation.md](TODO_i18n_propagation.md).

### 5. Tests unit

[onboarding-wizard.service.spec.ts](../test/unit/services/onboarding-wizard.service.spec.ts) — **12 tests verts** :

- Comptages activation (bus / trip / ticket actif / parcel / team)
- Filtre `Ticket.status notIn [CANCELLED, EXPIRED]` (régression future)
- Détection `[DÉMO] ` préfixe pour `hasDemoSeed`
- Régression : `steps` wizard inchangé
- `NotFoundException` si tenant absent
- `firstStationId` reprise wizard

Régression vérifiée sur `onboarding.service.spec.ts` (4/4 OK).

## Backlog optionnel — Mode démo

Évalué puis **différé** pour livrer rapide. Si on l'ajoute plus tard, voici la spec :

- Endpoint `POST /onboarding/demo-seed` qui crée :
  - 1 User STAFF + Account (`forcePasswordChange`) + Staff (chauffeur)
  - 1 Bus avec `model: "[DÉMO] Coaster 30 places"`, `seatLayout` standard
  - 1 Route démo (si pas déjà créée par le wizard)
  - 1 Trip pour J+1 8h, transition `PLANNED → OPEN` via `WorkflowEngine.transition({ action: 'START_BOARDING' })`
- Endpoint `DELETE /onboarding/demo-seed` qui purge tout objet dont le nom commence par `[DÉMO] ` (déjà détecté par `activation.hasDemoSeed`)
- Bouton sur WelcomePage : *"Pré-remplir avec données de démonstration"* (si `!activation.bus && !activation.trip`)
- Banner persistant : *"Mode démo actif — Supprimer les données de démo"*

**Coût estimé** : ~300 lignes (service + endpoints + UI bouton + tests). Pas critique car l'admin peut créer ses vraies données via les CTA de l'empty state.

## Garanties

- ✅ Aucun item cliquable n'amène à un dead-end.
- ✅ Aucune migration Prisma (changement d'usage seulement).
- ✅ WorkflowEngine respecté pour toute future transition Trip.
- ✅ Devise / FareClass tirées de `TenantBusinessConfig` (pas hardcodées).
- ✅ `data.crm.*` et permissions inchangées.
- ✅ Tests unit verts (12 nouveaux + 4 anciens).
