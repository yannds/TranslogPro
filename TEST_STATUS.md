# TransLog Pro — Statut des Tests

> Référence partagée entre les deux développeurs.
> Mise à jour après chaque session. Dernière mise à jour : 2026-04-24 (Refonte briefing QHSE — 7 sprints, 6 commits).

### Refonte briefing pré-voyage QHSE (2026-04-24)

Passage d'une checklist équipement-seule à un briefing multi-chapitres
tenant-configurable avec double signature (DRAW/PIN/BIOMETRIC) et alertes
sécurité immuables. Voir [docs/BRIEFING.md](docs/BRIEFING.md).

**Tests livrés :**
- **Unit** : 5 specs `test/unit/crew-briefing/` — 39 tests
  (template CRUD, rest calculator, safety alert, briefing v2 flow complet).
  Total suite unit : 1104/1104 PASS.
- **Security** : `test/security/briefing-isolation.spec.ts` — 11 tests
  (cross-tenant isolation, scope 'own', override BLOCK_DEPARTURE immuable,
  alerte one-shot). Total suite security : 207/207 PASS.
- **Playwright E2E-API** : `test/playwright/briefing-signature-recursive.api.spec.ts`
  — 4 tests : signature DRAW SVG récursive (byte-for-byte), signature PIN,
  policy BLOCK sans override (403), policy BLOCK avec override (200 +
  audit tracé + alertes émises).

**Sprints** :
- S1 : Schéma Prisma + template seed (8 chapitres × 41 items, commit 1c4c95f)
- S2 : Services (BriefingTemplate, DriverRestCalculator, TripSafetyAlert,
  CrewBriefing v2) + 39 tests unit (commit 52053db)
- S3 : RBAC (+13 permissions) + endpoints v2 + DTOs + 11 tests security
  (commit a21d1aa)
- S4 : Web admin (PageBriefingTemplate, PageTripSafetyAlerts, section
  Briefing dans PageTenantBusinessRules, commit 0fb0832)
- S5 : Web chauffeur (PageDriverBriefing refonte v2 + BriefingSignatureInput,
  commit 7b9b779)
- S6 : Mobile unifié (BriefingScreen v2 + MobileSignatureInput, commit dfa64d6)
- S7 : Tests Playwright récursif dessin + docs/BRIEFING.md + clôture

### Sprints Pricing S1→S5 — Refonte complète (2026-04-20)

**Livraison bout-en-bout** de la chaîne tarifaire : defaults marché → taxes
configurables → overrides par ligne → simulateur prix souhaité → KPI
saisonniers → yield engine activé avec calendrier peak periods.

**S1 — Fondations pricing (zéro magic number)** :
- Nouveau modèle Prisma `TenantFareClass` (remplace enum figé),
  `TenantTax +3 flags` (`appliedToPrice`, `appliedToRecommendation`,
  `isSystemDefault`), `Route.pricingOverrides Json?`
- Registry `platform-config` : 25+ clés `pricing.*`, `tax.*`, `yield.*`
  (support nouveau type `json` pour `fareClasses` defaults)
- `PricingEngine` branché sur `TenantTax[]` + `TenantFareClass` via
  `TaxCalculatorService` (rétro-compat : `PricingResult.taxes: number`
  conservé, `taxBreakdown: TaxLine[]` ajouté)
- Permissions `FARE_CLASS_*` + `PEAK_PERIOD_*` assignées aux 4 rôles système
- Magic numbers retirés : `DEFAULT_TVA_RATE=0.18`, `DEFAULT_YIELD_CONFIG`,
  `HOURS_BEFORE_DEPARTURE=48`, `0.85`, `0.50` → tous via `PlatformConfigService`
- Seed `OnboardingService.seedPricingDefaults` + script backfill
  `pricing-defaults.backfill.ts` idempotent → tenants neufs + existants
- +5 tests (context `PRICE|RECOMMENDATION`) sur TaxCalculator

**S2 — Toggle TVA/péages tenant + ligne + affichage pédagogique** :
- `TaxLine.applied: boolean` + option `includeNonApplied` (mode pédagogique)
- `PricingInput.explainTaxes` propagé jusqu'à `TaxCalculatorService`
- `UpdateRouteDto.pricingOverrides` + validation stricte
- Composant `RoutePricingOverridesEditor` (taxes par code + péages + bagages)
- PageSellTicket affiche les taxes non-appliquées en **italique barré**
  avec tooltip "serait X XOF"
- +4 tests `includeNonApplied` sur TaxCalculator

**S3 — Simulateur "prix souhaité" live** :
- Composant `PricingSimulatorCard` dans PageRoutes (édition uniquement)
- 3 appels parallèles à `/simulate-trip` avec fillRate 50/70/90
- Tableau rentabilité avec tag couleur PROFITABLE/BREAK_EVEN/DEFICIT
- Recommandations dérivées (break-even price, prix rentable à 70%)
- Réutilise `CostCalculatorEngine` existant (DRY)

**S4 — KPI saisonniers + règle YoY progressive** :
- Modèle Prisma `SeasonalAggregate` (tenantId, routeId?, periodType,
  periodKey, ticketsSold, revenueTotal, vsPreviousPct, vsLastYearPct)
- `SeasonalityService.computeHistoryWindow` : règle YoY progressive stricte
  (INSUFFICIENT < 30j / SHORT 30-89 / MEDIUM 90-364 / YOY 365-729 / MULTI_YEAR ≥730)
- `SeasonalityService.recomputeForTenant` : agrège depuis `Trip COMPLETED` +
  `TripCostSnapshot` sur 5 periodType × 2 scopes (tenant global + par route)
- Scheduler cron 03h quotidien `recomputeSeasonalAggregates`
- Endpoint `GET /analytics/seasonality?periodType=MONTH&from=X&to=Y`
- Page `PageSeasonality` avec banner window + 4 onglets + bar chart +
  recommandations dérivées
- +10 tests (window progressif + agrégations + deltas + sécurité)

**S5 — Peak periods + activation YIELD_ENGINE** :
- Modèle Prisma `PeakPeriod` (tenantId, code, dates, expectedDemandFactor,
  isHoliday, isSystemDefault, countryCode?)
- Seed calendriers par défaut `peak-periods.seed.ts` — 14 périodes/tenant :
  10 universelles (Noël, Nouvel An, Pâques, creux janvier) + spécifiques
  par pays (CG, SN, CI, FR)
- `PeakPeriodService.resolveDemandFactor` : produit des facteurs si
  chevauchement de périodes actives
- **5ème règle `YieldService` PEAK_PERIOD en priorité maximale** — avant
  GOLDEN_DAY / BLACK_ROUTE / LOW_FILL / HIGH_FILL (événement calendrier
  prime sur réaction fillRate)
- **Activation automatique `InstalledModule(YIELD_ENGINE, isActive=true)`**
  via onboarding + backfill → tous les tenants (3/3 en dev) actifs
- Page `PageTenantPeakPeriods` CRUD
- +8 tests PeakPeriodService + réparation test YieldService (mock peakPeriod)

**Régression tierce réparée hors scope** : `platform-kpi.service.spec.ts`
avait les anciennes clés de module registry (`'ticketing'` → `'TICKETING'`
UPPER_SNAKE_CASE). Sed de migration appliqué → 23/23 restauré.

**Compteurs post-S1-S5 :**
- Unit        : **773/773** (75 suites) — +46 tests (5 S1 + 4 S2 + 10 S4 + 8 S5 + régressions réparées)
- TypeScript  : **0 erreur** (hors préexistantes mobile/i18n/poc)
- DB          : 4 tables additives créées, zéro data loss
  (`tenant_fare_classes`, `seasonal_aggregates`, `peak_periods` + colonnes
  additionnelles sur `tenant_taxes` + `routes`)
- Backfill exécuté : 3/3 tenants rattrapés, 42 peak_periods seedés,
  YIELD_ENGINE actif sur 3/3

**Clôture roadmap pricing : tous les tenants (existants + futurs) ont un
pipeline tarifaire complet opérationnel.**


### Sprint 11 — Rentabilité pré-trajet + scénarios métier imbriqués (2026-04-20)

**Livraison bout-en-bout demandée par user :** "un truc qui montre si le prix fixé est d'emblée une perte ou à l'équilibre ou au-dessus, dans les KPI du gestionnaire qui programme les trajets, en permissions et non en rôle" + parcours métier chaînés.

Phase 11.A — **Rentabilité pré-trajet** (commit `86b5e44`) :
- Permission granulaire `data.profitability.read.tenant` (séparée de STATS_READ)
  mappée sur TENANT_ADMIN, AGENCY_MANAGER, ACCOUNTANT dans le seed IAM
- Endpoint `POST /api/tenants/:id/simulate-trip` — retourne :
  · Coûts détaillés (variable + fixe + total)
  · Projection (marge nette, tag PROFITABLE / BREAK_EVEN / DEFICIT)
  · Recommandations : prix break-even au fillRate, fillRate break-even au prix,
    prix profitable (+seuil tenant), message factuel non-bloquant
- Composant frontend `TripProfitabilityPanel` réutilisable à monter dans tout
  formulaire de scheduler (gated par `user.permissions`, pas le rôle)
- Zéro magic number : `breakEvenThresholdPct` + `agencyCommissionRate` lus
  depuis `TenantBusinessConfig`
- +12 unit tests (`simulate-trip.service.spec.ts`)

Phase 11.B + 11.D — **Scénarios colis/voucher/refund** (commit `6782d42`) :
- `business-scenarios.api.spec.ts` (7 tests imbriqués serial)
  · SETUP, PARCEL-1 (colis simple), PARCEL-2 (ticket + colis même trip),
    VOUCHER-1 (issue), VOUCHER-2 (redeem), REFUND-1 (cancel),
    ANALYTICS-1 (simulate DEFICIT / erreur documentée)
- Bug détecté & corrigé : schema-DB drift `tenants.estimatedOperationsMonthly`
  → `prisma db push` appliqué

Phase 11.C — **Scénarios voyageur** (commit `f67421c`) :
- `traveler-scenarios.api.spec.ts` (5 tests)
  · BAG-1 (bagage ≤ franchise → pas surcoût), BAG-2 (bagage extra facturé),
    NOSHOW-1 (mark no-show honore `noShowGraceMinutes`), REBOOK-1 (rebook/later
    respecte le workflow)

Phase 11.E — **Pricing dynamique** (commit `f67421c`) :
- `pricing-dynamics.api.spec.ts` (5 tests)
  · YIELD-1 (yield suggestion structure), PROFIT-LINE-1 (DEFICIT bas / PROFITABLE
    haut), PROFIT-BUS-1 (erreur claire bus sans costProfile),
    PROFIT-SUMMARY (endpoint analytics/profitability répond)

Remédiation bug flaky hors scope (commit `f67421c`) :
- `platform-plans.sa.pw.spec.ts` : utiliser la search DataTableMaster pour
  forcer la visibilité du slug créé (indépendant de la pagination/ordre)

**Compteurs 5 niveaux post-Sprint 11 :**
- Unit        : **727/727**   (+12 simulate-trip, autres ajouts tiers — puis +46 post-S1-S5 → 773/773)
- Security    : **172/172**   (+15 tiers)
- Integration : **62/62**     (+5 tiers)
- E2E         : **149/149**   (stable)
- Playwright  : **76 passed** + 4 skipped + **9 failed** sur `platform-kpi.sa.pw.spec.ts` hors scope Sprint 11 — le test référence des sections `pk-northstar` / `pk-*` qui n'existent pas dans la page `/admin/platform/dashboard`. Ticket de suite à ouvrir : soit la page a été régressée, soit le test anticipe une UI non livrée.

**Total tests au vert post-S1-S5 : 1232 (773 unit + 172 security + 62 integ + 149 e2e + 76 pw).**

**Backup DB pré-Sprint 11 final :** `backups/pre-sprint11-finale-20260420-1129.sql` (17 MB).

### Sprint KPI SaaS plateforme livré (2026-04-20) — dashboard cross-tenant investisseur

### Sprint KPI SaaS plateforme livré (2026-04-20) — dashboard cross-tenant investisseur

**Total : +34 tests unit + 15 security + 4 integration + 9 Playwright. Zéro régression.**

| Sprint | Livraison | Commit | Tests |
|---|---|---|---|
| 1 | Schéma Prisma additif (Tenant.estimatedOperationsMonthly, SubscriptionChange, PlatformKpiSnapshot) | `aabb059` | 5 unit |
| 2 | PlatformKpiService (7 méthodes cross-tenant + cache) | `b7ae2f6` | 17 unit |
| 3 | Endpoints REST + RBAC fine-grained (4 perms) | `9a68c1b` | 7 unit |
| 4 | UI 7 sections dashboard (refonte PagePlatformDashboard) | `191452c` | — |
| 5 | i18n fr+en complet (80 clés platformKpi.*) | `d9f270b` | — |
| 6 | Tests 5 niveaux (security + integration + Playwright) | `a1e3a28` | 15 sec + 4 integ + 9 pw |
| 7 | Documentation complète (docs/PLATFORM_KPI.md) | (ce commit) | — |

**Nouveaux totaux** :
- Unit : **727** (+19 vs 708 baseline roadmap 9)
- Security : **172** (+15 vs 157 baseline)
- Voir [docs/PLATFORM_KPI.md](docs/PLATFORM_KPI.md) pour détails complets.

---

### Roadmap 9 sprints livrée (2026-04-20) — post blueprint UX

**Total : +100 tests sur 10 sprints (0→9). Zéro régression.**

| Sprint | Livraison | Commits | Tests ajoutés |
|---|---|---|---|
| 0 | Audit + baseline + fix playwright TFD | `9f85ab4` | — |
| 1 | Trajets intermédiaires bout-en-bout (backend) | `929ddd3`, `7e25f52` | 40 (18 helper + 10 service + 7 sec + 5 integ) |
| 2 | Portail public + UI timeline voyageur + i18n | `435a40f` | fix ACC-3 |
| 3 | Caissier + mobile + fix parcels regression | `2bb3262` | 6 unit (getParcelList) |
| 4 | Dashboard Gérant "Aujourd'hui" + alertes anomalies | `0295954`, `bb3b843` | 11 unit (today-summary) |
| 5 | Synthèse flotte + résumé comptable du jour | `7d19205` | 8 unit (fleet-summary) |
| 6 | SSE cross-rôles tenant-isolated | `ff74cc8` | 5 unit (realtime) |
| 7 | Maintenance prédictive simple (sans ML) | `5c80ae7` | 9 unit (maintenance-prediction) |
| 8 | Couverture YieldService (+ UI cashier wiring) | `0bada62` | 11 unit (yield) |
| 9 | Scoring conducteur (ponctualité/incidents/volume) | `9f4963d` | 10 unit (driver-scoring) |

**Compteurs 5 niveaux finaux (baseline 984 → final 1084, +100) :**
- Unit : **671** (baseline 583, +88)
- Security : **157** (baseline 150, +7)
- Integration : **57** (baseline 52, +5)
- E2E : **149** (stable)
- Playwright : **50** (stable)

### Sprint Tax-RBAC (2026-04-20) — split lecture/écriture taxes tenant

Découverte audit : `PageTenantTaxes` était orpheline (composant + route PageRouter mais aucune entrée nav → invisible). Permission unique `SETTINGS_MANAGE_TENANT` trop large : seul TENANT_ADMIN pouvait gérer la fiscalité.

Livré :
- 2 nouvelles permissions : `data.tax.read.tenant` (lecture) + `control.tax.manage.tenant` (écriture)
- Rôle `ACCOUNTANT` (comptable) ajouté au seed IAM avec read+write taxes + facturation/refund/stats
- Mapping par défaut : TENANT_ADMIN, AGENCY_MANAGER, ACCOUNTANT (read+write) ; CASHIER (read seul) ; aucun autre rôle système n'a de fuite
- Controller `TenantSettingsController` : décorateurs split GET=read, POST/PATCH/DELETE=write — par permission, jamais par rôle
- Nav `/admin/settings/taxes` branché dans Configuration, gated sur `data.tax.read.tenant` ou `control.tax.manage.tenant`
- Page UI : bouton "Ajouter" + actions "Modifier/Supprimer" masqués si l'utilisateur n'a pas l'écriture (badge "Lecture seule")
- Bug fix : `prisma/seeds/iam.seed.ts` — `main()` enveloppé dans `require.main === module` pour permettre l'import du seed depuis les tests sans déclencher le runner standalone
- i18n fr+en : `nav.taxes_fiscality`, `tenantSettings.taxes.subtitleReadOnly`, `common.readOnly`

Tests ajoutés (12) :
- `test/unit/tenant-settings/tenant-tax-rbac.spec.ts` — décorateurs `@RequirePermission` sur les 4 endpoints + mapping rôle→permission par défaut + zéro fuite sur DRIVER/HOSTESS/MECHANIC/AGENT_QUAI/CUSTOMER/DISPATCHER/PUBLIC_REPORTER

**Compteurs après Sprint Tax-RBAC :** Unit **686** (+15), Security **157** (stable).

---

## Sprint BYO-credentials (2026-04-20)

**Fonctionnalité :** Modèle B — tenant saisit ses propres clés API paiement via l'UI `/admin/integrations`. Credentials écrits dans Vault au chemin `tenants/<id>/payments/<provider>`.

**Changements :**
- `src/infrastructure/payment/providers/types.ts` — `CredentialFieldSpec` + `credentialFields` dans `PaymentProviderMeta`
- `src/infrastructure/secret/interfaces/secret.interface.ts` + `vault.service.ts` — ajout `deleteSecret(path)`
- 6 providers — `credentialFields` peuplé (MTN 9 champs, Airtel 6, Wave 3, Flutterwave 2, Paystack 1, Stripe 2)
- `payment-provider.registry.ts` — `getCredentialSchema(providerKey)`
- `integrations.service.ts` — injection `SECRET_SERVICE` + `getCredentialSchema()` / `saveCredentials()` / `deleteCredentials()`
- `tenant-settings.controller.ts` — 3 nouveaux endpoints : `GET /schema`, `PUT /credentials`, `DELETE /credentials`
- `frontend/components/ui/FormFooter.tsx` — prop `formId?` (bouton submit HTML5 hors-form)
- `frontend/components/pages/integrations/IntegrationCredentialsDialog.tsx` — NEW modale formulaire dynamique
- `frontend/components/pages/PageIntegrations.tsx` — bouton "Saisir mes identifiants" + badge "Mes identifiants"
- i18n fr+en — `integrations.credentials.*` (16 clés)
- `docs/INTEGRATIONS.md` — §6 matrice + §13 BYO-credentials complet
- `TECHNICAL_ARCHITECTURE.md` — ADR-34

**Tests ajoutés (17) :**
- `test/unit/tenant-settings/integrations-credentials.service.spec.ts` — 11 cas : getCredentialSchema, saveCredentials (écriture Vault, path tenant-scoped, validation, rétrogradation LIVE→SANDBOX, champ hors schéma), deleteCredentials (fallback plateforme, mode DISABLED, NotFoundException, path non-scoped)
- `test/security/integrations-credentials.spec.ts` — 6 cas : unauth 401, cross-tenant 403, provider inconnu 404, champ hors schéma 400
- `test/playwright/payment-integrations-credentials.spec.ts` — 4 cas E2E smoke : chargement page, boutons configurer, ouverture modale, soumission formulaire Wave

**Compteurs après Sprint BYO-credentials :** Unit **697** (+11), Security **163** (+6), Playwright smoke **+4**.

**Audit orphans — chantiers livrés dans la foulée :**
- ✅ `PageTenantPayment` branchée — entrée nav `tenant-payment` ajoutée sous Configuration (`/admin/settings/payment`, gated `SETTINGS_MANAGE_TENANT`)
- ✅ `PageAnnouncements` branchée — la nav avait déjà `display-announcements` mais PageRouter retournait `<PageWip>` placeholder ; remplacé par `<LazyAnnouncements />` (les 5 endpoints `/tenants/:id/announcements` ont enfin leur UI)
- ⏳ `PagePersonnel` — incohérence id `'personnel'` vs nav `'staff-list'`, à arbitrer dans un sprint dédié (renommage cas ou nouvelle entrée nav)

**Compteurs après orphan fixes :** Unit **708**, Security **157** (zéro régression).

**Tous les schémas tenant-config étendus avec seuils paramétrables (zéro magic number) :**
- `intermediateBookingEnabled/CutoffMins/MinSegmentMinutes/SegmentBlacklist` (Sprint 1)
- `anomalyIncidentThreshold/DiscrepancyThreshold/FillRateFloor` (Sprint 4)
- `maintenanceIntervals/AnticipationKm/AnticipationDays` (Sprint 7)
- `driverScoreWeight{Punctuality,Incidents,TripVolume}/GraceMinutes/WindowDays` (Sprint 9)

**Nouveaux endpoints :**
- `GET /analytics/today-summary` (Sprint 4)
- `GET /analytics/fleet-summary` (Sprint 5)
- `GET /realtime/events` (SSE, Sprint 6)
- `GET /garage/reminders` + `POST /garage/reminders/:busId/:type/performed` (Sprint 7)
- `GET /driver-profile/scoring/:staffId` + `/scoring/leaderboard` + `POST /scoring/recompute-all` (Sprint 9)

**Remédiations en sillage :**
- Playwright TFD (Staff upsert idempotent post-backfill boot) — Sprint 0
- Playwright ACC-3 (cleanup via `session_replication_role=replica`) — Sprint 2

---

### Ajouts 2026-04-20 — Sprint 1 : trajets intermédiaires bout-en-bout

### Ajouts 2026-04-20 — Sprint 1 : trajets intermédiaires bout-en-bout

**Contexte** : première priorité roadmap post-blueprint UX — permettre la recherche/vente de billets sur des segments intermédiaires (ex : Mindouli → Bouansa sur Brazza → Pointe-Noire) alors que jusqu'ici seuls les trajets OD complets étaient listés. Politique tenant configurable en DB (zéro magic number).

Schéma Prisma (`TenantBusinessConfig`) — 5 nouveaux champs :
- `intermediateBookingEnabled` / `intermediateBookingCutoffMins` / `intermediateMinSegmentMinutes`
- `intermediateSegmentBlacklist` (JSON) / `intermediateRespectHubRules`

Nouveau helper partagé (`src/core/pricing/segment-price.helper.ts`) :
- `resolveSegmentPriceFromSnapshot` — fonction pure réutilisable côté search public + future intégration engine, évite la duplication de la logique de résolution de prix.

Services backend :
- `PublicPortalService.searchTrips()` : matching étendu origin/waypoint/destination + politique tenant appliquée + réponse enrichie (stops[] timeline, boardingStationId/alightingStationId, isIntermediateSegment, isAutoCalculated).
- `PublicPortalService.createBooking()` : accepte `boardingStationId`/`alightingStationId` optionnels (défaut OD), validation serveur (station sur route + ordre asc + policy + cutoff + blacklist), pricePaid = segment résolu.

Nouveaux fichiers tests (40 tests) :
- `test/unit/pricing/segment-price.helper.spec.ts` (18 tests — helper pur)
- `test/unit/public-portal/search-trips-intermediate.service.spec.ts` (10 tests — matching + policy)
- `test/security/intermediate-booking-isolation.spec.ts` (7 tests — cross-tenant + createBooking guards)
- `test/integration/public-portal/search-trips-intermediate.integration-spec.ts` (5 tests — DB réelle + isolation tenant confirmée)

**Compteurs 5 niveaux post-Sprint 1 :**
- Unit : **611/611** (+28)
- Security : **157/157** (+7)
- Integration : **57/57** (+5)
- E2E : **149/149** (stable)
- Playwright : **50/50** (stable)
- **TOTAL : 1024/1024 — zéro régression**

Commits : `929ddd3` (backend + unit + security) + commit final Sprint 1.7 (intégration).

Remédiation Sprint 0 : `9f85ab4` — playwright TFD-1 upsert Staff idempotent (collision avec auto-backfillStaffFromUsers).

### Ajouts 2026-04-19 — Parcours E2E portail SaaS (landing → welcome) + helper cleanup tenants

**Contexte** : couverture E2E Playwright du chemin critique prospect → tenant opérationnel, des deux côtés du wizard onboarding (TICKETING et PARCELS). Bug Rules-of-Hooks découvert et corrigé dans `<StepPlan>` (`useMemo` après early-returns → crash sous-arbre quand `plans` passait de `null` à array).

Nouveaux fichiers :

- `test/playwright/saas-journey.public.pw.spec.ts` — 2 tests (projet `public`) :
  · **TICKETING** : landing apex → `/signup` → wizard 3 étapes (admin/company/plan) → `/api/public/signup` → sign-in API cross-subdomain → `/onboarding` → brand → agency → station → **route** → team (skip) → `/welcome` → reload ne re-déclenche pas le wizard → 0 pageerror JS
  · **PARCELS** : même parcours mais sélection radio `activity=PARCELS` à l'étape 2 signup → onboarding avec étape 4 = **parcel-info** (encart info, pas d'API) au lieu de route
  · Helpers partagés : `signupWizard`, `loginAndReachOnboarding`, `onboardingStepBrand/Agency/Station/TeamSkipToWelcome`, `attachErrorCapture`
- `scripts/cleanup-e2e-tenants.ts` — module dual-use :
  · `deleteTenantBySlug(slug, prisma?)` importé par le spec → cleanup après chaque test
  · `deleteTenantsByPrefix(prefix)` + CLI `npx ts-node scripts/cleanup-e2e-tenants.ts pw-saas-` pour purge batch en CI
  · Technique : `SET LOCAL session_replication_role = 'replica'` dans une transaction → DELETE sur `tenants` sans bloquer sur les FK tenant-scoped non-cascade
  · Whitelist de préfixes (`pw-saas-`, `pw-a-`, `pw-e2e-`, `e2e-`) + refus du tenant plateforme — garde-fou anti-purge accidentelle

Fix livré en sillage :

- `frontend/components/public/PublicSignup.tsx` — `<StepPlan>` : `useMemo(numberFmt)` remonté avant les early-returns conditionnels (violation Rules of Hooks qui crashait le sous-arbre quand `plans` passait de `null` → array).

**Commande** :
```bash
npm run test:pw -- test/playwright/saas-journey.public.pw.spec.ts --project=public
npx ts-node scripts/cleanup-e2e-tenants.ts pw-saas-   # purge batch résidus
```

**Résultat** : **2 tests passed (~11 s)**, stable sur 4 runs consécutifs, 0 résidu DB après run (vérifié par query `tenant` WHERE slug LIKE 'pw-saas-%').

### Ajouts 2026-04-19 — Chantier workflow-driven (ADR-15/16 full enforcement + scénarios incident/hub/voucher)

**Contexte** : migration de 7 modules hardcoded → WorkflowEngine + 4 nouveaux scénarios métier (Parcel hub, Ticket no-show, Incident en route, Voucher/Compensation) + UIs web/mobile/portail voyageur. Voir [docs/WORKFLOWS.md](docs/WORKFLOWS.md) pour la référence complète.

Nouvelles suites :

- `test/unit/sav/cancellation-policy.service.spec.ts` — 9 tests :
  · tenant JSON N-tiers → sélection palier correcte selon `hoursBeforeDeparture`
  · au-delà du palier 0 (départ imminent/passé) → pénalité max
  · trip override `cancellationPenaltyTiersOverride` prioritaire sur config tenant
  · appliesTo : si acteur hors liste, pénalité 0 % forcée
  · waive=true (perm `control.refund.waive_penalty.tenant`) force 0 %
  · legacy 2-tier fallback (≥ fullRefundMinutes / palier partiel / non remboursable)
- `test/unit/voucher/voucher.service.spec.ts` — 11 tests :
  · issue : rejet amount ≤ 0, validity < 1 jour, code unique préfixé tenant,
    validityEnd = now + days (stable à l'émission)
  · redeem : 404 unknown, déjà REDEEMED, expiré, scope SAME_ROUTE divergent,
    nominatif divergent (anti-transfert), happy path
  · cancel : transition via engine + stamps cancelledBy + reason
- `test/unit/incident-compensation/incident-compensation.service.spec.ts` — 8 tests :
  · suspendTrip : transition SUSPEND + stamps suspendedReason/suspendedById
  · cancelInTransit : prorata km (1 - traveled/total) → refund partiel fan-out
  · cancelInTransit sans prorata → refund 100 %
  · declareMajorDelay : sélection palier (150min → palier 120min → 25 %)
  · form=MIXED → split 50 % refund + 50 % voucher
  · trip `compensationPolicyOverride` prioritaire sur config tenant
  · délai < paliers → aucune compensation
  · rejet delayMinutes < 0

**Résultat** : **+28 tests**, suite unit complète **583/583 PASS** (était 533 avant le chantier).

### Ajouts 2026-04-19 — Self-service compte + MFA wire + reset-password cross-tenant

Nouvelles suites autour du portail plateforme et du self-service utilisateur :

- `test/unit/auth/auth.service.change-password.spec.ts` — 6 tests :
  · rejet `newPassword` < 8 caractères (400)
  · rejet `newPassword` identique à l'actuel (400)
  · user introuvable (404)
  · compte OAuth-only sans `Account.password` (400)
  · `currentPassword` faux via bcrypt compare (401)
  · succès : hash bcrypt(12) + `forcePasswordChange=false` + purge toutes sessions
- `test/unit/auth/auth.service.mfa-signin.spec.ts` — 2 tests :
  · `user.mfaEnabled=true` → retour `{ kind: 'mfaChallenge', ... }`, **aucune** session créée
  · `user.mfaEnabled=false` → flow standard (session + tracking `loginCount`)
- `test/unit/auth/auth.service.preferences.spec.ts` — 3 tests :
  · user introuvable (404)
  · merge partiel (timezone préservée quand seul `locale` est fourni, clés non-i18n comme `favoriteSeat` préservées)
  · preferences vides → création des clés fournies uniquement
- `test/unit/auth/password-reset.platform-admin.spec.ts` — 5 tests :
  · refuse self-reset (actor = target) → 403
  · target introuvable → 404
  · mode `set` sans `newPassword` → 400
  · mode `set` cross-tenant : hash bcrypt + `forcePasswordChange=true` + sessions purgées + audit `auth.password_reset.platform.set`
  · mode `link` cross-tenant : `tokenHash = sha256(rawToken)`, URL scoped au sous-domaine target, audit `auth.password_reset.platform.link`

**Résultat** : 16 tests ajoutés, suite `test/unit/auth/` passe à **33/33 PASS** (les 17 tests `password-reset.service.spec.ts` restent verts — aucune régression).

- `test/playwright/account-self-service.api.spec.ts` — 3 scénarios API (live backend :3000) :
  · `PATCH /auth/me/preferences` persiste `locale + timezone` et apparaît dans `/auth/me`
  · `POST /auth/change-password` avec mauvais `currentPassword` → 401
  · `POST /auth/change-password` succès → toutes les sessions invalidées + nouveau login possible avec le nouveau mdp + restauration du mdp initial en fin de test pour ne pas casser la suite

### Ajouts 2026-04-15 — Refonte Personnel (Staff + StaffAssignment)
- `test/unit/services/staff-assignment.service.spec.ts` — 13 tests couvrant les invariants DESIGN §4.3 / §5 :
  · combinaison interdite `agencyId + coverageAgencyIds` (§4.3)
  · FK agence hors tenant → 400
  · doublon `(staffId, role, agencyId)` ACTIVE → 400 (§5.5)
  · création tenant-wide (agencyId null)
  · création multi-spécifique avec coverageAgencyIds
  · update sur affectation CLOSED → 400
  · bascule mono → purge auto coverageAgencies
  · close idempotent
  · addCoverageAgency rejeté sur mono-agence
  · removeCoverageAgency NotFoundException si non-couverte
- Suite unit après refonte : **201/207 passed** (6 échecs `white-label.service.spec.ts` **pré-existants** — XSS sanitization / token format — hors scope refonte).

### Ajouts 2026-04-15 — Invariant Agency + AgencyModule
- `test/unit/services/agency.service.spec.ts` — 13 tests (CRUD + invariant ≥1 agence par tenant)
- `test/unit/services/onboarding.service.spec.ts` — 5 tests (agence par défaut "Siège"/"Headquarters" créée AVANT l'admin, HMAC Vault, slug déjà pris)
- `test/integration/agency/agency-crud.spec.ts` — 4 tests (DB réelle : détachement users sur remove, FK station)
- `test/e2e/app.e2e-spec.ts` — +5 tests section `[AGENCY]` (403/200/201/400/409 dernière agence)
- Suite intégration complète : **40/40 passed** après ajout (aucune régression).

---

## Résumé rapide

| Niveau | Commande | Suites | Tests | Statut |
|--------|----------|--------|-------|--------|
| **Unit complet** | `npx jest --config jest.unit.config.ts` | 85 | 829 | ✅ 829/829 PASS (incl. CAPTCHA adaptatif sign-in — NIST/OWASP 2026-04-20) |
| **E2E — Endpoints** (test/e2e/) | `npm run test:e2e` | 1 | 124 | ✅ PASS (à revérifier après migration DB workflow) |
| **Integration** (test/integration/) | `npm run test:integration -- --runInBand` | 4 | 36 | ✅ PASS (à revérifier après migration DB workflow) |
| **Playwright portail SaaS** (landing → welcome) | `npm run test:pw -- --project=public saas-journey` | 1 | 2 | ✅ PASS (TICKETING + PARCELS, cleanup tenants auto) |

**Total validé 2026-04-20 post-security-hardening : 819 tests unit / 0 failure**

### Ajouts 2026-04-20 (hardening sécurité endpoints publics)
- `test/unit/common/is-e164-phone.validator.spec.ts` — 6 tests (validation E.164 + fallback country)
- `test/unit/common/turnstile.guard.spec.ts` — 6 tests (CAPTCHA Cloudflare : feature flag, fail-open, 403 token manquant, slug→tenantId)
- `test/unit/common/idempotency.guard.spec.ts` — 5 tests (SETNX pending, 409 concurrent, cache 200, header invalide)
- `test/unit/crm/claim-cooldown-budget.spec.ts` — 5 tests (cooldown 24h/phone + budget/jour tenant, fallbacks, disable via config)
- `test/unit/crm/bump-counters-phone-verified.spec.ts` — 5 tests (PUBLIC skip, PUBLIC email-only bump, AGENT flip, legacy sans gating)

**Total validé 2026-04-20 post-annonces : 791 tests unit / 0 failure**

### Ajouts 2026-04-20 (annonces temps réel + CRM portail)
- `test/unit/public-portal/portal-crm-wiring.service.spec.ts` — 4 tests (shadow Customer créé sur booking + parcel portail public, magic link dédup par customer)
- `test/unit/announcement/announcement.service.spec.ts` — 6 tests (create/update/remove publient ANNOUNCEMENT_* via EventBus, idempotence createAuto via sourceEventId, findAll activeOnly + station)
- `test/unit/announcement/announcement-trip.listener.spec.ts` — 8 tests (mapping TRIP_STARTED→BOARDING, TRIP_DELAYED→DELAY, TRIP_CANCELLED→CANCELLATION, TRIP_COMPLETED→ARRIVAL, TRIP_PAUSED→SUSPENSION, INCIDENT_SOS→SECURITY + templates FR/EN + trip introuvable silencieux)

**Total validé 2026-04-19 post-workflow : 583 tests unit / 0 failure**

> ⚠️ **2 failures pre-existing** dans `workflow.engine.spec.ts` (tests n°3 et 14 — WorkflowTransition idempotencyKey et audit.record) — présents avant cette session, non introduits par les changements v5.0 / v6.0.

### Ajouts v4.0 (Avril 2026)
- `src/modules/pricing/__tests__/cost-calculator.engine.spec.ts` — 25 tests (pure engine)
- `test/unit/services/profitability.service.spec.ts` — 14 tests
- `test/unit/services/white-label.service.spec.ts` — 16 tests
- `test/e2e/app.e2e-spec.ts` — +13 tests (sections 29 WHITE_LABEL + 30 PRICING)

### Ajouts v5.0 (Avril 2026)
- `src/modules/fleet-docs/__tests__/fleet-docs.service.spec.ts` — 14 tests (helpers _computeDocStatus, _computeConsumableStatus)
- `src/modules/scheduling-guard/__tests__/scheduling-guard.service.spec.ts` — 17 tests (checkAssignability : bus + driver + combiné)
- `src/modules/crew-briefing/__tests__/crew-briefing.service.spec.ts` — 13 tests (allEquipmentOk, erreurs)
- `src/modules/driver-profile/__tests__/driver-profile.service.spec.ts` — 13 tests (_computeLicenseStatus, checkRestCompliance, evaluateRemediationForDriver)
- `src/core/iam/guards/__tests__/module.guard.spec.ts` — 8 tests (cache hit/miss, DB active/inactive, invalidation)

### Ajouts v6.0 (Avril 2026 — Sprint 1 Workflow Studio + Sprint 2 Admin Panel)
- `src/modules/workflow-studio/__tests__/workflow-studio.service.spec.ts` — 13 tests (simulateWorkflow paths/blocages, createBlueprint validation/slug, getBlueprint/delete)
- `src/modules/analytics/__tests__/analytics.service.spec.ts` — 4 tests (getDashboard agrégats, scope agency, revenue null)
- `src/modules/pricing/__tests__/profitability.service.spec.ts` — 7 tests (getProfitabilitySummary agrégats/byTag/période vide, upsertCostProfile NotFoundException)
- `src/modules/white-label/__tests__/white-label.service.spec.ts` — 9 tests (getBrand cache hit/miss/défauts, upsert cache invalidation, remove NotFoundException, buildStyleTag CSS)

---

## NIVEAU 1 — Unit : WorkflowEngine + CostCalculatorEngine (src/)

**Config** : `package.json#jest` → `rootDir: src`, picks `src/**/*.spec.ts`
**Commande** : `npm test`

### src/modules/pricing/__tests__/cost-calculator.engine.spec.ts — 25 tests ✅

| # | Description |
|---|---|
| 1 | computeCosts() — fuelCost = (consumption/100) × distance × fuelPrice |
| 2 | computeCosts() — adBlueCost = fuelVolume × ratio × (adBluePrice/fuelPrice) |
| 3 | computeCosts() — maintenanceCost = maintenanceCostPerKm × distanceKm (km-based ADR-23) |
| 4 | computeCosts() — maintenanceCost = 0 si distance = 0 |
| 5 | computeCosts() — stationFee = stationFeePerDeparture (constant par départ) |
| 6 | computeCosts() — tollFees et driverAllowance = valeurs fixes |
| 7 | computeCosts() — totalVariableCost = somme des 6 coûts variables |
| 8 | computeCosts() — driverDailyCost = salary / avgTripsPerMonth |
| 9 | computeCosts() — insuranceDailyCost = annualInsurance / 365 |
| 10 | computeCosts() — depreciationDaily = (purchase-residual) / years / 365 |
| 11 | computeCosts() — totalCost = totalVariable + totalFixed |
| 12 | computeCosts() — avgTripsPerMonth=0 protégé contre division par zéro |
| 13 | computeCosts() — depreciationYears=0 protégé contre division par zéro |
| 14 | computeCosts() — adBlueCost=0 si adBlueRatioFuel=0 |
| 15 | computeMargins() — operationalMargin = totalRevenue - totalVariableCost |
| 16 | computeMargins() — agencyCommission = ticketRevenue × rate |
| 17 | computeMargins() — netTenantRevenue = totalRevenue - agencyCommission |
| 18 | computeMargins() — netMargin = netTenantRevenue - totalCost |
| 19 | computeMargins() — fillRate = bookedSeats / totalSeats |
| 20 | computeMargins() — fillRate = 0 si totalSeats = 0 |
| 21 | computeMargins() — breakEvenSeats = ceil(totalCost / avgTicketPrice) |
| 22 | computeMargins() — tag PROFITABLE si marge clairement positive |
| 23 | computeMargins() — tag DEFICIT si revenu = 0 |
| 24 | computeMargins() — tag BREAK_EVEN autour du seuil |
| 25 | DEFAULT_BUSINESS_CONSTANTS — valeurs attendues (365, 0.05, 0.03) |

### src/core/workflow/__tests__/workflow.engine.spec.ts — 14 tests ⚠️ (12 PASS / 2 pre-existing failures)

| # | Description |
|---|---|
| 1 | Happy path — retourne toState=BOARDED et incrémente la version |
| 2 | Happy path — appelle persist() une seule fois |
| 3 | Happy path — crée un WorkflowTransition avec l'idempotencyKey |
| 4 | aggregateType inconnu — lève BadRequestException |
| 5 | Config manquante — lève BadRequestException si aucune WorkflowConfig active |
| 6 | Permission manquante — lève ForbiddenException si le rôle ne possède pas la permission |
| 7 | Permission manquante — lève ForbiddenException si scope=agency et agencyId absent |
| 8 | Guards — lève BadRequestException si un guard retourne false |
| 9 | Guards — passe si tous les guards retournent true |
| 10 | Guards — évalue les guards dans l'ordre |
| 11 | Idempotence — retourne l'état existant sans re-persister si clé déjà connue |
| 12 | Lock optimiste — lève ConflictException si version DB ≠ entity.version |
| 13 | Lock optimiste — lève ConflictException si l'entité n'existe plus en DB |
| 14 | Audit — appelle audit.record() avec les bons champs |

---

---

## NIVEAU 1 — Unit : Modules RH & Sécurité (src/ — v5.0)

### src/modules/fleet-docs/__tests__/fleet-docs.service.spec.ts — 14 tests ✅

| # | Description |
|---|---|
| 1 | _computeDocStatus() — MISSING si expiresAt undefined |
| 2 | _computeDocStatus() — EXPIRED si date dans le passé |
| 3 | _computeDocStatus() — EXPIRING si dans la fenêtre d'alerte (15j restants, alert=30j) |
| 4 | _computeDocStatus() — VALID si hors fenêtre d'alerte (60j restants, alert=30j) |
| 5 | _computeDocStatus() — EXPIRING exactement à la limite d'alerte |
| 6 | _computeDocStatus() — VALID un jour avant la fenêtre d'alerte |
| 7 | _computeConsumableStatus() — ALERT si jamais remplacé (null) |
| 8 | _computeConsumableStatus() — OK si très loin du prochain remplacement |
| 9 | _computeConsumableStatus() — ALERT si dans la fenêtre d'alerte |
| 10 | _computeConsumableStatus() — OVERDUE si kilométrage nominal dépassé |
| 11 | _computeConsumableStatus() — OVERDUE exactement à nextDueKm |
| 12 | _computeConsumableStatus() — ALERT exactement à alertAtKm |
| 13 | _computeConsumableStatus() — OK un km avant la fenêtre d'alerte |
| 14 | _computeConsumableStatus() — OK si km actuel < lastReplacedKm (correction odomètre) |

### src/modules/scheduling-guard/__tests__/scheduling-guard.service.spec.ts — 17 tests ✅

| # | Description |
|---|---|
| 1 | Bus — bloque BUS_MAINTENANCE si status=MAINTENANCE_REQUIRED |
| 2 | Bus — bloque BUS_OUT_OF_SERVICE si status=OUT_OF_SERVICE |
| 3 | Bus — bloque BUS_OUT_OF_SERVICE si status=RETIRED |
| 4 | Bus — bloque BUS_OUT_OF_SERVICE si bus introuvable |
| 5 | Bus — bloque BUS_DOCUMENT_EXPIRED si doc obligatoire expiré |
| 6 | Bus — ne bloque pas si bus ACTIVE et aucun doc expiré |
| 7 | Driver — bloque DRIVER_REST_REQUIRED si période ouverte avec temps restant |
| 8 | Driver — ne bloque pas si période de repos terminée (temps écoulé >= minRest) |
| 9 | Driver — ne bloque pas le repos si aucune config tenant |
| 10 | Driver — bloque DRIVER_SUSPENDED si action PENDING |
| 11 | Driver — bloque DRIVER_LICENSE_EXPIRED si aucun permis D/EC/D+E trouvé |
| 12 | Driver — bloque DRIVER_LICENSE_EXPIRED si permis D expiré |
| 13 | Combiné — cumule BUS_MAINTENANCE + DRIVER_SUSPENDED |
| 14 | Combiné — canAssign=true si bus OK et driver OK |
| 15 | Cas vide — canAssign=true si ni busId ni staffId fournis |

### src/modules/crew-briefing/__tests__/crew-briefing.service.spec.ts — 13 tests ✅

| # | Description |
|---|---|
| 1 | createBriefing() — allEquipmentOk=true si tous items OK avec bonne qté |
| 2 | createBriefing() — allEquipmentOk=false si un équipement obligatoire absent |
| 3 | createBriefing() — allEquipmentOk=false si un item est ok=false |
| 4 | createBriefing() — allEquipmentOk=false si qty insuffisante |
| 5 | createBriefing() — recense plusieurs manquants dans missingEquipmentCodes |
| 6 | createBriefing() — publie CREW_BRIEFING_COMPLETED si conforme |
| 7 | createBriefing() — publie CREW_BRIEFING_EQUIPMENT_MISSING si non conforme |
| 8 | createBriefing() — lève NotFoundException si assignment introuvable |
| 9 | createBriefing() — lève BadRequestException si briefing déjà existant |

### src/modules/driver-profile/__tests__/driver-profile.service.spec.ts — 13 tests ✅

| # | Description |
|---|---|
| 1 | _computeLicenseStatus() — EXPIRED si date dans le passé |
| 2 | _computeLicenseStatus() — EXPIRING si dans la fenêtre d'alerte |
| 3 | _computeLicenseStatus() — VALID si hors fenêtre d'alerte |
| 4 | checkRestCompliance() — canDrive=false si période ouverte récente |
| 5 | checkRestCompliance() — canDrive=true si temps de repos déjà dépassé |
| 6 | checkRestCompliance() — canDrive=true si aucun historique (premier trajet) |
| 7 | checkRestCompliance() — canDrive=false si dernier repos trop ancien (> maxDrivingMinutes) |
| 8 | evaluateRemediationForDriver() — tableau vide si aucune règle |
| 9 | evaluateRemediationForDriver() — tableau vide si DB ne retourne aucune règle (seuil non atteint) |
| 10 | evaluateRemediationForDriver() — déclenche règle si score en dessous du seuil |
| 11 | evaluateRemediationForDriver() — ignore doublon (action PENDING existante) |

### src/core/iam/guards/__tests__/module.guard.spec.ts — 8 tests ✅

| # | Description |
|---|---|
| 1 | Laisse passer si @RequireModule absent |
| 2 | Laisse passer sur cache hit active (Redis = '1') |
| 3 | ForbiddenException sur cache hit inactive (Redis = '0') |
| 4 | Laisse passer si DB isActive=true (cache miss) + remplit cache |
| 5 | ForbiddenException si DB isActive=false + remplit cache '0' |
| 6 | ForbiddenException si module absent de la table |
| 7 | ForbiddenException si tenantId manquant sur la requête |
| 8 | invalidateModuleCache() — appelle redis.del avec la bonne clé |

---

## NIVEAU 1 — Unit : State Graph Specs (test/unit/workflow/)

**Config** : `jest.unit.config.ts` → `test/unit/**/*.spec.ts`
**Commande** : `npx jest --config jest.unit.config.ts`

### test/unit/workflow/ticket-graph.spec.ts — 15 tests ✅

| # | Description |
|---|---|
| 1 | TicketState — chaque clé correspond à sa valeur string |
| 2 | TicketState — contient les 8 états obligatoires du PRD §III.7 |
| 3 | TicketAction — chaque action est une chaîne non vide |
| 4 | TicketAction — contient les 5 actions obligatoires du PRD §III.7 |
| 5 | PAY : PENDING_PAYMENT → CONFIRMED — retourne toState=CONFIRMED |
| 6 | PAY — appelle persist() exactement une fois |
| 7 | BOARD : CONFIRMED → BOARDED — retourne toState=BOARDED |
| 8 | CANCEL : CONFIRMED → CANCELLED — retourne toState=CANCELLED |
| 9 | Transition interdite — lève BadRequestException si aucune config active |
| 10 | Permission insuffisante — lève ForbiddenException |
| 11 | Guard expiry — lève BadRequestException si guard retourne false |

### test/unit/workflow/trip-graph.spec.ts — 15 tests ✅

| # | Description |
|---|---|
| 1 | TripState — chaque clé = sa valeur string |
| 2 | TripState — contient les 8 états du PRD §III.7 |
| 3 | TripAction — contient les 9 actions du PRD §III.7 |
| 4 | ACTIVATE : PLANNED → OPEN |
| 5 | START_BOARDING : OPEN → BOARDING |
| 6 | DEPART : BOARDING → IN_PROGRESS |
| 7 | END_TRIP : IN_PROGRESS → COMPLETED |
| 8 | PAUSE : IN_PROGRESS → IN_PROGRESS_PAUSED |
| 9 | RESUME : IN_PROGRESS_PAUSED → IN_PROGRESS |
| 10 | REPORT_INCIDENT : IN_PROGRESS → IN_PROGRESS_DELAYED |
| 11 | CANCEL : PLANNED → CANCELLED |
| 12 | Transition interdite — BadRequestException si aucune config |

### test/unit/workflow/parcel-graph.spec.ts — 14 tests ✅

| # | Description |
|---|---|
| 1 | ParcelState — chaque clé = sa valeur string |
| 2 | ParcelState — contient les 10 états du PRD §III.7 |
| 3 | ParcelAction — contient les 10 actions du PRD §III.7 |
| 4 | RECEIVE : CREATED → AT_ORIGIN (fromState vérifié) |
| 5 | ADD_TO_SHIPMENT : AT_ORIGIN → PACKED |
| 6 | ADD_TO_SHIPMENT — guard poids+destination peut bloquer |
| 7 | LOAD : PACKED → LOADED |
| 8 | DEPART : LOADED → IN_TRANSIT |
| 9 | ARRIVE : IN_TRANSIT → ARRIVED |
| 10 | DELIVER : ARRIVED → DELIVERED |
| 11 | DAMAGE depuis IN_TRANSIT → DAMAGED |
| 12 | DECLARE_LOST : IN_TRANSIT → LOST |
| 13 | RETURN : ARRIVED → RETURNED |
| 14 | Transition interdite (DELIVERED, RECEIVE) — BadRequestException |

### test/unit/workflow/bus-graph.spec.ts — 13 tests ✅

| # | Description |
|---|---|
| 1 | BusState — chaque clé = sa valeur string |
| 2 | BusState — contient les 8 états PRD §III.7 |
| 3 | BusAction — contient les 6 actions PRD §III.7 |
| 4 | OPEN_BOARDING : IDLE → BOARDING |
| 5 | OPEN_BOARDING — guard checklist PRE_DEPARTURE peut bloquer |
| 6 | DEPART : BOARDING → DEPARTED |
| 7 | DEPART — guard manifest clos peut bloquer |
| 8 | ARRIVE : DEPARTED → ARRIVED |
| 9 | CLEAN : ARRIVED → CLOSED |
| 10 | INCIDENT_MECHANICAL depuis BOARDING → MAINTENANCE |
| 11 | INCIDENT_MECHANICAL depuis DEPARTED → MAINTENANCE |
| 12 | RESTORE : MAINTENANCE → AVAILABLE |
| 13 | Transition interdite (CLOSED, DEPART) — BadRequestException |

---

## NIVEAU 1 — Unit : Service Specs (test/unit/services/)

### test/unit/services/ticketing.service.spec.ts — 14 tests ✅

| # | Description |
|---|---|
| 1 | issue() — appelle PricingEngine.calculate() avec les bons paramètres |
| 2 | issue() — crée le ticket avec status=PENDING_PAYMENT |
| 3 | issue() — retourne { ticket, pricing } avec le total calculé |
| 4 | issue() — publie un DomainEvent TICKET_ISSUED |
| 5 | confirm() — délègue au WorkflowEngine avec action=PAY |
| 6 | confirm() — génère un QR token avant la transition |
| 7 | confirm() — lève BadRequestException si ticket expiré |
| 8 | confirm() — lève NotFoundException si ticket absent |
| 9 | validate() — vérifie le QR token avant workflow.transition |
| 10 | validate() — lève BadRequestException si état non validatable |
| 11 | validate() — accepte CHECKED_IN comme état validatable |
| 12 | cancel() — délègue au WorkflowEngine avec action=CANCEL + reason |
| 13 | findOne() — retourne le ticket existant |
| 14 | findOne() — lève NotFoundException si absent |

### test/unit/services/trip.service.spec.ts — 10 tests ✅

| # | Description |
|---|---|
| 1 | create() — crée avec status=PLANNED |
| 2 | create() — convertit departureTime en Date |
| 3 | create() — utilise departureTime comme arrivalScheduled si absent |
| 4 | findAll() — retourne la liste sans filtre |
| 5 | findAll() — filtre par status si fourni |
| 6 | findOne() — retourne le trip existant |
| 7 | findOne() — lève NotFoundException si absent |
| 8 | transition() — délègue au WorkflowEngine avec aggregateType=Trip |
| 9 | transition() — passe l'idempotencyKey au WorkflowEngine |
| 10 | transition() — persist() appelle trip.update() |

### test/unit/services/parcel.service.spec.ts — 13 tests ✅

| # | Description |
|---|---|
| 1 | register() — crée un colis avec status=CREATED |
| 2 | register() — retourne le colis avec un trackingCode |
| 3 | register() — trackingCode inclut préfixe 4 chars du tenantId |
| 4 | register() — publie un event PARCEL_REGISTERED |
| 5 | findOne() — retourne le colis existant |
| 6 | findOne() — lève NotFoundException si absent |
| 7 | trackByCode() — retourne le colis avec destination |
| 8 | trackByCode() — lève NotFoundException si code inconnu |
| 9 | transition() — délègue au WorkflowEngine aggregateType=Parcel |
| 10 | transition() — persist() appelle parcel.update() |
| 11 | scan() — appelle transition() avec l'action fournie |
| 12 | reportDamage() — transition avec action=REPORT_DAMAGE |

### test/unit/services/cashier.service.spec.ts — 10 tests ✅

| # | Description |
|---|---|
| 1 | openRegister() — crée une caisse si aucune ouverte |
| 2 | openRegister() — ConflictException si l'agent a déjà une caisse ouverte |
| 3 | closeRegister() — calcule finalBalance = initial + sum(transactions) |
| 4 | closeRegister() — NotFoundException si caisse absente |
| 5 | closeRegister() — ForbiddenException si scope=agency hors agence |
| 6 | closeRegister() — accepte clôture si scope=agency correspond |
| 7 | closeRegister() — finalBalance = initial si sum=null (0 transactions) |
| 8 | recordTransaction() — crée avec les bons champs |
| 9 | recordTransaction() — crée sans externalRef si non fourni |
| 10 | getDailyReport() — filtre par agencyId et plage 00:00-23:59 |

### test/unit/services/manifest.service.spec.ts — 9 tests ✅

| # | Description |
|---|---|
| 1 | generate() — retourne passengerCount=3 et parcelCount=3 |
| 2 | generate() — retourne status=DRAFT et tripId |
| 3 | generate() — storageKey format tenantId/manifests/tripId/ts.pdf |
| 4 | generate() — appelle IStorageService.getUploadUrl |
| 5 | generate() — retourne uploadUrl du storage |
| 6 | generate() — lève NotFoundException si trip absent |
| 7 | generate() — parcelCount=0 si aucun shipment |
| 8 | sign() — retourne status=SIGNED avec signedById + signedAt |
| 9 | getDownloadUrl() — délègue à IStorageService |

### test/unit/services/profitability.service.spec.ts — 14 tests ✅

| # | Description |
|---|---|
| 1 | upsertCostProfile() — appelle busCostProfile.upsert() avec les bons champs |
| 2 | upsertCostProfile() — lève NotFoundException si bus introuvable |
| 3 | upsertCostProfile() — applique les défauts adBlue et maintenanceCostPerKm |
| 4 | computeAndSnapshot() — retourne le snapshot existant sans recalculer (idempotence) |
| 5 | computeAndSnapshot() — lève NotFoundException si trip introuvable |
| 6 | computeAndSnapshot() — lève BadRequestException si pas de BusCostProfile |
| 7 | computeAndSnapshot() — crée snapshot avec profitabilityTag valide |
| 8 | computeAndSnapshot() — appelle ticket.aggregate et transaction.aggregate |
| 9 | computeAndSnapshot() — utilise DEFAULT_BUSINESS_CONSTANTS si TenantBusinessConfig null |
| 10 | computeAndSnapshot() — appelle tripCostSnapshot.create() une seule fois |
| 11 | getProfitabilitySummary() — retourne totalRevenue et totalCost agrégés |
| 12 | getProfitabilitySummary() — retourne byTag avec count par profitabilityTag |
| 13 | getProfitabilitySummary() — avgFillRate=0 si aucun snapshot |
| 14 | getProfitabilitySummary() — totalOperationalMargin présent dans le résumé |

### test/unit/services/white-label.service.spec.ts — 16 tests ✅

| # | Description |
|---|---|
| 1 | getBrand() — retourne le cache Redis si présent (cache-first) |
| 2 | getBrand() — lit la DB si cache vide |
| 3 | getBrand() — stocke en cache Redis TTL 300s après lecture DB |
| 4 | getBrand() — retourne null si aucune marque configurée |
| 5 | upsert() — appelle tenantBrand.upsert() avec les bons champs |
| 6 | upsert() — invalide le cache après upsert |
| 7 | remove() — supprime la marque et invalide le cache |
| 8 | buildStyleTag() — génère un bloc `<style data-tenant-brand>` valide |
| 9 | buildStyleTag() — inclut customCss si présent |
| 10 | buildStyleTag() — filtre @import dans customCss |
| 11 | buildStyleTag() — filtre url() dans customCss |
| 12 | buildStyleTag() — filtre javascript: dans customCss |
| 13 | buildThemeTokens() — retourne tokens CSS --color-primary et --color-bg |

### test/unit/services/geo-safety.service.spec.ts — 14 tests ✅

| # | Description |
|---|---|
| 1 | reportAlert() avec GPS — appelle GeoSafetyProvider.computeTripGeoScore() |
| 2 | reportAlert() — status=VERIFIED si score ≥ seuil (0.8 ≥ 0.7) |
| 3 | reportAlert() — status=PENDING si score < seuil (0.5 < 0.7) |
| 4 | reportAlert() — publie DomainEvent safety.alert |
| 5 | reportAlert() sans GPS — ne calcule pas de score geo |
| 6 | reportAlert() sans GPS — verificationScore=0 |
| 7 | reportAlert() sans GPS — status=PENDING si score=0 |
| 8 | reportAlert() — lit seuil depuis TenantConfigService (zéro magic-number) |
| 9 | reportAlert() — source=IN_APP |
| 10 | listAlerts() — retourne les alertes du tenant |
| 11 | listAlerts() — filtre par status si fourni |
| 12 | listAlerts() — ne filtre pas par status si absent |
| 13 | dismiss() — met à jour status=DISMISSED |

---

## NIVEAU 2 — E2E : Endpoints (test/e2e/)

**Config** : `jest.e2e.config.ts`
**Commande** : `npm run test:e2e`
**Infrastructure** : NestJS en mémoire, Prisma/Redis/Vault/EventBus mockés, TestAuthGuard

### test/e2e/app.e2e-spec.ts — 111 tests ✅

| Module | Tests | Endpoints couverts |
|--------|-------|--------------------|
| AUTH — PermissionGuard | 3 | 403 sans auth, 200 avec auth, route publique |
| TENANT | 5 | GET list, GET :id, POST create, PATCH suspend |
| TRIP | 5 | GET list, GET :id, GET ?status=, POST create |
| TICKETING | 7 | GET list, GET :id, POST issue, POST verify-qr, POST cancel, GET track/:code |
| FLEET | 7 | GET list, GET :id, POST create, PATCH seat-layout, PATCH status, GET display |
| PARCEL | 6 | POST register, GET :id, POST scan, POST report-damage, GET track/:code |
| CASHIER | 6 | POST open, GET :id, POST transaction, PATCH close, GET daily |
| MANIFEST | 5 | POST generate, PATCH sign, GET download, GET by-trip |
| CREW | 5 | GET list, POST assign, PATCH briefed, DELETE remove |
| FEEDBACK | 4 | POST submit, GET by-trip, GET ratings/DRIVER |
| SAFETY | 4 | POST alert, GET list, PATCH dismiss |
| INCIDENT | 6 | POST create, GET list, GET :id, PATCH assign, PATCH resolve |
| SAV | 6 | POST lost-found, POST claim, GET claims, PATCH process, POST deliver |
| NOTIFICATION | 3 | GET unread, PATCH read |
| ANALYTICS | 6 | GET dashboard, GET trips, GET revenue, GET occupancy, GET top-routes |
| CRM | 5 | GET customers, GET :id, POST campaign, GET campaigns |
| PUBLIC_REPORTER | 3 | POST report (public), GET list |
| IMPERSONATION | 4 | POST initiate, GET active, DELETE revoke |
| TRACKING | 3 | GET position, GET history |
| FLIGHT_DECK | 1 | GET schedule |
| GARAGE | 1 | GET reports |
| DLQ | 1 | GET events |
| STAFF | 1 | GET list |
| TRAVELER | 1 | GET by-trip |
| WORKFLOW | 2 | POST transition |
| DISPLAY | 1 | GET display (public) |
| VALIDATION | 2 | 400 corps invalides |
| RATE_LIMIT | 3 | Guards mockés passent en test |
| WHITE_LABEL | 6 | GET brand, GET style, GET tokens, PUT brand, DELETE brand |
| PRICING | 7 | GET cost-profile, PUT cost-profile, POST snapshot, GET snapshot, GET yield, GET summary |

---

## NIVEAU 3 — Integration : DB réelle Testcontainers

**Config** : `jest.integration.config.ts`
**Commande** : `npm run test:integration`
**Infrastructure** : PostgreSQL Testcontainers, Prisma réel, schema appliqué via `prisma db push`

| Fichier | Tests | Statut |
|---------|-------|--------|
| test/integration/workflow.engine.integration-spec.ts | 6 | ✅ PASS |
| test/integration/sequences/ticket-lifecycle.spec.ts | 9 | ✅ PASS |
| test/integration/sequences/trip-lifecycle.spec.ts | 12 | ✅ PASS |
| test/integration/sequences/parcel-lifecycle.spec.ts | 9 | ✅ PASS |

---

## NIVEAU 1 — Ajouts v6.0 (Sprint 1 Workflow Studio + Sprint 2 Admin Panel)

### src/modules/workflow-studio/__tests__/workflow-studio.service.spec.ts — 13 tests ✅

| # | Description |
|---|---|
| 1 | simulateWorkflow() — retourne le chemin complet quand toutes les transitions réussissent |
| 2 | simulateWorkflow() — stoppe au premier blocage de permission |
| 3 | simulateWorkflow() — retourne reachable=false pour une transition inexistante dans l'état courant |
| 4 | simulateWorkflow() — simule depuis un blueprint (blueprintId fourni) |
| 5 | simulateWorkflow() — lance NotFoundException si blueprintId fourni mais blueprint introuvable |
| 6 | createBlueprint() — crée un blueprint valide |
| 7 | createBlueprint() — lance BadRequestException si slug déjà existant pour ce tenant |
| 8 | createBlueprint() — lance BadRequestException si le graphe est invalide (graphe vide) |
| 9 | getBlueprint() — lance NotFoundException si le blueprint est introuvable |
| 10 | getBlueprint() — retourne le blueprint si accessible |
| 11 | deleteBlueprint() — lance ForbiddenException quand on tente de supprimer un blueprint système |
| 12 | deleteBlueprint() — supprime un blueprint non-système possédé par le tenant |
| 13 | listEntityTypes() — retourne les entityTypes distincts du tenant |

### src/modules/analytics/__tests__/analytics.service.spec.ts — 4 tests ✅

| # | Description |
|---|---|
| 1 | getDashboard() — retourne les agrégats corrects pour un tenant |
| 2 | getDashboard() — retourne revenue.total=0 quand transaction.aggregate retourne null |
| 3 | getDashboard() — filtre les tickets/transactions par agencyId quand le scope est agency |
| 4 | getDashboard() — ne filtre pas par agencyId quand l'agencyId n'est pas fourni |

### src/modules/pricing/__tests__/profitability.service.spec.ts — 7 tests ✅

| # | Description |
|---|---|
| 1 | getProfitabilitySummary() — retourne les agrégats corrects sur une période avec données |
| 2 | getProfitabilitySummary() — calcule globalNetMarginRate = totalNetMargin / totalCost |
| 3 | getProfitabilitySummary() — retourne globalNetMarginRate=0 quand totalCost=0 |
| 4 | getProfitabilitySummary() — agrège correctement les counts par tag |
| 5 | getProfitabilitySummary() — retourne zéros et byTag vide quand aucun snapshot sur la période |
| 6 | getProfitabilitySummary() — retourne la période passée en paramètre |
| 7 | upsertCostProfile() — lance NotFoundException si le bus est introuvable |

### src/modules/white-label/__tests__/white-label.service.spec.ts — 9 tests ✅

| # | Description |
|---|---|
| 1 | getBrand() — retourne le brand depuis le cache Redis si présent |
| 2 | getBrand() — charge depuis la DB si pas de cache et met en cache (TTL 300s) |
| 3 | getBrand() — retourne les valeurs par défaut si aucun TenantBrand en DB |
| 4 | upsert() — invalide le cache après mise à jour |
| 5 | upsert() — appelle prisma.tenantBrand.upsert avec les données du DTO |
| 6 | remove() — lance NotFoundException si aucune config de marque pour ce tenant |
| 7 | remove() — invalide le cache après suppression |
| 8 | buildStyleTag() — génère un bloc `<style>` avec les CSS custom properties |
| 9 | buildStyleTag() — injecte le customCss du tenant après les variables |

---

## Roadmap tests

| Break | Contenu | Statut |
|-------|---------|--------|
| BREAK 1 | Structure dossiers, jest.unit.config.ts | ✅ FAIT |
| BREAK 2 | 4 State Graph Specs (ticket, trip, parcel, bus) | ✅ FAIT |
| BREAK 3 | 6 Service Specs (ticketing, trip, parcel, cashier, manifest, safety) | ✅ FAIT |
| BREAK 4 | Setup integration : Testcontainers + seed + jest.integration.config.ts | ✅ FAIT |
| BREAK 5 | 4 Integration Specs : engine + 3 lifecycles | ✅ FAIT |
| BREAK 6 | Validation finale : unit + integration + e2e = 0 failure | ✅ FAIT |
| **BREAK 7 — v4.0** | CostCalculatorEngine pure spec (25 tests) + ProfitabilityService spec (14) + WhiteLabelService spec (16) + e2e sections 29-30 (13 tests) | ✅ FAIT |
| **BREAK 8 — v5.0** | FleetDocsService spec (14) + SchedulingGuardService spec (17) + CrewBriefingService spec (13) + DriverProfileService spec (13) + ModuleGuard spec (8) = 65 nouveaux tests | ✅ FAIT |
| **BREAK 9 — v6.0** | WorkflowStudioService spec (13) + AnalyticsService spec (4) + ProfitabilityService spec (7) + WhiteLabelService spec (9) = 33 nouveaux tests | ✅ FAIT |
