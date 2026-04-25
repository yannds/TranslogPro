# Audit endpoints — TransLog Pro

_Généré le 2026-04-25 par `scripts/audit-endpoints.py`. Reproduire : `python3 scripts/audit-endpoints.py`._

## Résumé

| Métrique | Valeur |
|---|---|
| Routes backend total | **515** |
| Routes **montées** (match strict verb+path) | **380** |
| Routes **probablement montées** (trace littérale trouvée dans FE) | **8** |
| Routes **vraiment orphelines** (zéro trace FE) | **127** |
| Appels FE **sans route BE** correspondante | **50** |

> **Lecture** : seuls les items de la §1 sont à traiter (vraiment orphelins, zéro référence FE). Les items §2 sont probablement consommés par `window.open`, `<a href>`, ternary, ou un service client abstrait — vérifier si un doute subsiste.

## 1 · Routes backend vraiment orphelines (zéro trace FE)

- Avec motif légitime no-UI : **6**
- **À vérifier manuellement** : **121**

### 1.1 · `templates` (16 routes)

| Verb | Route | Source |
|---|---|---|
| `POST` | `/tenants/:tenantId/templates` | [templates.controller.ts:18](src/modules/templates/templates.controller.ts#L18) |
| `GET` | `/tenants/:tenantId/templates` | [templates.controller.ts:28](src/modules/templates/templates.controller.ts#L28) |
| `GET` | `/tenants/:tenantId/templates/:id` | [templates.controller.ts:36](src/modules/templates/templates.controller.ts#L36) |
| `GET` | `/tenants/:tenantId/templates/:id` | [templates.controller.ts:50](src/modules/templates/templates.controller.ts#L50) |
| `GET` | `/tenants/:tenantId/templates/:id` | [templates.controller.ts:86](src/modules/templates/templates.controller.ts#L86) |
| `PUT` | `/tenants/:tenantId/templates/:id` | [templates.controller.ts:92](src/modules/templates/templates.controller.ts#L92) |
| `DELETE` | `/tenants/:tenantId/templates/:id` | [templates.controller.ts:103](src/modules/templates/templates.controller.ts#L103) |
| `POST` | `/tenants/:tenantId/templates/:id/duplicate` | [templates.controller.ts:123](src/modules/templates/templates.controller.ts#L123) |
| `GET` | `/tenants/:tenantId/templates/:id/preview` | [templates.controller.ts:52](src/modules/templates/templates.controller.ts#L52) |
| `PUT` | `/tenants/:tenantId/templates/:id/schema` | [templates.controller.ts:157](src/modules/templates/templates.controller.ts#L157) |
| `GET` | `/tenants/:tenantId/templates/:id/schema` | [templates.controller.ts:172](src/modules/templates/templates.controller.ts#L172) |
| `PATCH` | `/tenants/:tenantId/templates/:id/set-default` | [templates.controller.ts:70](src/modules/templates/templates.controller.ts#L70) |
| `PATCH` | `/tenants/:tenantId/templates/:id/unset-default` | [templates.controller.ts:80](src/modules/templates/templates.controller.ts#L80) |
| `GET` | `/tenants/:tenantId/templates/:id/upload-url` | [templates.controller.ts:111](src/modules/templates/templates.controller.ts#L111) |
| `POST` | `/tenants/:tenantId/templates/restore-starter-pack` | [templates.controller.ts:141](src/modules/templates/templates.controller.ts#L141) |
| `GET` | `/tenants/:tenantId/templates/system` | [templates.controller.ts:38](src/modules/templates/templates.controller.ts#L38) |

### 1.2 · `documents` (12 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/tenants/:tenantId/documents/parcels/:parcelId/invoice` | [documents.controller.ts:107](src/modules/documents/documents.controller.ts#L107) |
| `GET` | `/tenants/:tenantId/documents/parcels/:parcelId/label` | [documents.controller.ts:69](src/modules/documents/documents.controller.ts#L69) |
| `POST` | `/tenants/:tenantId/documents/parcels/multi-label` | [documents.controller.ts:167](src/modules/documents/documents.controller.ts#L167) |
| `GET` | `/tenants/:tenantId/documents/shipments/:shipmentId/envelope` | [documents.controller.ts:206](src/modules/documents/documents.controller.ts#L206) |
| `GET` | `/tenants/:tenantId/documents/shipments/:shipmentId/packing-list` | [documents.controller.ts:81](src/modules/documents/documents.controller.ts#L81) |
| `GET` | `/tenants/:tenantId/documents/tickets/:ticketId/baggage-tag` | [documents.controller.ts:182](src/modules/documents/documents.controller.ts#L182) |
| `GET` | `/tenants/:tenantId/documents/tickets/:ticketId/invoice` | [documents.controller.ts:95](src/modules/documents/documents.controller.ts#L95) |
| `GET` | `/tenants/:tenantId/documents/tickets/:ticketId/invoice-pro` | [documents.controller.ts:137](src/modules/documents/documents.controller.ts#L137) |
| `GET` | `/tenants/:tenantId/documents/tickets/:ticketId/print` | [documents.controller.ts:36](src/modules/documents/documents.controller.ts#L36) |
| `GET` | `/tenants/:tenantId/documents/tickets/:ticketId/stub` | [documents.controller.ts:152](src/modules/documents/documents.controller.ts#L152) |
| `GET` | `/tenants/:tenantId/documents/trips/:tripId/manifest/print` | [documents.controller.ts:55](src/modules/documents/documents.controller.ts#L55) |
| `GET` | `/tenants/:tenantId/documents/trips/:tripId/passengers/excel` | [documents.controller.ts:121](src/modules/documents/documents.controller.ts#L121) |

### 1.3 · `qhse` (10 routes)

| Verb | Route | Source |
|---|---|---|
| `POST` | `/tenants/:tenantId/qhse/accidents/:id/photo-url` | [qhse.controller.ts:112](src/modules/qhse/qhse.controller.ts#L112) |
| `POST` | `/tenants/:tenantId/qhse/dispute-expenses/:id/upload-url` | [qhse.controller.ts:246](src/modules/qhse/qhse.controller.ts#L246) |
| `PATCH` | `/tenants/:tenantId/qhse/disputes/:id` | [qhse.controller.ts:226](src/modules/qhse/qhse.controller.ts#L226) |
| `POST` | `/tenants/:tenantId/qhse/disputes/:id/expenses` | [qhse.controller.ts:236](src/modules/qhse/qhse.controller.ts#L236) |
| `GET` | `/tenants/:tenantId/qhse/disputes/:id/summary` | [qhse.controller.ts:255](src/modules/qhse/qhse.controller.ts#L255) |
| `POST` | `/tenants/:tenantId/qhse/executions/:executionId/steps/:stepId/photo-url` | [qhse.controller.ts:325](src/modules/qhse/qhse.controller.ts#L325) |
| `GET` | `/tenants/:tenantId/qhse/executions/:id` | [qhse.controller.ts:316](src/modules/qhse/qhse.controller.ts#L316) |
| `POST` | `/tenants/:tenantId/qhse/follow-ups/:id/upload-url` | [qhse.controller.ts:169](src/modules/qhse/qhse.controller.ts#L169) |
| `POST` | `/tenants/:tenantId/qhse/injuries/:id/follow-ups` | [qhse.controller.ts:159](src/modules/qhse/qhse.controller.ts#L159) |
| `POST` | `/tenants/:tenantId/qhse/third-parties/:id/statement-url` | [qhse.controller.ts:136](src/modules/qhse/qhse.controller.ts#L136) |

### 1.4 · `driver-profile` (6 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/tenants/:tenantId/driver-profile/drivers/:staffId/remediation/actions` | [driver-profile.controller.ts:343](src/modules/driver-profile/driver-profile.controller.ts#L343) |
| `POST` | `/tenants/:tenantId/driver-profile/drivers/:staffId/remediation/evaluate` | [driver-profile.controller.ts:333](src/modules/driver-profile/driver-profile.controller.ts#L333) |
| `GET` | `/tenants/:tenantId/driver-profile/drivers/:staffId/trainings` | [driver-profile.controller.ts:278](src/modules/driver-profile/driver-profile.controller.ts#L278) |
| `POST` | `/tenants/:tenantId/driver-profile/licenses/:id/upload-url` | [driver-profile.controller.ts:145](src/modules/driver-profile/driver-profile.controller.ts#L145) |
| `PATCH` | `/tenants/:tenantId/driver-profile/remediation/actions/:id` | [driver-profile.controller.ts:352](src/modules/driver-profile/driver-profile.controller.ts#L352) |
| `POST` | `/tenants/:tenantId/driver-profile/trainings/:id/upload-url` | [driver-profile.controller.ts:269](src/modules/driver-profile/driver-profile.controller.ts#L269) |

### 1.5 · `traveler` (6 routes)

| Verb | Route | Source |
|---|---|---|
| `POST` | `/tenants/:tenantId/travelers/:id/scan-board` | [traveler.controller.ts:38](src/modules/traveler/traveler.controller.ts#L38) |
| `POST` | `/tenants/:tenantId/travelers/:id/scan-in` | [traveler.controller.ts:26](src/modules/traveler/traveler.controller.ts#L26) |
| `POST` | `/tenants/:tenantId/travelers/:id/scan-out` | [traveler.controller.ts:50](src/modules/traveler/traveler.controller.ts#L50) |
| `POST` | `/tenants/:tenantId/travelers/:id/verify` | [traveler.controller.ts:14](src/modules/traveler/traveler.controller.ts#L14) |
| `GET` | `/tenants/:tenantId/travelers/trips/:tripId` | [traveler.controller.ts:61](src/modules/traveler/traveler.controller.ts#L61) |
| `GET` | `/tenants/:tenantId/travelers/trips/:tripId/drop-off/:stationId` | [traveler.controller.ts:71](src/modules/traveler/traveler.controller.ts#L71) |

### 1.6 · `crew-briefing` (6 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/tenants/:tenantId/crew-briefing/briefings/assignment/:assignmentId` | [crew-briefing.controller.ts:101](src/modules/crew-briefing/crew-briefing.controller.ts#L101) |
| `PATCH` | `/tenants/:tenantId/crew-briefing/equipment-types/:id` | [crew-briefing.controller.ts:77](src/modules/crew-briefing/crew-briefing.controller.ts#L77) |
| `PATCH` | `/tenants/:tenantId/crew-briefing/safety-alerts/:alertId/resolve` | [crew-briefing.controller.ts:277](src/modules/crew-briefing/crew-briefing.controller.ts#L277) |
| `POST` | `/tenants/:tenantId/crew-briefing/sections/:sectionId/items` | [crew-briefing.controller.ts:207](src/modules/crew-briefing/crew-briefing.controller.ts#L207) |
| `POST` | `/tenants/:tenantId/crew-briefing/templates/:templateId/duplicate` | [crew-briefing.controller.ts:174](src/modules/crew-briefing/crew-briefing.controller.ts#L174) |
| `POST` | `/tenants/:tenantId/crew-briefing/templates/:templateId/sections` | [crew-briefing.controller.ts:186](src/modules/crew-briefing/crew-briefing.controller.ts#L186) |

### 1.7 · `public-portal` (5 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/public/:tenantSlug/portal/announcements` | [public-portal.controller.ts:95](src/modules/public-portal/public-portal.controller.ts#L95) |
| `GET` | `/public/:tenantSlug/portal/footer-pages` | [public-portal.controller.ts:176](src/modules/public-portal/public-portal.controller.ts#L176) |
| `GET` | `/public/:tenantSlug/portal/pages/:pageSlug` | [public-portal.controller.ts:133](src/modules/public-portal/public-portal.controller.ts#L133) |
| `POST` | `/public/:tenantSlug/portal/tickets/:ticketRef/cancel` | [public-portal.controller.ts:213](src/modules/public-portal/public-portal.controller.ts#L213) |
| `GET` | `/public/:tenantSlug/portal/tickets/:ticketRef/refund-preview` | [public-portal.controller.ts:195](src/modules/public-portal/public-portal.controller.ts#L195) |

### 1.8 · `sav` (5 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/tenants/:tenantId/sav/claims/:id` | [sav.controller.ts:50](src/modules/sav/sav.controller.ts#L50) |
| `POST` | `/tenants/:tenantId/sav/claims/:id/deliver` | [sav.controller.ts:75](src/modules/sav/sav.controller.ts#L75) |
| `PATCH` | `/tenants/:tenantId/sav/claims/:id/process` | [sav.controller.ts:60](src/modules/sav/sav.controller.ts#L60) |
| `POST` | `/tenants/:tenantId/sav/lost-found` | [sav.controller.ts:20](src/modules/sav/sav.controller.ts#L20) |
| `GET` | `/tenants/:tenantId/sav/refunds/:id` | [sav.controller.ts:89](src/modules/sav/sav.controller.ts#L89) |

### 1.9 · `analytics` (5 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/tenants/:tenantId/analytics/dashboard` | [analytics.controller.ts:63](src/modules/analytics/analytics.controller.ts#L63) |
| `GET` | `/tenants/:tenantId/analytics/export/tickets` | [analytics.controller.ts:250](src/modules/analytics/analytics.controller.ts#L250) |
| `GET` | `/tenants/:tenantId/analytics/revenue` | [analytics.controller.ts:105](src/modules/analytics/analytics.controller.ts#L105) |
| `GET` | `/tenants/:tenantId/analytics/trips` | [analytics.controller.ts:90](src/modules/analytics/analytics.controller.ts#L90) |
| `GET` | `/tenants/:tenantId/analytics/trips/:tripId/occupancy` | [analytics.controller.ts:120](src/modules/analytics/analytics.controller.ts#L120) |

### 1.10 · `fleet-docs` (4 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/tenants/:tenantId/fleet-docs/buses/:busId/documents` | [fleet-docs.controller.ts:70](src/modules/fleet-docs/fleet-docs.controller.ts#L70) |
| `GET` | `/tenants/:tenantId/fleet-docs/maintenance/:reportId/detail` | [fleet-docs.controller.ts:146](src/modules/fleet-docs/fleet-docs.controller.ts#L146) |
| `POST` | `/tenants/:tenantId/fleet-docs/maintenance/:reportId/intervenants` | [fleet-docs.controller.ts:124](src/modules/fleet-docs/fleet-docs.controller.ts#L124) |
| `POST` | `/tenants/:tenantId/fleet-docs/maintenance/:reportId/parts` | [fleet-docs.controller.ts:135](src/modules/fleet-docs/fleet-docs.controller.ts#L135) |

### 1.11 · `staff` (4 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/tenants/:tenantId/assignments` | [staff-assignment.controller.ts:48](src/modules/staff/staff-assignment.controller.ts#L48) |
| `PATCH` | `/tenants/:tenantId/assignments/:id` | [staff-assignment.controller.ts:62](src/modules/staff/staff-assignment.controller.ts#L62) |
| `POST` | `/tenants/:tenantId/assignments/:id/agencies` | [staff-assignment.controller.ts:80](src/modules/staff/staff-assignment.controller.ts#L80) |
| `DELETE` | `/tenants/:tenantId/assignments/:id/agencies/:agencyId` | [staff-assignment.controller.ts:90](src/modules/staff/staff-assignment.controller.ts#L90) |

### 1.12 · `workflow-studio` (4 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/tenants/:tenantId/workflow-marketplace/blueprints/:blueprintId/export` | [workflow-marketplace.controller.ts:48](src/modules/workflow-studio/workflow-marketplace.controller.ts#L48) |
| `POST` | `/tenants/:tenantId/workflow-marketplace/blueprints/:blueprintId/publish` | [workflow-marketplace.controller.ts:68](src/modules/workflow-studio/workflow-marketplace.controller.ts#L68) |
| `DELETE` | `/tenants/:tenantId/workflow-marketplace/blueprints/:blueprintId/publish` | [workflow-marketplace.controller.ts:78](src/modules/workflow-studio/workflow-marketplace.controller.ts#L78) |
| `POST` | `/tenants/:tenantId/workflow-studio/graph/:entityType/reset` | [workflow-studio.controller.ts:83](src/modules/workflow-studio/workflow-studio.controller.ts#L83) |

### 1.13 · `cashier` (3 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/tenants/:tenantId/cashier/registers/:id` | [cashier.controller.ts:99](src/modules/cashier/cashier.controller.ts#L99) |
| `GET` | `/tenants/:tenantId/cashier/report/daily` | [cashier.controller.ts:109](src/modules/cashier/cashier.controller.ts#L109) |
| `PATCH` | `/tenants/:tenantId/cashier/transactions/:txId/verify-proof` | [cashier.controller.ts:150](src/modules/cashier/cashier.controller.ts#L150) |

### 1.14 · `feedback` (3 routes)

| Verb | Route | Source |
|---|---|---|
| `POST` | `/tenants/:tenantId/feedback` | [feedback.controller.ts:12](src/modules/feedback/feedback.controller.ts#L12) |
| `GET` | `/tenants/:tenantId/feedback/ratings/:entityType/:entityId` | [feedback.controller.ts:28](src/modules/feedback/feedback.controller.ts#L28) |
| `GET` | `/tenants/:tenantId/feedback/trip/:tripId` | [feedback.controller.ts:22](src/modules/feedback/feedback.controller.ts#L22) |

### 1.15 · `safety` (3 routes)

| Verb | Route | Source |
|---|---|---|
| `POST` | `/tenants/:tenantId/safety/alerts` | [safety.controller.ts:17](src/modules/safety/safety.controller.ts#L17) |
| `GET` | `/tenants/:tenantId/safety/alerts` | [safety.controller.ts:36](src/modules/safety/safety.controller.ts#L36) |
| `PATCH` | `/tenants/:tenantId/safety/alerts/:id/dismiss` | [safety.controller.ts:45](src/modules/safety/safety.controller.ts#L45) |

### 1.16 · `tracking` (3 routes)

| Verb | Route | Source |
|---|---|---|
| `POST` | `/tenants/:tenantId/tracking/trips/:tripId/gps` | [tracking.controller.ts:12](src/modules/tracking/tracking.controller.ts#L12) |
| `GET` | `/tenants/:tenantId/tracking/trips/:tripId/history` | [tracking.controller.ts:35](src/modules/tracking/tracking.controller.ts#L35) |
| `GET` | `/tenants/:tenantId/tracking/trips/:tripId/position` | [tracking.controller.ts:25](src/modules/tracking/tracking.controller.ts#L25) |

### 1.17 · `garage` (3 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/tenants/:tenantId/garage/buses/:busId/reports` | [garage.controller.ts:108](src/modules/garage/garage.controller.ts#L108) |
| `POST` | `/tenants/:tenantId/garage/reminders/:busId/:type/performed` | [garage.controller.ts:32](src/modules/garage/garage.controller.ts#L32) |
| `GET` | `/tenants/:tenantId/garage/reports/:id/upload-url` | [garage.controller.ts:88](src/modules/garage/garage.controller.ts#L88) |

### 1.18 · `infra/payment` (2 routes)

| Verb | Route | Source |
|---|---|---|
| `POST` | `/tenants/:tenantId/payments/intents/:intentId/cancel` | [payment.controller.ts:103](src/infrastructure/payment/payment.controller.ts#L103) |
| `POST` | `/tenants/:tenantId/payments/intents/:intentId/refund` | [payment.controller.ts:121](src/infrastructure/payment/payment.controller.ts#L121) |

### 1.19 · `oauth` (2 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/auth/oauth/:providerKey/callback` | [oauth.controller.ts:93](src/modules/oauth/oauth.controller.ts#L93) |
| `GET` | `/auth/oauth/:providerKey/start` | [oauth.controller.ts:63](src/modules/oauth/oauth.controller.ts#L63) |

### 1.20 · `notification` (2 routes)

| Verb | Route | Source |
|---|---|---|
| `PATCH` | `/tenants/:tenantId/notifications/:id/read` | [notification.controller.ts:23](src/modules/notification/notification.controller.ts#L23) |
| `GET` | `/tenants/:tenantId/notifications/unread` | [notification.controller.ts:14](src/modules/notification/notification.controller.ts#L14) |

### 1.21 · `manifest` (2 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/tenants/:tenantId/manifests/:id` | [manifest.controller.ts:103](src/modules/manifest/manifest.controller.ts#L103) |
| `POST` | `/tenants/:tenantId/manifests/backfill-signed-pdfs` | [manifest.controller.ts:117](src/modules/manifest/manifest.controller.ts#L117) |

### 1.22 · `crm` (2 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/tenants/:tenantId/crm/contacts/:customerId/recommendations` | [crm.controller.ts:48](src/modules/crm/crm.controller.ts#L48) |
| `POST` | `/tenants/:tenantId/crm/segments/recompute` | [crm.controller.ts:79](src/modules/crm/crm.controller.ts#L79) |

### 1.23 · `flight-deck` (2 routes)

| Verb | Route | Source |
|---|---|---|
| `POST` | `/tenants/:tenantId/flight-deck/trips/:tripId/freight/close` | [flight-deck.controller.ts:208](src/modules/flight-deck/flight-deck.controller.ts#L208) |
| `GET` | `/tenants/:tenantId/flight-deck/trips/:tripId/parcels` | [flight-deck.controller.ts:113](src/modules/flight-deck/flight-deck.controller.ts#L113) |

### 1.24 · `incident` (2 routes)

| Verb | Route | Source |
|---|---|---|
| `PATCH` | `/tenants/:tenantId/incidents/:id/assign` | [incident.controller.ts:58](src/modules/incident/incident.controller.ts#L58) |
| `PATCH` | `/tenants/:tenantId/incidents/:id/resolve` | [incident.controller.ts:69](src/modules/incident/incident.controller.ts#L69) |

### 1.25 · `fleet` (2 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/tenants/:tenantId/fleet/buses/:id/display` | [fleet.controller.ts:80](src/modules/fleet/fleet.controller.ts#L80) |
| `POST` | `/tenants/:tenantId/fleet/buses/:id/photos/upload-url` | [fleet.controller.ts:88](src/modules/fleet/fleet.controller.ts#L88) |

### 1.26 · `platform-plans` (2 routes)

| Verb | Route | Source |
|---|---|---|
| `POST` | `/platform/plans/:id/modules` | [platform-plans.controller.ts:75](src/modules/platform-plans/platform-plans.controller.ts#L75) |
| `DELETE` | `/platform/plans/:id/modules/:moduleKey` | [platform-plans.controller.ts:84](src/modules/platform-plans/platform-plans.controller.ts#L84) |

### 1.27 · `public-reporter` (1 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/public/:tenantId/report/list` | [public-reporter.controller.ts:52](src/modules/public-reporter/public-reporter.controller.ts#L52) |

### 1.28 · `workflow` (1 routes)

| Verb | Route | Source |
|---|---|---|
| `POST` | `/tenants/:tenantId/workflow/transition` | [workflow.controller.ts:30](src/modules/workflow/workflow.controller.ts#L30) |

### 1.29 · `platform-analytics` (1 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/platform/analytics/tenant/:id` | [platform-analytics.controller.ts:36](src/modules/platform-analytics/platform-analytics.controller.ts#L36) |

### 1.30 · `display` (1 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/tenants/:tenantId/buses/:busId/display` | [display.controller.ts:77](src/modules/display/display.controller.ts#L77) |

### 1.31 · `shipment` (1 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/tenants/:tenantId/shipments/:id` | [shipment.controller.ts:62](src/modules/shipment/shipment.controller.ts#L62) |

### 1.∞ · Routes légitimes sans UI (6)

| Verb | Route | Motif | Source |
|---|---|---|---|
| `GET` | `/admin/dlq/events` | Admin DLQ | [dlq.controller.ts:21](src/modules/dlq/dlq.controller.ts#L21) |
| `POST` | `/admin/dlq/events/:id/discard` | Admin DLQ | [dlq.controller.ts:33](src/modules/dlq/dlq.controller.ts#L33) |
| `POST` | `/admin/dlq/events/:id/replay` | Admin DLQ | [dlq.controller.ts:27](src/modules/dlq/dlq.controller.ts#L27) |
| `GET` | `/admin/dlq/stats` | Admin DLQ | [dlq.controller.ts:15](src/modules/dlq/dlq.controller.ts#L15) |
| `POST` | `/webhooks/payments/:providerKey` | Webhooks externes | [payment-webhook.controller.ts:42](src/infrastructure/payment/payment-webhook.controller.ts#L42) |
| `POST` | `/platform/bootstrap` | CLI init | [platform.controller.ts:54](src/modules/platform/platform.controller.ts#L54) |

## 2 · Routes probablement montées via pattern non standard

Path trouvé littéralement dans le FE mais non associé à un `apiPost/apiPatch/...`. Causes habituelles : `window.open` (PDFs), `<a href>`, ternary sur `base`, service client abstrait. **En général OK, pas d'action.**

| Module | Routes | Détail (3 premiers) |
|---|---|---|
| `platform-iam` | 2 | `GET sessions`, `GET users` |
| `document-verify` | 2 | `GET :ticketId`, `GET :trackingCode` |
| `public-reporter` | 1 | `POST report` |
| `auth` | 1 | `GET exchange` |
| `crm` | 1 | `POST complete` |
| `platform-billing` | 1 | `GET :id` |

## 3 · Appels frontend sans route backend (= 404 en runtime)

Si réels (pas du code mort / préfixe erroné), ces appels échouent en production. À trancher : supprimer l'appel FE, ou ajouter la route BE.

| Verb | URL réclamée |
|---|---|
| `POST` | `/api/mfa/disable` |
| `PATCH` | `/api/tenants/:X/announcements/:X` |
| `DELETE` | `/api/tenants/:X/announcements/:X` |
| `PUT` | `/api/tenants/:X/brand` |
| `POST` | `/api/tenants/:X/iam/roles` |
| `PATCH` | `/api/tenants/:X/iam/roles/:X` |
| `DELETE` | `/api/tenants/:X/iam/roles/:X` |
| `PUT` | `/api/tenants/:X/iam/roles/:X/permissions` |
| `DELETE` | `/api/tenants/:X/iam/sessions/:X` |
| `POST` | `/api/tenants/:X/iam/users` |
| `DELETE` | `/api/tenants/:X/iam/users/:X` |
| `PATCH` | `/api/tenants/:X/iam/users/:X` |
| `POST` | `/api/tenants/:X/iam/users/:X/revoke-sessions` |
| `PATCH` | `/api/tenants/:X/iam/users/:X/toggle-active` |
| `DELETE` | `/api/tenants/:X/invoices/:X` |
| `PATCH` | `/api/tenants/:X/invoices/:X` |
| `POST` | `/api/tenants/:X/peak-periods` |
| `PATCH` | `/api/tenants/:X/peak-periods/:X` |
| `DELETE` | `/api/tenants/:X/peak-periods/:X` |
| `PATCH` | `/api/tenants/:X/platforms/:X` |
| `DELETE` | `/api/tenants/:X/platforms/:X` |
| `POST` | `/api/tenants/:X/platforms/:X/assign` |
| `POST` | `/api/tenants/:X/platforms/:X/release` |
| `PUT` | `/api/tenants/:X/portal/config` |
| `PUT` | `/api/tenants/:X/portal/pages` |
| `DELETE` | `/api/tenants/:X/portal/pages/:X` |
| `POST` | `/api/tenants/:X/portal/posts` |
| `PUT` | `/api/tenants/:X/portal/posts/:X` |
| `DELETE` | `/api/tenants/:X/portal/posts/:X` |
| `DELETE` | `/api/tenants/:X/promotions/:X` |
| `PATCH` | `/api/tenants/:X/promotions/:X` |
| `DELETE` | `/api/tenants/:X/qhse/:X` |
| `POST` | `/api/tenants/:X/scheduler/templates` |
| `DELETE` | `/api/tenants/:X/scheduler/templates/:X` |
| `POST` | `/api/tenants/:X/settings/fare-classes` |
| `DELETE` | `/api/tenants/:X/settings/fare-classes/:X` |
| `PATCH` | `/api/tenants/:X/settings/fare-classes/:X` |
| `PUT` | `/api/tenants/:X/settings/integrations/:X/credentials` |
| `PATCH` | `/api/tenants/:X/settings/payment` |
| `POST` | `/api/tenants/:X/settings/taxes` |
| `PATCH` | `/api/tenants/:X/settings/taxes/:X` |
| `DELETE` | `/api/tenants/:X/settings/taxes/:X` |
| `PATCH` | `/api/tenants/:X/tariffs/:X` |
| `DELETE` | `/api/tenants/:X/tariffs/:X` |
| `POST` | `/api/tenants/:X/trips/:X/incident/cancel-in-transit` |
| `POST` | `/api/tenants/:X/trips/:X/incident/declare-major-delay` |
| `POST` | `/api/tenants/:X/trips/:X/incident/resume` |
| `POST` | `/api/tenants/:X/trips/:X/incident/suspend` |
| `POST` | `/api/tenants/:X/vouchers` |
| `PATCH` | `/api/tenants/:X/vouchers/:X/cancel` |

## 4 · Méthode

Script Python, extraction statique AST-light via regex. Trois passes FE :

1. URLs littérales `/api/...` et variables de base `const base = \`/api/...\``
2. Appels typés `apiPost / apiPatch / apiDelete / apiPut / apiGet / useFetch / apiFetch` + expansion de `${base}/suffix`
3. Ouvertures directes `window.open`, `<a href>`, `.href = `, `window.location.href`

Fallback littéral : si le script rate le match strict mais que le suffixe significatif (2-3 segments) apparaît quelque part dans le source FE, la route est classée §2 et non §1.
