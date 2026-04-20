# Annonces gare — pipeline temps réel

> Diffusion d'annonces voyageurs (écrans gare, portail voyageur, app mobile)
> déclenchées automatiquement par le cycle de vie des trajets OU saisies
> manuellement depuis `/admin/display/announcements`.

---

## TL;DR

```
┌─────────────────┐     ┌──────────────────────┐     ┌────────────────┐
│ Trip lifecycle  │     │ AnnouncementService  │     │  EventBus      │
│ TRIP_STARTED    │────▶│  .create / .update   │────▶│ (outbox pattern)│
│ TRIP_DELAYED    │     │  .createAuto         │     │                │
│ TRIP_CANCELLED  │     │                      │     └───────┬────────┘
│ TRIP_COMPLETED  │     │   (tx intra-DB)     │             │
│ TRIP_PAUSED     │     └──────────────────────┘             ▼
│ INCIDENT_SOS    │              ▲                  ┌──────────────────┐
└─────────────────┘              │                  │ OutboxPoller     │
         │                       │                  │ + RedisPublisher │
         │ @subscribe            │                  └────────┬─────────┘
         ▼                       │                           │
┌─────────────────────────┐      │                           ▼
│ AnnouncementTripListener│──────┘              ┌─────────────────────┐
│  (map event → template) │                     │ Redis pub/sub       │
└─────────────────────────┘                     │ translog:{t}:{type} │
                                                └──────────┬──────────┘
                                                           │
                            ┌──────────────────────────────┼─────────────────────────┐
                            ▼                              ▼                         ▼
                   ┌────────────────┐           ┌──────────────────┐       ┌──────────────────┐
                   │ DisplayGateway │           │ RealtimeService  │       │ Public REST      │
                   │ Socket.io /WS  │           │ SSE authentifié  │       │ polling 30s      │
                   └───────┬────────┘           └─────────┬────────┘       └─────────┬────────┘
                           │                              │                          │
                           ▼                              ▼                          ▼
              ┌────────────────────────┐    ┌──────────────────────┐   ┌──────────────────────┐
              │ DepartureBoard (admin) │    │ DepartureBoard (SSE) │   │ PortailVoyageur     │
              │ /admin/display/gare    │    │ useAnnouncements     │   │ (public anonyme)    │
              │                        │    │  mode:'authenticated'│   │  mode:'public'      │
              └────────────────────────┘    └──────────────────────┘   └──────────────────────┘
```

---

## 1. Producteurs

### 1.1 Auto — `AnnouncementTripListener`

[`src/modules/announcement/announcement-trip.listener.ts`](../src/modules/announcement/announcement-trip.listener.ts)

| Événement DomainEvent         | Type annonce  | Priorité | TTL  | Gare scope         |
|-------------------------------|---------------|----------|------|--------------------|
| `trip.started`                | `BOARDING`    | 5        | 30m  | `route.originId`   |
| `trip.delayed`                | `DELAY`       | 7        | 120m | `route.originId`   |
| `trip.cancelled`              | `CANCELLATION`| 9        | 240m | `route.originId`   |
| `trip.completed`              | `ARRIVAL`     | 3        | 15m  | `route.originId`   |
| `trip.paused`                 | `SUSPENSION`  | 7        | 60m  | `route.originId`   |
| `incident.sos`                | `SECURITY`    | 10       | 120m | `payload.stationId`|

Titre + message rendus fr/en via templates inline ([listener.ts:43-91](../src/modules/announcement/announcement-trip.listener.ts#L43-L91)). La langue est lue depuis `Tenant.language`.

**Idempotence** : chaque `DomainEvent.id` est stocké dans `Announcement.sourceEventId` avec contrainte unique `(tenantId, sourceEventId)`. L'outbox retry → `P2002` capturé → retourne l'annonce existante. Pas de doublons.

### 1.2 Manuel — UI admin

[`/admin/display/announcements`](../frontend/components/pages/PageAnnouncements.tsx) → `POST /api/v1/tenants/:tid/announcements` → `AnnouncementService.create()`.

Permission : `control.announcement.manage.tenant` (TENANT_ADMIN par défaut).

`source = 'MANUAL'`, `sourceEventId = null`. Pas de TTL forcé — l'admin choisit `endsAt`.

---

## 2. Modèle Prisma

[`prisma/schema.prisma:3342-3367`](../prisma/schema.prisma#L3342)

```prisma
model Announcement {
  id            String    @id @default(cuid())
  tenantId      String
  stationId     String?            // null = diffuse tenant global
  title         String
  message       String
  type          String    @default("INFO")
  priority      Int       @default(0)
  isActive      Boolean   @default(true)
  startsAt      DateTime  @default(now())
  endsAt        DateTime?
  createdById   String?
  source        String    @default("MANUAL")  // MANUAL | AUTO
  sourceEventId String?                        // id DomainEvent, idempotence
  tripId        String?                        // contexte (trip lifecycle)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  tenant  Tenant   @relation(...)
  station Station? @relation(...)

  @@unique([tenantId, sourceEventId])
  @@index([tenantId, isActive])
  @@index([tenantId, stationId, isActive])
  @@index([tenantId, tripId])
  @@map("announcements")
}
```

Types canoniques : `INFO | DELAY | CANCELLATION | SECURITY | PROMO | CUSTOM | BOARDING | ARRIVAL | SUSPENSION`.

---

## 3. Broadcast (EventBus → WebSocket)

### 3.1 Publication intra-transaction

`AnnouncementService.create / update / remove / createAuto` publient toujours dans `prisma.transact(...)` via `IEventBus.publish(event, tx)` — pattern **Outbox** ([outbox.service.ts](../src/infrastructure/eventbus/outbox.service.ts)).

Nouveaux `EventTypes` ([`domain-event.type.ts`](../src/common/types/domain-event.type.ts)) :
- `announcement.created`
- `announcement.updated`
- `announcement.deleted`

Payload type (inclut `citySlug` pré-résolu pour fan-out DisplayGateway existant) :

```ts
{
  announcementId: string;
  stationId:      string | null;
  tripId:         string | null;
  citySlug:       string | null;   // "brazzaville", "pointe-noire"…
  type:           string;
  priority:       number;
  title:          string;
  message:        string;
  startsAt:       string;  // ISO
  endsAt:         string | null;
  isActive:       boolean;
  source:         'MANUAL' | 'AUTO';
}
```

### 3.2 DisplayGateway (Socket.io `/realtime`)

[`display.gateway.ts:87-106`](../src/modules/display/display.gateway.ts#L87)

Déjà branché : chaque événement Redis `translog:{tenantId}:{type}` est fan-outé vers :
- `tenant:{tenantId}` (tous les abonnés du tenant)
- `tenant:{tenantId}:city:{citySlug}` (si `payload.citySlug` présent)

**Aucun changement requis** — l'annonce transite par le même pipe que les autres événements du domaine (tickets, GPS, incidents).

### 3.3 RealtimeController (SSE authentifié)

[`realtime.controller.ts:30-46`](../src/modules/realtime/realtime.controller.ts#L30)

`GET /api/tenants/:tenantId/realtime/events` — stream SSE filtré par tenantId. Permission `stats.read.tenant`. Le payload est désormais exposé (précédemment stripé).

### 3.4 Endpoint public (polling anonyme)

[`public-portal.controller.ts`](../src/modules/public-portal/public-portal.controller.ts) + [`public-portal.service.ts`](../src/modules/public-portal/public-portal.service.ts)

`GET /api/public/:tenantSlug/portal/announcements?stationId=...`

Réponse : annonces actives (`isActive + startsAt ≤ now + endsAt null|≥now`). Pas de secrets (pas de `createdById`, pas de `sourceEventId`). Rate-limit 60/min/IP.

---

## 4. Consumers

### 4.1 DepartureBoard (écrans gare admin)

[`frontend/components/display/DepartureBoard.tsx`](../frontend/components/display/DepartureBoard.tsx)

```tsx
const { announcements } = useAnnouncements({
  mode:      'authenticated',
  tenantId,
  stationId,
  enabled:   !!tenantId && tenantId !== 'demo',
});

{announcements.length > 0 && (
  <AnnouncementTicker announcements={announcements} lang={lang} />
)}
```

Bandeau défilant au-dessus du Ticker météo/notif.

### 4.2 PortailVoyageur (public anonyme)

[`frontend/components/portail-voyageur/PortailVoyageur.tsx`](../frontend/components/portail-voyageur/PortailVoyageur.tsx)

```tsx
const { announcements: portalAnnouncements } = useAnnouncements({
  mode:       'public',
  tenantSlug,
  enabled:    !!tenantSlug,
});

{portalAnnouncements.length > 0 && (
  <AnnouncementTicker
    announcements={portalAnnouncements}
    lang={lang}
    className="sticky top-0 z-50"
  />
)}
```

Polling 30s. Pas de SSE (portail anonyme, pas de session).

### 4.3 Composant `AnnouncementTicker`

[`frontend/components/display/AnnouncementTicker.tsx`](../frontend/components/display/AnnouncementTicker.tsx)

- Tri par priorité desc, concatène title+message
- Couleur de fond selon type (rouge sécurité, orange suspension, vert embarquement, etc.)
- `aria-live="assertive"` + `role="alert"` si au moins une annonce SECURITY/CANCELLATION (ou priorité ≥ 9)
- Pause au hover / focus (WCAG 2.2.2)
- `prefers-reduced-motion` → carousel 5s/item au lieu du défilement
- Dark + Light + RTL natif

### 4.4 Hook `useAnnouncements`

[`frontend/lib/hooks/useAnnouncements.ts`](../frontend/lib/hooks/useAnnouncements.ts)

Deux modes :
- `authenticated` : SSE (`useRealtimeEvents`) + refresh toutes les 60s
- `public` : polling REST toutes les 30s

Merge optimiste du payload SSE + refetch authoritative derrière.

### 4.5 Stubs backlog

| Consumer       | État   | TODO                                              |
|----------------|--------|---------------------------------------------------|
| TTS (haut-parleurs gare) | Non implémenté | listener séparé qui consomme `announcement.created`, appelle Twilio/ElevenLabs SSML depuis Vault |
| SMS notification voyageur | Non implémenté | extension `NotificationService.sendWithChannelFallback`, filtrage par segment CRM (VIP / FREQUENT) |
| App mobile driver | Stub | exposer la room Socket.io `/realtime` + push FCM pour les `SECURITY` |
| Apps mobiles voyageur | Stub | polling `/public/:slug/portal/announcements` + notifications push |

---

## 5. Permissions & sécurité

| Permission                          | Rôle défaut | Usage                            |
|-------------------------------------|-------------|----------------------------------|
| `control.announcement.read.agency`  | tout admin  | lecture admin (page CRUD)        |
| `control.announcement.manage.tenant`| TENANT_ADMIN| CRUD manuel (UI admin)           |
| `stats.read.tenant`                 | TENANT_ADMIN| stream SSE (inclut `announcement.*`) |

Le portail public est **anonyme** — rate-limit IP, pas de session requise, pas de données sensibles exposées.

La WS Socket.io `/realtime` requiert un token Better Auth valide (`Session` table).

---

## 6. Tests

- `test/unit/announcement/announcement.service.spec.ts` — CRUD + broadcast + idempotence (6 tests)
- `test/unit/announcement/announcement-trip.listener.spec.ts` — mapping 6 événements + fallback lang + trip introuvable (8 tests)
- **Total : 14 tests unit** — intégrés à la suite (`npx jest --config jest.unit.config.ts`).

Tests Playwright E2E restants (backlog) :
- `test/playwright/announcements-ticker.pw.spec.ts` — création annonce admin → apparition ticker DepartureBoard
- `test/playwright/announcements-portal.pw.spec.ts` — endpoint public retourne annonces actives, bandeau visible sur portail

---

## 7. i18n

Namespace `announcements.*` — fr+en obligatoires ([`fr.ts`](../frontend/lib/i18n/locales/fr.ts), [`en.ts`](../frontend/lib/i18n/locales/en.ts)). 6 autres locales (wo, ln, ktu, ar, pt, es) à propager — voir [TODO_i18n_propagation.md](./TODO_i18n_propagation.md).

Les templates des annonces AUTO (listener) sont rendus côté backend avec fr/en uniquement, selon `Tenant.language`.

---

## 8. Roadmap (backlog documenté)

1. TTS / haut-parleurs gare — listener séparé qui lit `announcement.created`, appelle un provider SSML (ElevenLabs/Azure TTS).
2. SMS voyageurs segmentés — filtrage CRM (VIP, FREQUENT) + opt-in `Customer.preferences.channels.sms`.
3. Push mobile FCM — priorité 9+ → notif directe, priorité < 9 → in-app uniquement.
4. Page admin filtrable par `source` (MANUAL vs AUTO), `type`, `priority`, `stationId`.
5. Historique/archives — `isActive=false` gardées 90j avant purge (job cron).
6. i18n 6 locales restantes.
