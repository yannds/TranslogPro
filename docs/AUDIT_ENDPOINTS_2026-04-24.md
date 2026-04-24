# Audit endpoints — TransLog Pro

_Généré le 2026-04-24 par `scripts/audit-endpoints.py`. Reproduire : `python3 scripts/audit-endpoints.py`._

## Résumé

| Métrique | Valeur |
|---|---|
| Routes backend total | **515** |
| Routes **montées** (match strict verb+path) | **358** |
| Routes **probablement montées** (trace littérale trouvée dans FE) | **8** |
| Routes **vraiment orphelines** (zéro trace FE) | **149** |
| Appels FE **sans route BE** correspondante | **64** |

> **Lecture** : seuls les items de la §1 sont à traiter (vraiment orphelins, zéro référence FE). Les items §2 sont probablement consommés par `window.open`, `<a href>`, ternary, ou un service client abstrait — vérifier si un doute subsiste.

## 1 · Routes backend vraiment orphelines (zéro trace FE)

- Avec motif légitime no-UI : **6**
- **À vérifier manuellement** : **143**

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

### 1.4 · `parcel` (8 routes)

| Verb | Route | Source |
|---|---|---|
| `POST` | `/tenants/:tenantId/parcels/:id/hub/arrive` | [parcel.controller.ts:70](src/modules/parcel/parcel.controller.ts#L70) |
| `POST` | `/tenants/:tenantId/parcels/:id/hub/depart` | [parcel.controller.ts:107](src/modules/parcel/parcel.controller.ts#L107) |
| `POST` | `/tenants/:tenantId/parcels/:id/hub/load-outbound` | [parcel.controller.ts:95](src/modules/parcel/parcel.controller.ts#L95) |
| `POST` | `/tenants/:tenantId/parcels/:id/hub/store` | [parcel.controller.ts:83](src/modules/parcel/parcel.controller.ts#L83) |
| `POST` | `/tenants/:tenantId/parcels/:id/pickup/complete` | [parcel.controller.ts:131](src/modules/parcel/parcel.controller.ts#L131) |
| `POST` | `/tenants/:tenantId/parcels/:id/pickup/notify` | [parcel.controller.ts:119](src/modules/parcel/parcel.controller.ts#L119) |
| `POST` | `/tenants/:tenantId/parcels/:id/return/complete` | [parcel.controller.ts:168](src/modules/parcel/parcel.controller.ts#L168) |
| `POST` | `/tenants/:tenantId/parcels/:id/return/initiate` | [parcel.controller.ts:156](src/modules/parcel/parcel.controller.ts#L156) |

### 1.5 · `crm` (8 routes)

| Verb | Route | Source |
|---|---|---|
| `POST` | `/tenants/:tenantId/crm/campaigns` | [crm.controller.ts:142](src/modules/crm/crm.controller.ts#L142) |
| `GET` | `/tenants/:tenantId/crm/campaigns` | [crm.controller.ts:152](src/modules/crm/crm.controller.ts#L152) |
| `GET` | `/tenants/:tenantId/crm/campaigns/:id` | [crm.controller.ts:161](src/modules/crm/crm.controller.ts#L161) |
| `PATCH` | `/tenants/:tenantId/crm/campaigns/:id` | [crm.controller.ts:170](src/modules/crm/crm.controller.ts#L170) |
| `DELETE` | `/tenants/:tenantId/crm/campaigns/:id` | [crm.controller.ts:180](src/modules/crm/crm.controller.ts#L180) |
| `GET` | `/tenants/:tenantId/crm/campaigns/:id/audience` | [crm.controller.ts:189](src/modules/crm/crm.controller.ts#L189) |
| `GET` | `/tenants/:tenantId/crm/contacts/:customerId/recommendations` | [crm.controller.ts:48](src/modules/crm/crm.controller.ts#L48) |
| `POST` | `/tenants/:tenantId/crm/segments/recompute` | [crm.controller.ts:79](src/modules/crm/crm.controller.ts#L79) |

### 1.6 · `driver-profile` (6 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/tenants/:tenantId/driver-profile/drivers/:staffId/remediation/actions` | [driver-profile.controller.ts:341](src/modules/driver-profile/driver-profile.controller.ts#L341) |
| `POST` | `/tenants/:tenantId/driver-profile/drivers/:staffId/remediation/evaluate` | [driver-profile.controller.ts:331](src/modules/driver-profile/driver-profile.controller.ts#L331) |
| `GET` | `/tenants/:tenantId/driver-profile/drivers/:staffId/trainings` | [driver-profile.controller.ts:276](src/modules/driver-profile/driver-profile.controller.ts#L276) |
| `POST` | `/tenants/:tenantId/driver-profile/licenses/:id/upload-url` | [driver-profile.controller.ts:144](src/modules/driver-profile/driver-profile.controller.ts#L144) |
| `PATCH` | `/tenants/:tenantId/driver-profile/remediation/actions/:id` | [driver-profile.controller.ts:350](src/modules/driver-profile/driver-profile.controller.ts#L350) |
| `POST` | `/tenants/:tenantId/driver-profile/trainings/:id/upload-url` | [driver-profile.controller.ts:267](src/modules/driver-profile/driver-profile.controller.ts#L267) |

### 1.7 · `traveler` (6 routes)

| Verb | Route | Source |
|---|---|---|
| `POST` | `/tenants/:tenantId/travelers/:id/scan-board` | [traveler.controller.ts:38](src/modules/traveler/traveler.controller.ts#L38) |
| `POST` | `/tenants/:tenantId/travelers/:id/scan-in` | [traveler.controller.ts:26](src/modules/traveler/traveler.controller.ts#L26) |
| `POST` | `/tenants/:tenantId/travelers/:id/scan-out` | [traveler.controller.ts:50](src/modules/traveler/traveler.controller.ts#L50) |
| `POST` | `/tenants/:tenantId/travelers/:id/verify` | [traveler.controller.ts:14](src/modules/traveler/traveler.controller.ts#L14) |
| `GET` | `/tenants/:tenantId/travelers/trips/:tripId` | [traveler.controller.ts:61](src/modules/traveler/traveler.controller.ts#L61) |
| `GET` | `/tenants/:tenantId/travelers/trips/:tripId/drop-off/:stationId` | [traveler.controller.ts:71](src/modules/traveler/traveler.controller.ts#L71) |

### 1.8 · `crew-briefing` (6 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/tenants/:tenantId/crew-briefing/briefings/assignment/:assignmentId` | [crew-briefing.controller.ts:101](src/modules/crew-briefing/crew-briefing.controller.ts#L101) |
| `PATCH` | `/tenants/:tenantId/crew-briefing/equipment-types/:id` | [crew-briefing.controller.ts:77](src/modules/crew-briefing/crew-briefing.controller.ts#L77) |
| `PATCH` | `/tenants/:tenantId/crew-briefing/safety-alerts/:alertId/resolve` | [crew-briefing.controller.ts:277](src/modules/crew-briefing/crew-briefing.controller.ts#L277) |
| `POST` | `/tenants/:tenantId/crew-briefing/sections/:sectionId/items` | [crew-briefing.controller.ts:207](src/modules/crew-briefing/crew-briefing.controller.ts#L207) |
| `POST` | `/tenants/:tenantId/crew-briefing/templates/:templateId/duplicate` | [crew-briefing.controller.ts:174](src/modules/crew-briefing/crew-briefing.controller.ts#L174) |
| `POST` | `/tenants/:tenantId/crew-briefing/templates/:templateId/sections` | [crew-briefing.controller.ts:186](src/modules/crew-briefing/crew-briefing.controller.ts#L186) |

### 1.9 · `fleet-docs` (5 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/tenants/:tenantId/fleet-docs/buses/:busId/documents` | [fleet-docs.controller.ts:70](src/modules/fleet-docs/fleet-docs.controller.ts#L70) |
| `POST` | `/tenants/:tenantId/fleet-docs/documents/:id/upload-url` | [fleet-docs.controller.ts:61](src/modules/fleet-docs/fleet-docs.controller.ts#L61) |
| `GET` | `/tenants/:tenantId/fleet-docs/maintenance/:reportId/detail` | [fleet-docs.controller.ts:146](src/modules/fleet-docs/fleet-docs.controller.ts#L146) |
| `POST` | `/tenants/:tenantId/fleet-docs/maintenance/:reportId/intervenants` | [fleet-docs.controller.ts:124](src/modules/fleet-docs/fleet-docs.controller.ts#L124) |
| `POST` | `/tenants/:tenantId/fleet-docs/maintenance/:reportId/parts` | [fleet-docs.controller.ts:135](src/modules/fleet-docs/fleet-docs.controller.ts#L135) |

### 1.10 · `public-portal` (5 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/public/:tenantSlug/portal/announcements` | [public-portal.controller.ts:95](src/modules/public-portal/public-portal.controller.ts#L95) |
| `GET` | `/public/:tenantSlug/portal/footer-pages` | [public-portal.controller.ts:176](src/modules/public-portal/public-portal.controller.ts#L176) |
| `GET` | `/public/:tenantSlug/portal/pages/:pageSlug` | [public-portal.controller.ts:133](src/modules/public-portal/public-portal.controller.ts#L133) |
| `POST` | `/public/:tenantSlug/portal/tickets/:ticketRef/cancel` | [public-portal.controller.ts:213](src/modules/public-portal/public-portal.controller.ts#L213) |
| `GET` | `/public/:tenantSlug/portal/tickets/:ticketRef/refund-preview` | [public-portal.controller.ts:195](src/modules/public-portal/public-portal.controller.ts#L195) |

### 1.11 · `sav` (5 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/tenants/:tenantId/sav/claims/:id` | [sav.controller.ts:50](src/modules/sav/sav.controller.ts#L50) |
| `POST` | `/tenants/:tenantId/sav/claims/:id/deliver` | [sav.controller.ts:75](src/modules/sav/sav.controller.ts#L75) |
| `PATCH` | `/tenants/:tenantId/sav/claims/:id/process` | [sav.controller.ts:60](src/modules/sav/sav.controller.ts#L60) |
| `POST` | `/tenants/:tenantId/sav/lost-found` | [sav.controller.ts:20](src/modules/sav/sav.controller.ts#L20) |
| `GET` | `/tenants/:tenantId/sav/refunds/:id` | [sav.controller.ts:89](src/modules/sav/sav.controller.ts#L89) |

### 1.12 · `ticketing` (5 routes)

| Verb | Route | Source |
|---|---|---|
| `POST` | `/tenants/:tenantId/tickets/:id/no-show` | [ticketing.controller.ts:89](src/modules/ticketing/ticketing.controller.ts#L89) |
| `POST` | `/tenants/:tenantId/tickets/:id/rebook/later` | [ticketing.controller.ts:111](src/modules/ticketing/ticketing.controller.ts#L111) |
| `POST` | `/tenants/:tenantId/tickets/:id/rebook/next-available` | [ticketing.controller.ts:100](src/modules/ticketing/ticketing.controller.ts#L100) |
| `POST` | `/tenants/:tenantId/tickets/:id/refund-request` | [ticketing.controller.ts:128](src/modules/ticketing/ticketing.controller.ts#L128) |
| `POST` | `/tenants/:tenantId/tickets/verify-qr` | [ticketing.controller.ts:51](src/modules/ticketing/ticketing.controller.ts#L51) |

### 1.13 · `analytics` (5 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/tenants/:tenantId/analytics/dashboard` | [analytics.controller.ts:63](src/modules/analytics/analytics.controller.ts#L63) |
| `GET` | `/tenants/:tenantId/analytics/export/tickets` | [analytics.controller.ts:250](src/modules/analytics/analytics.controller.ts#L250) |
| `GET` | `/tenants/:tenantId/analytics/revenue` | [analytics.controller.ts:105](src/modules/analytics/analytics.controller.ts#L105) |
| `GET` | `/tenants/:tenantId/analytics/trips` | [analytics.controller.ts:90](src/modules/analytics/analytics.controller.ts#L90) |
| `GET` | `/tenants/:tenantId/analytics/trips/:tripId/occupancy` | [analytics.controller.ts:120](src/modules/analytics/analytics.controller.ts#L120) |

### 1.14 · `notification` (4 routes)

| Verb | Route | Source |
|---|---|---|
| `PATCH` | `/tenants/:tenantId/notifications/:id/read` | [notification.controller.ts:23](src/modules/notification/notification.controller.ts#L23) |
| `GET` | `/tenants/:tenantId/notifications/preferences` | [notification.controller.ts:39](src/modules/notification/notification.controller.ts#L39) |
| `PATCH` | `/tenants/:tenantId/notifications/preferences` | [notification.controller.ts:48](src/modules/notification/notification.controller.ts#L48) |
| `GET` | `/tenants/:tenantId/notifications/unread` | [notification.controller.ts:14](src/modules/notification/notification.controller.ts#L14) |

### 1.15 · `staff` (4 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/tenants/:tenantId/assignments` | [staff-assignment.controller.ts:48](src/modules/staff/staff-assignment.controller.ts#L48) |
| `PATCH` | `/tenants/:tenantId/assignments/:id` | [staff-assignment.controller.ts:62](src/modules/staff/staff-assignment.controller.ts#L62) |
| `POST` | `/tenants/:tenantId/assignments/:id/agencies` | [staff-assignment.controller.ts:80](src/modules/staff/staff-assignment.controller.ts#L80) |
| `DELETE` | `/tenants/:tenantId/assignments/:id/agencies/:agencyId` | [staff-assignment.controller.ts:90](src/modules/staff/staff-assignment.controller.ts#L90) |

### 1.16 · `workflow-studio` (4 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/tenants/:tenantId/workflow-marketplace/blueprints/:blueprintId/export` | [workflow-marketplace.controller.ts:48](src/modules/workflow-studio/workflow-marketplace.controller.ts#L48) |
| `POST` | `/tenants/:tenantId/workflow-marketplace/blueprints/:blueprintId/publish` | [workflow-marketplace.controller.ts:68](src/modules/workflow-studio/workflow-marketplace.controller.ts#L68) |
| `DELETE` | `/tenants/:tenantId/workflow-marketplace/blueprints/:blueprintId/publish` | [workflow-marketplace.controller.ts:78](src/modules/workflow-studio/workflow-marketplace.controller.ts#L78) |
| `POST` | `/tenants/:tenantId/workflow-studio/graph/:entityType/reset` | [workflow-studio.controller.ts:83](src/modules/workflow-studio/workflow-studio.controller.ts#L83) |

### 1.17 · `cashier` (3 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/tenants/:tenantId/cashier/registers/:id` | [cashier.controller.ts:99](src/modules/cashier/cashier.controller.ts#L99) |
| `GET` | `/tenants/:tenantId/cashier/report/daily` | [cashier.controller.ts:109](src/modules/cashier/cashier.controller.ts#L109) |
| `PATCH` | `/tenants/:tenantId/cashier/transactions/:txId/verify-proof` | [cashier.controller.ts:150](src/modules/cashier/cashier.controller.ts#L150) |

### 1.18 · `feedback` (3 routes)

| Verb | Route | Source |
|---|---|---|
| `POST` | `/tenants/:tenantId/feedback` | [feedback.controller.ts:12](src/modules/feedback/feedback.controller.ts#L12) |
| `GET` | `/tenants/:tenantId/feedback/ratings/:entityType/:entityId` | [feedback.controller.ts:28](src/modules/feedback/feedback.controller.ts#L28) |
| `GET` | `/tenants/:tenantId/feedback/trip/:tripId` | [feedback.controller.ts:22](src/modules/feedback/feedback.controller.ts#L22) |

### 1.19 · `safety` (3 routes)

| Verb | Route | Source |
|---|---|---|
| `POST` | `/tenants/:tenantId/safety/alerts` | [safety.controller.ts:17](src/modules/safety/safety.controller.ts#L17) |
| `GET` | `/tenants/:tenantId/safety/alerts` | [safety.controller.ts:36](src/modules/safety/safety.controller.ts#L36) |
| `PATCH` | `/tenants/:tenantId/safety/alerts/:id/dismiss` | [safety.controller.ts:45](src/modules/safety/safety.controller.ts#L45) |

### 1.20 · `tracking` (3 routes)

| Verb | Route | Source |
|---|---|---|
| `POST` | `/tenants/:tenantId/tracking/trips/:tripId/gps` | [tracking.controller.ts:12](src/modules/tracking/tracking.controller.ts#L12) |
| `GET` | `/tenants/:tenantId/tracking/trips/:tripId/history` | [tracking.controller.ts:35](src/modules/tracking/tracking.controller.ts#L35) |
| `GET` | `/tenants/:tenantId/tracking/trips/:tripId/position` | [tracking.controller.ts:25](src/modules/tracking/tracking.controller.ts#L25) |

### 1.21 · `garage` (3 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/tenants/:tenantId/garage/buses/:busId/reports` | [garage.controller.ts:108](src/modules/garage/garage.controller.ts#L108) |
| `POST` | `/tenants/:tenantId/garage/reminders/:busId/:type/performed` | [garage.controller.ts:32](src/modules/garage/garage.controller.ts#L32) |
| `GET` | `/tenants/:tenantId/garage/reports/:id/upload-url` | [garage.controller.ts:88](src/modules/garage/garage.controller.ts#L88) |

### 1.22 · `infra/payment` (2 routes)

| Verb | Route | Source |
|---|---|---|
| `POST` | `/tenants/:tenantId/payments/intents/:intentId/cancel` | [payment.controller.ts:103](src/infrastructure/payment/payment.controller.ts#L103) |
| `POST` | `/tenants/:tenantId/payments/intents/:intentId/refund` | [payment.controller.ts:121](src/infrastructure/payment/payment.controller.ts#L121) |

### 1.23 · `oauth` (2 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/auth/oauth/:providerKey/callback` | [oauth.controller.ts:93](src/modules/oauth/oauth.controller.ts#L93) |
| `GET` | `/auth/oauth/:providerKey/start` | [oauth.controller.ts:63](src/modules/oauth/oauth.controller.ts#L63) |

### 1.24 · `manifest` (2 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/tenants/:tenantId/manifests/:id` | [manifest.controller.ts:103](src/modules/manifest/manifest.controller.ts#L103) |
| `POST` | `/tenants/:tenantId/manifests/backfill-signed-pdfs` | [manifest.controller.ts:117](src/modules/manifest/manifest.controller.ts#L117) |

### 1.25 · `flight-deck` (2 routes)

| Verb | Route | Source |
|---|---|---|
| `POST` | `/tenants/:tenantId/flight-deck/trips/:tripId/freight/close` | [flight-deck.controller.ts:208](src/modules/flight-deck/flight-deck.controller.ts#L208) |
| `GET` | `/tenants/:tenantId/flight-deck/trips/:tripId/parcels` | [flight-deck.controller.ts:113](src/modules/flight-deck/flight-deck.controller.ts#L113) |

### 1.26 · `incident` (2 routes)

| Verb | Route | Source |
|---|---|---|
| `PATCH` | `/tenants/:tenantId/incidents/:id/assign` | [incident.controller.ts:58](src/modules/incident/incident.controller.ts#L58) |
| `PATCH` | `/tenants/:tenantId/incidents/:id/resolve` | [incident.controller.ts:69](src/modules/incident/incident.controller.ts#L69) |

### 1.27 · `fleet` (2 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/tenants/:tenantId/fleet/buses/:id/display` | [fleet.controller.ts:80](src/modules/fleet/fleet.controller.ts#L80) |
| `POST` | `/tenants/:tenantId/fleet/buses/:id/photos/upload-url` | [fleet.controller.ts:88](src/modules/fleet/fleet.controller.ts#L88) |

### 1.28 · `platform-plans` (2 routes)

| Verb | Route | Source |
|---|---|---|
| `POST` | `/platform/plans/:id/modules` | [platform-plans.controller.ts:75](src/modules/platform-plans/platform-plans.controller.ts#L75) |
| `DELETE` | `/platform/plans/:id/modules/:moduleKey` | [platform-plans.controller.ts:84](src/modules/platform-plans/platform-plans.controller.ts#L84) |

### 1.29 · `public-reporter` (1 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/public/:tenantId/report/list` | [public-reporter.controller.ts:52](src/modules/public-reporter/public-reporter.controller.ts#L52) |

### 1.30 · `workflow` (1 routes)

| Verb | Route | Source |
|---|---|---|
| `POST` | `/tenants/:tenantId/workflow/transition` | [workflow.controller.ts:30](src/modules/workflow/workflow.controller.ts#L30) |

### 1.31 · `platform-analytics` (1 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/platform/analytics/tenant/:id` | [platform-analytics.controller.ts:36](src/modules/platform-analytics/platform-analytics.controller.ts#L36) |

### 1.32 · `display` (1 routes)

| Verb | Route | Source |
|---|---|---|
| `GET` | `/tenants/:tenantId/buses/:busId/display` | [display.controller.ts:77](src/modules/display/display.controller.ts#L77) |

### 1.33 · `shipment` (1 routes)

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
| `DELETE` | `/api/tenants/:X/qhse/:X` |
| `POST` | `/api/v1/mfa/disable` |
| `PATCH` | `/api/v1/tenants/:X/announcements/:X` |
| `DELETE` | `/api/v1/tenants/:X/announcements/:X` |
| `PUT` | `/api/v1/tenants/:X/brand` |
| `POST` | `/api/v1/tenants/:X/iam/roles` |
| `DELETE` | `/api/v1/tenants/:X/iam/roles/:X` |
| `PATCH` | `/api/v1/tenants/:X/iam/roles/:X` |
| `PUT` | `/api/v1/tenants/:X/iam/roles/:X/permissions` |
| `DELETE` | `/api/v1/tenants/:X/iam/sessions/:X` |
| `POST` | `/api/v1/tenants/:X/iam/users` |
| `PATCH` | `/api/v1/tenants/:X/iam/users/:X` |
| `DELETE` | `/api/v1/tenants/:X/iam/users/:X` |
| `POST` | `/api/v1/tenants/:X/iam/users/:X/revoke-sessions` |
| `PATCH` | `/api/v1/tenants/:X/iam/users/:X/toggle-active` |
| `PATCH` | `/api/v1/tenants/:X/invoices/:X` |
| `DELETE` | `/api/v1/tenants/:X/invoices/:X` |
| `PATCH` | `/api/v1/tenants/:X/notifications/preferences` |
| `POST` | `/api/v1/tenants/:X/parcels/:X/dispute` |
| `POST` | `/api/v1/tenants/:X/parcels/:X/hub/arrive` |
| `POST` | `/api/v1/tenants/:X/parcels/:X/hub/depart` |
| `POST` | `/api/v1/tenants/:X/parcels/:X/hub/load-outbound` |
| `POST` | `/api/v1/tenants/:X/parcels/:X/hub/store` |
| `POST` | `/api/v1/tenants/:X/parcels/:X/pickup/complete` |
| `POST` | `/api/v1/tenants/:X/parcels/:X/pickup/notify` |
| `POST` | `/api/v1/tenants/:X/parcels/:X/return/complete` |
| `POST` | `/api/v1/tenants/:X/parcels/:X/return/initiate` |
| `POST` | `/api/v1/tenants/:X/peak-periods` |
| `PATCH` | `/api/v1/tenants/:X/peak-periods/:X` |
| `DELETE` | `/api/v1/tenants/:X/peak-periods/:X` |
| `PATCH` | `/api/v1/tenants/:X/platforms/:X` |
| `DELETE` | `/api/v1/tenants/:X/platforms/:X` |
| `POST` | `/api/v1/tenants/:X/platforms/:X/assign` |
| `POST` | `/api/v1/tenants/:X/platforms/:X/release` |
| `PUT` | `/api/v1/tenants/:X/portal/config` |
| `PUT` | `/api/v1/tenants/:X/portal/pages` |
| `DELETE` | `/api/v1/tenants/:X/portal/pages/:X` |
| `POST` | `/api/v1/tenants/:X/portal/posts` |
| `DELETE` | `/api/v1/tenants/:X/portal/posts/:X` |
| `PUT` | `/api/v1/tenants/:X/portal/posts/:X` |
| `PATCH` | `/api/v1/tenants/:X/promotions/:X` |
| `DELETE` | `/api/v1/tenants/:X/promotions/:X` |
| `POST` | `/api/v1/tenants/:X/scheduler/templates` |
| `DELETE` | `/api/v1/tenants/:X/scheduler/templates/:X` |
| `POST` | `/api/v1/tenants/:X/settings/fare-classes` |
| `PATCH` | `/api/v1/tenants/:X/settings/fare-classes/:X` |
| `DELETE` | `/api/v1/tenants/:X/settings/fare-classes/:X` |
| `PUT` | `/api/v1/tenants/:X/settings/integrations/:X/credentials` |
| `PATCH` | `/api/v1/tenants/:X/settings/payment` |
| `POST` | `/api/v1/tenants/:X/settings/taxes` |
| `DELETE` | `/api/v1/tenants/:X/settings/taxes/:X` |
| `PATCH` | `/api/v1/tenants/:X/settings/taxes/:X` |
| `DELETE` | `/api/v1/tenants/:X/tariffs/:X` |
| `PATCH` | `/api/v1/tenants/:X/tariffs/:X` |
| `POST` | `/api/v1/tenants/:X/tickets/:X/no-show` |
| `POST` | `/api/v1/tenants/:X/tickets/:X/rebook/later` |
| `POST` | `/api/v1/tenants/:X/tickets/:X/rebook/next-available` |
| `POST` | `/api/v1/tenants/:X/tickets/:X/refund-request` |
| `POST` | `/api/v1/tenants/:X/trips/:X/incident/cancel-in-transit` |
| `POST` | `/api/v1/tenants/:X/trips/:X/incident/declare-major-delay` |
| `POST` | `/api/v1/tenants/:X/trips/:X/incident/resume` |
| `POST` | `/api/v1/tenants/:X/trips/:X/incident/suspend` |
| `POST` | `/api/v1/tenants/:X/vouchers` |
| `PATCH` | `/api/v1/tenants/:X/vouchers/:X/cancel` |

## 4 · Méthode

Script Python, extraction statique AST-light via regex. Trois passes FE :

1. URLs littérales `/api/...` et variables de base `const base = \`/api/...\``
2. Appels typés `apiPost / apiPatch / apiDelete / apiPut / apiGet / useFetch / apiFetch` + expansion de `${base}/suffix`
3. Ouvertures directes `window.open`, `<a href>`, `.href = `, `window.location.href`

Fallback littéral : si le script rate le match strict mais que le suffixe significatif (2-3 segments) apparaît quelque part dans le source FE, la route est classée §2 et non §1.
