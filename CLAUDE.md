# TransLog Pro — Instructions Claude Code

## Commits
- Ne JAMAIS ajouter de ligne `Co-Authored-By` dans les messages de commit.
- Ne JAMAIS mentionner Claude, Anthropic, ou tout assistant IA dans les commits, PR, ou commentaires.

## Workflows blueprint-driven (ADR-15 / ADR-16)
- **Toute transition d'état métier passe par `WorkflowEngine.transition()`**. Jamais de `prisma.<entity>.update({ data: { status: X } })` direct sur un champ `status` géré par un blueprint.
- Source de vérité runtime : `WorkflowConfig` en DB (par tenant). Seed dans `prisma/seeds/iam.seed.ts` (`DEFAULT_WORKFLOW_CONFIGS`).
- Documentation complète : [docs/WORKFLOWS.md](docs/WORKFLOWS.md) — liste des entités, états, actions, permissions, config tenant.
- Entités blueprint-driven : Trip, Ticket, Parcel, Traveler, Shipment, Bus, Checklist, Manifest, Refund, Claim, CashRegister, Incident, MaintenanceReport, CrewAssignment, Driver, **Invoice**, **Staff**, **StaffAssignment**, **SupportTicket**, **DriverTraining**, **QhseExecution**, **Voucher**, **CompensationItem**.
- **Zéro magic number** : tous les seuils (délai grace, TTL billet, % pénalité, tiers JSON, % compensation) passent par `TenantBusinessConfig` (par tenant) ou `Trip.*Override` (ponctuel). Config via UI : `/admin/settings/rules`.

## Contrat qualité UI/UX (appliqué par défaut à chaque livraison)
- **i18n 8 locales obligatoire** : toute chaîne visible passe par `t()`. Clés ajoutées en même temps dans `fr.ts`, `en.ts`, `wo.ts`, `ln.ts`, `ktu.ts`, `ar.ts`, `pt.ts`, `es.ts`.
- **WCAG AA + ARIA** : `aria-label`, `aria-describedby`, rôles sémantiques, focus visible, navigation clavier.
- **Responsive** : mobile-first pour le public, desktop-first pour le back-office (lg: multi-col, max-w-4xl+ sur modales riches).
- **Dark + Light** : toute classe Tailwind a son variant `dark:`. Light est le défaut.
- **Réutilisation composants** : `DataTableMaster` obligatoire pour listes/tables ; `Dialog`, `Button`, `Badge`, `FormFooter`, `ErrorAlert`, token `inputClass`.
- **Zéro régression** : vérifier amont/aval avant tout changement de signature. Tests verts.
- **Security first** : RBAC via `permissions.ts`, tenantId condition racine de toute requête, validation serveur.
- **Devise jamais hardcodée** : lire depuis `TenantBusinessConfig`.

## Architecture CRM (Customer unifié)

TransLog Pro a un **modèle `Customer` canonique** tenant-scoped (table `customers`) qui sépare **identité CRM** de **authentification**.

### Entités clés
- `Customer` : identité (phoneE164, email, name, segments, compteurs) — userId nullable (shadow si non enregistré).
- `CustomerClaimToken` : magic link sha-256 hashé, one-shot, TTL 30j (Phase 2).
- `CustomerRetroClaimOtp` : OTP SMS 6 chiffres sha-256 hashé, TTL 5min, 5 attempts max (Phase 3).
- `User` : auth (inchangé). `User.customerProfile: Customer?` one-to-one.
- `Ticket` / `Parcel` : FK `customerId` / `senderCustomerId` / `recipientCustomerId` (toutes nullable).

### Flux
1. **Création ticket/colis** (caisse, guichet, portail anonyme) → `CustomerResolverService.resolveOrCreate({ phone, email, name })` upsert idempotent par (tenant, phoneE164) OU (tenant, email).
2. **Magic link auto-émis** si `Customer.userId = null` → dispatche WhatsApp + SMS fallback + Email.
3. **Page `/claim?token=XYZ`** (public) → preview masqué (phone `+242••••567`, email `m••@e••.com`) → signup → `completeToken` lie Customer ↔ User.
4. **Claim rétroactif** après expiration du magic link : page `/customer/retro-claim` (auth CUSTOMER) → initiate (OTP 6 chiffres via WhatsApp/SMS) → confirm (OTP + userId) → liaison directe. Rate-limit 3/h/IP + 3/jour/phone, 5 tentatives max.

### Matching & normalisation
- `src/common/helpers/phone.helper.ts` : E.164 normalisé via country du tenant (CG, SN, CI, FR, etc.). Clef déterministe pour l'upsert.
- Priorité matching : `phoneE164` → `email` → création shadow.

### Permissions (RBAC)
- `data.crm.read.tenant` / `data.crm.read.agency` : lecture (tous rôles admin + manager).
- `data.crm.write.tenant` / `data.crm.write.agency` : upsert, édition (TENANT_ADMIN, AGENCY_MANAGER pour agency).
- `data.crm.merge.tenant` : fusion Customer (TENANT_ADMIN — opération destructive, audit log).
- `data.crm.delete.tenant` : RGPD droit à l'oubli (TENANT_ADMIN).

### Règles d'or
- Ne **jamais** créer un shadow User (userType=CUSTOMER sans email réel). Créer un `Customer` shadow à la place.
- Ne **jamais** stocker un magic link en clair. Uniquement `sha256(token)`.
- Ne **jamais** envoyer un email à `*@shadow.*` — on ne pollue plus la table User avec des emails synthétiques.
- Les `Ticket.passengerId` et `Parcel.senderId` restent FK User mais sont **nullables** — pas de sentinel "portal-anonymous".

### Backfill
- Script idempotent : `npx ts-node prisma/seeds/crm-customer.backfill.ts`
- Rattache `User(CUSTOMER)` existants à Customer, remplit `Ticket.customerId` et `Parcel.{sender,recipient}CustomerId`, recalcule compteurs.

## Tests
- Unit : `npx jest --config jest.unit.config.ts`
- Intégration (Testcontainers) : `npm run test:integration`
- Sécurité : `npm run test:security` (rapport dans `Result_Secu_test.md`)
- E2E : `npm run test:e2e`

Suite CRM :
- `test/unit/common/phone.helper.spec.ts` (18 tests)
- `test/unit/crm/customer-resolver.service.spec.ts` (9 tests)
- `test/unit/crm/customer-claim.service.spec.ts` (12 tests)
- `test/unit/crm/retro-claim.service.spec.ts` (13 tests)
- `test/unit/crm/customer-recommendation.service.spec.ts` (10 tests)
- `test/unit/crm/customer-segment.service.spec.ts` (11 tests)
- `test/security/crm-claim-token.spec.ts` (7 tests)
- `test/security/crm-retro-claim.spec.ts` (7 tests)

Phases CRM livrées :
- Phase 1 : Customer unifié + resolveOrCreate + hooks
- Phase 2 : Magic link claim (sha-256, 30j, WhatsApp/SMS/Email)
- Phase 3 : Claim rétroactif OTP (5 attempts max, 5 min TTL, 3/jour/phone)
- Phase 4 : Recommandations dérivées (topSeat, fareClass, routes) + hint CrmPhoneHint dans PageSellTicket
- Phase 5 : Segments auto (VIP/FREQUENT/NEW/DORMANT) + compteurs + Campaign.estimateAudience

Suite Workflow-driven (2026-04-19) :
- `test/unit/sav/cancellation-policy.service.spec.ts` (9 tests) — N-tiers, applies_to, waive, trip override, legacy fallback
- `test/unit/voucher/voucher.service.spec.ts` (11 tests) — issue validations, redeem guards (status, validity, scope, recipient)
- `test/unit/incident-compensation/incident-compensation.service.spec.ts` (8 tests) — suspend/cancel/major-delay, sélection palier, forme MIXED, trip override

Phases Workflow-driven livrées (2026-04-19) :
- Phase 0 : Socle (schema Prisma étendu, 25+ permissions, 40+ blueprints, models Voucher/CompensationItem)
- Phase 1 : 7 modules migrés hardcoded → WorkflowEngine (flight-deck Trip driver, shipment Parcel, invoice, staff + cascade, support, driver-profile, qhse)
- Phase 2A : Parcel hubs (arrive/store/load_outbound/depart, notify_for_pickup, pickup, dispute, initiate_return)
- Phase 2B : Ticket no-show (mark, rebook next-available / later, request refund, forfeit scheduler)
- Phase 2C : CancellationPolicyService généralisé (N-tiers JSON + applies_to actors + trip override + waive)
- Phase 2D : IncidentCompensationService (suspend/resume/cancel_in_transit/declare_major_delay) + VoucherService (issue/redeem/expire/cancel) + CompensationItem (snack fan-out)
- Phase 3.1 : `PageTenantBusinessRules` — éditeur config métier (4 sections, JSON tier editor)
- Phase 3.2 : `PageVouchers` — liste admin, émission, filtrage, annulation
- Phase 4 : +28 tests unit sur nouveaux services (total 561/561 PASS)
- Phase 5 : [docs/WORKFLOWS.md](docs/WORKFLOWS.md)

UI restantes (backlog, documentées mais non implémentées) :
- Actions ticket no-show/rebook dans la fiche ticket admin (endpoints exposés côté back-end)
- TripDetailDialog incident panel (suspend/cancel/declare-delay) admin
- Parcel hub actions UI pour agent quai
- Mobile driver : bouton SUSPEND trip + declare major delay
- Mobile quai : actions hub inbound/store/load-outbound + pickup + dispute
- Portail voyageur : page "Mes bons" + actions rebook self-service
- i18n 6 locales restantes (ar, es, ktu, ln, pt, wo) pour `tenantRules.*` et `vouchers.*` — voir [docs/TODO_i18n_propagation.md](docs/TODO_i18n_propagation.md)
