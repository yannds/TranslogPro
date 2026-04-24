# Briefing pré-voyage QHSE — Architecture & opérations

> Refonte 2026-04-24 : passage d'une checklist équipement-seule à un briefing
> multi-chapitres tenant-configurable, avec double signature et alertes
> sécurité immuables.

## Objectif produit

Le briefing pré-voyage est **fortement recommandé mais non bloquant par
défaut**. Il sert de **traçabilité QHSE** en cas d'accident : le record
(items cochés + signature + GPS + repos conducteur) fait foi.

Chaque tenant configure :
- Les **items obligatoires vs facultatifs** (catalogue template-driven).
- La **politique de blocage** (aucun blocage, alerte manager, blocage strict
  avec override justifié).
- Les **méthodes de signature** autorisées (dessin / PIN / biométrie).
- La **politique de repos conducteur** (seuil en heures, comportement si KO).

## Architecture data

### Schéma Prisma — 4 nouveaux modèles

- `BriefingTemplate` : un tenant peut posséder plusieurs (urbain, longue
  distance, fret). Un seul `isDefault=true` actif.
- `BriefingSection` : chapitre (code stable UPPER_SNAKE, ordre, titres fr/en).
- `BriefingItem` : unité cochable — 5 `kind` supportés :
  - `CHECK` : case à cocher (oui/non)
  - `QUANTITY` : matériel avec `requiredQty` vs qty saisie
  - `DOCUMENT` : présence d'un document à bord
  - `ACKNOWLEDGE` : annonce faite aux passagers
  - `INFO` : auto-calculé côté serveur — `autoSource` ∈ {`DRIVER_REST_HOURS`,
    `WEATHER`, `MANIFEST_LOADED`, `ROUTE_CONFIRMED`}
- `TripSafetyAlert` : incident immuable attaché à un trip. Émis par le
  briefing (mandatory KO, repos insuffisant), mais aussi futurs consommateurs
  (incidents, conformité). Résolution one-shot avec note.

### Enrichissement des modèles existants

- `CrewBriefingRecord` : ajout `templateId`, `acknowledgedByDriverId`,
  `driverSignedAt`, `driverSignatureMethod` (PIN/DRAW/BIOMETRIC),
  `driverSignatureBlob`, `coPilotSignedById/At`, `restHoursSnapshot`,
  `overrideReason`, `overriddenById`, `overriddenAt`, `anomaliesCount`.
  L'ancien `allEquipmentOk` reste pour rétro-compat.
- `CrewAssignment` : ajout `briefingOverrideById/Reason/At`.
- `TenantBusinessConfig` : +4 colonnes `preTripBriefingPolicy`,
  `mandatoryItemFailurePolicy`, `restShortfallPolicy`, `minDriverRestHours`
  (défaut 11h — réglementation UE transport routier).

### Platform-config registry

Défauts seedés au provisioning tenant :
`briefing.defaults.{preTripPolicy,mandatoryFailurePolicy,restShortfallPolicy,minDriverRestHours}`.

## Politiques tenant

Trois verrous indépendants dans `TenantBusinessConfig` :

| Clé | Valeurs | Effet |
|-----|---------|-------|
| `preTripBriefingPolicy` | `OFF` · `RECOMMENDED` (défaut) · `RECOMMENDED_WITH_ALERT` | `OFF` : module désactivé. `RECOMMENDED` : briefing tracé sans alerte. `_WITH_ALERT` : alerte émise si trip démarre sans briefing. |
| `mandatoryItemFailurePolicy` | `WARN_ONLY` (défaut) · `ALERT_MANAGER` · `BLOCK_DEPARTURE` | Comportement si un `BriefingItem.isMandatory=true` est coché KO. `BLOCK` refuse la signature sauf override manager avec `overrideReason` + `overriddenById`. |
| `restShortfallPolicy` | `WARN` (défaut) · `ALERT` · `BLOCK` | Comportement si repos < `minDriverRestHours` (calculé depuis dernier trip terminé). |

## Flux de signature (v2)

```
Chauffeur ouvre PageDriverBriefing / BriefingScreen mobile
  └─ GET /tenants/:t/crew-briefing/templates/default
  └─ UI rend sections actives triées par `order`
  └─ Chauffeur coche items (QUANTITY → saisir qty, INFO → auto)
  └─ Signature via BriefingSignatureInput (web) / MobileSignatureInput (mobile)
      ├─ DRAW : SVG string (canvas web ou SVG natif mobile)
      ├─ PIN : sha-256 hex de 4-8 chiffres
      └─ BIOMETRIC : WebAuthn id (web) / expo-local-auth token (mobile)
  └─ POST /tenants/:t/crew-briefing/briefings/v2
      { assignmentId, templateId, conductedById, items[], driverSignature,
        coPilotSignature?, briefingNotes?, gpsLat/Lng?, overrideReason?, overriddenById? }

Backend (CrewBriefingService.createBriefingV2) :
  1. Scope 'own' : rejette si conductedById ≠ acteur (403)
  2. Résolution assignment (synthetic "driver-<tripId>" supporté)
  3. Rejet doublon : un briefing par CrewAssignment (400)
  4. Chargement template + items actifs
  5. Items auto-calculés INFO :
      - DRIVER_REST_HOURS via DriverRestCalculatorService
      - MANIFEST_LOADED via count manifest status ∈ {LOADED, PUBLISHED, CLOSED}
      - ROUTE_CONFIRMED via trip.route présent
      - WEATHER : placeholder (futur)
  6. Calcul anomalies : items mandatory KO ou qty < requiredQty
  7. Politique BLOCK → 403 sans override complet (reason + managerId)
  8. Écriture CrewBriefingRecord + update CrewAssignment.briefedAt
  9. Émission alertes sécurité :
      - MANDATORY_ITEM_FAILED (1 par item KO) si policy ∈ {ALERT, BLOCK}
      - DRIVER_REST_SHORTFALL si policy restShortfall ∈ {ALERT, BLOCK}
 10. Publish events :
      - briefing.signed (systématique)
      - briefing.override.applied (si override)
```

## Sécurité

- **Tenant-scoped racine** : toutes les requêtes Prisma ont `where.tenantId`.
- **Scope 'own'** : un chauffeur ne peut signer pour quelqu'un d'autre.
- **Alertes immuables** : seul `resolvedAt/By/Note` est mutable. Pas de
  réouverture (BadRequestException sur double-resolve).
- **Override BLOCK_DEPARTURE** : requiert `reason` ET `managerId` ensemble —
  override partiel refusé.
- **Signature blob** : stocké `@db.Text`, aucune manipulation serveur (byte-
  for-byte preservé) pour garantir la propriété récursive.

## Permissions RBAC (13 nouvelles)

```
data.briefing.template.read.tenant
control.briefing.template.manage.tenant
data.briefing.sign.own
data.briefing.sign.delegate.agency
data.briefing.read.agency
data.briefing.read.tenant
control.briefing.override.tenant
data.safety_alert.read.agency
data.safety_alert.read.tenant
control.safety_alert.resolve.agency
control.safety_alert.resolve.tenant
```

Bindings rôles par défaut (`prisma/seeds/iam.seed.ts`) :

| Rôle | Perms |
|------|-------|
| `TENANT_ADMIN` | template.manage + read.tenant + override + safety.{read,resolve}.tenant |
| `AGENCY_MANAGER` | template.read + sign.delegate + read.agency + safety.{read,resolve}.agency |
| `DRIVER` | sign.own + template.read.tenant + safety.read.agency |

## Signature dessin — test récursif obligatoire

> **Règle projet (mémoire feedback)** : la capture dessin a historiquement
> cassé ; tout PR qui touche une signature dessinée doit passer un test
> récursif **trace → save → reload → rendu** avant livraison.

Le test Playwright
[`test/playwright/briefing-signature-recursive.api.spec.ts`](../test/playwright/briefing-signature-recursive.api.spec.ts)
couvre cette propriété au niveau API : POST `/briefings/v2` avec SVG complexe
→ GET `/briefings/assignment/:id` → assert blob byte-for-byte identique.

Pour valider aussi le wiring UI complet (canvas → dataURL → POST → reload
→ rendu SVG) :

```bash
# Web
cd frontend && npm run dev
# Naviguer /driver/briefing, tracer signature, signer, recharger la page,
# vérifier badge "Conforme" dans "Mes briefings récents".

# Mobile
cd mobile/translog-mobile && npx expo start
# Scan QR, ouvrir driver briefing, tracer au doigt, signer,
# revenir sur trip, vérifier que l'écran pousse BOARDING.
```

## Files touchés

### Backend
- `prisma/schema.prisma` : +4 modèles, +18 colonnes
- `prisma/seeds/briefing-template.seed.ts` : seed 8 chapitres × 41 items
- `src/common/constants/permissions.ts` : +13 permissions
- `src/common/types/domain-event.type.ts` : +4 events
- `src/modules/crew-briefing/` :
  - `briefing-template.service.ts` (nouveau)
  - `driver-rest-calculator.service.ts` (nouveau)
  - `trip-safety-alert.service.ts` (nouveau)
  - `crew-briefing.service.ts` (refactor v2 + legacy v1 préservé)
  - `crew-briefing.controller.ts` (refactor +17 endpoints)
  - `dto/briefing-template.dto.ts` + `dto/briefing-v2.dto.ts` (nouveaux)
- `src/modules/platform-config/platform-config.registry.ts` : +4 clés

### Frontend web
- `frontend/components/pages/PageBriefingTemplate.tsx` (nouveau)
- `frontend/components/pages/PageTripSafetyAlerts.tsx` (nouveau)
- `frontend/components/pages/PageDriverBriefing.tsx` (refonte v2)
- `frontend/components/pages/PageTenantBusinessRules.tsx` : section Briefing
- `frontend/components/ui/BriefingSignatureInput.tsx` (nouveau)
- `frontend/lib/i18n/locales/{fr,en}.ts` : +3 namespaces (briefingTemplate,
  safetyAlerts) + extension driverBriefing, tenantRules
- `frontend/lib/navigation/nav.config.ts` : 2 nouveaux items + 13 perms
- `frontend/components/dashboard/PageRouter.tsx` : 2 nouvelles routes

### Mobile
- `mobile/translog-mobile/src/ui/MobileSignatureInput.tsx` (nouveau)
- `mobile/translog-mobile/src/driver/BriefingScreen.tsx` (refonte v2)

### Tests
- `test/unit/crew-briefing/` : 5 specs (39 tests, 100 % pass)
- `test/security/briefing-isolation.spec.ts` : 11 tests cross-tenant + scope
- `test/playwright/briefing-signature-recursive.api.spec.ts` : 4 tests E2E
  (signature récursive DRAW/PIN + policy BLOCK + override)

## Historique commits

```
1c4c95f  feat(briefing): sprint 1 — schéma QHSE multi-chapitres + template seed
52053db  feat(briefing): sprint 2 — services QHSE (template, rest, safety alert, v2)
a21d1aa  feat(briefing): sprint 3 — RBAC + endpoints v2 + DTOs + security tests
0fb0832  feat(briefing): sprint 4 — web admin (templates, safety alerts, policies)
7b9b779  feat(briefing): sprint 5 — web chauffeur v2 (signature multi-méthodes)
dfa64d6  feat(briefing): sprint 6 — mobile unifié briefing v2 (3 signature methods)
```
