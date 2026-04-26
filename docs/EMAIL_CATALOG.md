# Email Catalog — Catalogue exhaustif des templates

> Source de vérité : registre central [`src/modules/notification/email-templates/registry.ts`](../src/modules/notification/email-templates/registry.ts).
> Mise à jour : 2026-04-26 (chantier email exhaustif).

---

## 1. Vue d'ensemble

**31 templates** répartis en **10 groupes**, tous exposés via le testeur plateforme (`/admin/platform/email`).

| Groupe | Templates | Trigger | Listener |
|---|---|---|---|
| **lifecycle** | 5 | DomainEvents trip/ticket | [`lifecycle-notification.listener.ts`](../src/modules/notification/lifecycle-notification.listener.ts) |
| **invoice** | 4 | DomainEvents invoice | [`invoice-notification.listener.ts`](../src/modules/notification/invoice-notification.listener.ts) + [`invoice-overdue.scheduler.ts`](../src/modules/notification/invoice-overdue.scheduler.ts) |
| **voucher** | 1 | `VOUCHER_ISSUED` | [`voucher-notification.listener.ts`](../src/modules/notification/voucher-notification.listener.ts) |
| **refund** | 3 | `REFUND_CREATED/APPROVED/REJECTED` | [`refund-notification.listener.ts`](../src/modules/notification/refund-notification.listener.ts) |
| **user** | 1 | `USER_INVITED` | [`user-notification.listener.ts`](../src/modules/notification/user-notification.listener.ts) |
| **trip** | 1 | `TRIP_CANCELLED` | [`trip-cancelled-notification.listener.ts`](../src/modules/notification/trip-cancelled-notification.listener.ts) |
| **parcel** | 4 | DomainEvents parcel | [`parcel-notification.listener.ts`](../src/modules/notification/parcel-notification.listener.ts) |
| **ticket** | 3 | `TICKET_NO_SHOW/REBOOKED/FORFEITED` | [`ticket-notification.listener.ts`](../src/modules/notification/ticket-notification.listener.ts) |
| **auth** | 5 | DomainEvents AUTH_* | [`auth-notification.listener.ts`](../src/modules/notification/auth-notification.listener.ts) |
| **subscription** | 4 | (en backlog migration centrale) | (services dédiés inline) |

---

## 2. Détail par groupe

### 2.1 Lifecycle voyageur (5)

| Template ID | Évènement déclencheur | Quand |
|---|---|---|
| `notif.ticket.purchased` | `TICKET_ISSUED` | Émission billet (caisse, guichet, portail) |
| `notif.trip.published` | `TRIP_PUBLISHED` | Ouverture trajet à la vente (CRM-aware FREQUENT/VIP) |
| `notif.trip.boarding` | `TRIP_BOARDING_OPENED` | Embarquement ouvert (fan-out passagers actifs) |
| `notif.trip.reminder` | `TRIP_REMINDER_DUE` | Cron J-1/H-6/H-1 (configurable) |
| `notif.trip.arrived` | `TRIP_COMPLETED` | Arrivée à destination |

### 2.2 Invoice (4)

| Template ID | Évènement | Quand |
|---|---|---|
| `invoice.issued` | `INVOICE_ISSUED` | DRAFT → ISSUED (nouvelle facture envoyée) |
| `invoice.paid` | `INVOICE_PAID` | * → PAID (paiement reçu / reçu de caisse) |
| `invoice.overdue` | `INVOICE_OVERDUE` | Cron quotidien 07h UTC, idempotent par invoice |
| `invoice.cancelled` | `INVOICE_CANCELLED` | ISSUED → CANCELLED (DRAFT → CANCELLED reste silencieux) |

### 2.3 Voucher (1)

| Template ID | Évènement | Quand |
|---|---|---|
| `voucher.issued` | `VOUCHER_ISSUED` | Émission bon d'avoir (incident, retard majeur, geste, promo) |

### 2.4 Refund (3)

| Template ID | Évènement | Quand |
|---|---|---|
| `refund.created` | `REFUND_CREATED` | Demande de remboursement enregistrée |
| `refund.approved` | `REFUND_APPROVED` ou `REFUND_AUTO_APPROVED` | Approbation manuelle ou auto |
| `refund.rejected` | `REFUND_REJECTED` | Refus avec motif facultatif |

`REFUND_PROCESSED` est émis mais sans template associé pour le moment (futur "virement effectué" sans changer le service).

### 2.5 User invite (1)

| Template ID | Évènement | Quand |
|---|---|---|
| `user.invited` | `USER_INVITED` | TENANT_ADMIN ajoute un staff via `/admin/users` (différent du colleague invite onboarding wizard) |

### 2.6 Trip ad-hoc (1)

| Template ID | Évènement | Quand |
|---|---|---|
| `trip.cancelled` | `TRIP_CANCELLED` | Annulation trajet — fan-out aux passagers (parallèle aux refunds) |

### 2.7 Parcel (4)

| Template ID | Évènement | Audience |
|---|---|---|
| `parcel.registered` | `PARCEL_REGISTERED` | sender + recipient |
| `parcel.in_transit` | `PARCEL_DISPATCHED` | recipient |
| `parcel.ready_for_pickup` | `PARCEL_ARRIVED` | recipient |
| `parcel.delivered` | `PARCEL_DELIVERED` | sender + recipient (texte différencié) |

### 2.8 Ticket no-show (3)

| Template ID | Évènement | Quand |
|---|---|---|
| `ticket.no_show` | `TICKET_NO_SHOW` | Marquage no-show (agent quai ou scheduler) |
| `ticket.rebooked` | `TICKET_REBOOKED` | Replacement réussi (next available ou later) |
| `ticket.forfeited` | `TICKET_FORFEITED` | TTL post-départ dépassé (cron) |

### 2.9 Auth — sécurité (5)

| Template ID | Évènement | Type |
|---|---|---|
| `auth.password_reset.link` | `AUTH_PASSWORD_RESET_LINK` | Action utilisateur (TTL 30 min) |
| `auth.password_reset.completed` | `AUTH_PASSWORD_RESET_COMPLETED` | **Alerte sécu** (post-reset) |
| `auth.email_verification` | `AUTH_EMAIL_VERIFICATION_SENT` | Action utilisateur |
| `auth.mfa.enabled` | `AUTH_MFA_ENABLED` | Confirmation positive |
| `auth.mfa.disabled` | `AUTH_MFA_DISABLED` | **Alerte sécu critique** |

> **Pas de killswitch** sur ce groupe : ces alertes sont critiques et doivent partir même si `notifications.lifecycle.enabled` est OFF.

### 2.10 Subscription (4)

| Template ID | Évènement | Statut |
|---|---|---|
| `subscription.created` | `SUBSCRIPTION_CREATED` | Templates + events prêts ; émission active dans subscription-checkout reste en backlog |
| `subscription.cancelled` | `SUBSCRIPTION_CANCELLED` | idem |
| `subscription.trial_expiring` | `SUBSCRIPTION_TRIAL_EXPIRING` | idem |
| `subscription.payment_failed` | `PAYMENT_INTENT_FAILED` | Event existait déjà (consommé par dunning) |

> Les flows `signup.welcome`, `activation.dayN`, `dunning.D+N`, `renewal.J-3` restent dans leurs services dédiés avec templates inline. Ces 4 templates sont disponibles pour le testeur plateforme et permettent une future migration unifiée.

---

## 3. Garde-fous appliqués partout

| Règle | Vérification |
|---|---|
| **Outbox atomique** | Émission DomainEvent dans la même tx Prisma que la mutation d'état (persist callback du WorkflowEngine ou prisma.transact). |
| **tenantId from event, jamais payload** | Tous les listeners lisent `event.tenantId`, jamais `payload.tenantId`. |
| **where: { tenantId } scoping** | Toutes les requêtes Prisma posent tenantId en racine (RLS V6.1 friendly). |
| **Échappement HTML** | `escape()` sur toutes les variables avant injection HTML. |
| **Bouton lien sécurisé** | `safeButton()` rejette les URL non `http(s)://` (anti-XSS). |
| **i18n fr + en bloquants** | 6 autres locales (wo/ln/ktu/ar/pt/es) tombent sur fr par fallback. |
| **Killswitch lifecycle** | `PlatformConfig.notifications.lifecycle.enabled` (sauf groupe `auth` — sécu critique). |
| **Multi-canal** | IN_APP (si userId) + WhatsApp/SMS fallback (si phone) + EMAIL (si email). Sauf `user.invited` et `auth.*` qui sont EMAIL-only. |
| **Fan-out cap** | `notifications.reminders.maxRecipientsPerTrip` (PlatformConfig). |

---

## 4. Testeur plateforme

**Endpoint** : `/admin/platform/email` → bouton "Tester avec modèle" sur chaque ligne provider.

Flow :
1. Combobox listant les 31 templates groupés par `[group] label`
2. Saisie destinataire (email + nom)
3. Choix langue (fr/en, défaut = lang user)
4. Submit → POST `/api/v1/platform/email/providers/:key/send-test`
5. Mail réel envoyé via le provider choisi (peut différer du provider actif)
6. Marqué `category: 'system'` + `tags: ['platform-test', 'template:<id>', 'provider:<key>']` → exclu des stats commerciales

Permission requise : `control.platform.config.manage.global`.

---

## 5. Comment ajouter un nouveau template

1. **Schéma de variables** dans `*-templates.ts` (interface `TemplateVars` + `RenderFn` fr/en).
2. **Descripteur** dans `*.descriptors.ts` avec `sampleVars`, `recipientNameVar`.
3. **Référencer** dans `registry.ts` (`ALL_DESCRIPTORS`).
4. **Émetteur** : ajouter le DomainEvent dans `domain-event.type.ts` + émission depuis le service métier (Outbox tx).
5. **Listener** : nouveau `*.listener.ts` ou ajouter une `eventBus.subscribe()` dans un listener existant.
6. **Wiring** : enregistrer comme provider dans `notification.module.ts`.
7. **Tests** : `test/unit/notification/<group>-templates.spec.ts` (rendu fr/en, XSS, fallback) + `test/unit/notification/<group>-notification.listener.spec.ts` (subscribe, fan-out, killswitch, sécurité tenantId).

Le template apparaît automatiquement dans le testeur plateforme dès que le registre est rebuild.
