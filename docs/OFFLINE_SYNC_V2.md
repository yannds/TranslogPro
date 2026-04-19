# Offline sync v2 — design & roadmap

## Contexte

v1 (Sprints 2 + 9 + 12) implémente :
- Lecture : cache IDB/SQLite read-through (`useOfflineList` web / pattern identique mobile).
- Écriture : outbox unidirectionnelle avec idempotency-key et backoff exponentiel.

Limites actuelles :
1. **Pas de conflict resolution** — si deux appareils modifient la même entité offline, le dernier à resync gagne (last-write-wins). Inacceptable pour caisse + manifest.
2. **Pas de prefetch actif** — on ne télécharge que ce que l'utilisateur demande. Cash-register opens quand online, puis la perte de réseau → plus de données fraîches.
3. **Pas de reconciliation server → client** — si le serveur annule/modifie un ticket en server-side (admin), le mobile ne le sait que s'il re-fetch.

## Objectifs v2

| Besoin | Impact utilisateur |
|---|---|
| Prefetch des trips du jour + tickets + seatmap à chaque login | Caissier part terrain sans perdre 3 min à warmer le cache. |
| Push server → client après mutation admin (WebSocket ou SSE) | Annulation/remboursement propagé instantanément. |
| Conflict detection sur update (version/etag) | Deux agents qui cash-in simultanément ne se shadow pas. |
| Optimistic UI | Feedback instantané + rollback propre sur rejet serveur. |

## Architecture cible

```
┌─────────────────────────────────────────────────────────────┐
│ Mobile / Web SPA                                            │
│ ┌───────────────┐        ┌────────────────────────────────┐ │
│ │ useOfflineList│───────▶│  LocalStore (IDB / SQLite)     │ │
│ │ useOfflineEdit│        │   ├─ reads: network-first      │ │
│ └───────────────┘        │   ├─ writes: optimistic        │ │
│        │                 │   └─ version: ETag per entity  │ │
│        ▼                 └────────────────────────────────┘ │
│ ┌───────────────┐        ┌────────────────────────────────┐ │
│ │   Outbox      │───────▶│   Sync Engine                  │ │
│ └───────────────┘        │   ├─ PUSH : POST ?if-match=ETag │ │
│                          │   ├─ PULL : WS /subscribe      │ │
│                          │   └─ Conflict : merge callback │ │
│                          └────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

## Plan d'implémentation

### Backend

1. Ajouter une colonne `version` (already present on Trip/Ticket) et exposer en ETag via interceptor.
2. `POST`/`PATCH` acceptent `If-Match: "<version>"` → 412 Precondition Failed si mismatch.
3. Endpoint WebSocket `/ws/sync/:tenantId` (auth via cookie ou Bearer) — pousse les `{ entity, id, version, delta }` des entités que le client a souscrites.
4. Endpoint `GET /sync/bootstrap?entities=trips,tickets,registers` — payload optimisé pour un cold-start offline (N jours + paginé).

### Frontend (web + mobile)

5. `<SyncProvider>` qui maintient la WS connectée dès login, dispatche vers les tables IDB/SQLite.
6. `useOfflineEdit<T>(fn)` hook :
   - Écrit dans IDB immédiatement (optimistic).
   - Pousse via outbox avec `If-Match`.
   - 412 → reload l'entité, exécute `onConflict(local, remote)` fourni par le caller.
7. `prefetchDailyBundle()` au login : appelle `/sync/bootstrap`, alimente IDB en masse.

### Conflict resolution par entité

| Entité | Stratégie |
|---|---|
| Ticket (status) | Serveur gagne (workflow validé server-side). Client force-refresh. |
| Transaction caisse | Append-only — pas de conflit (clé externalRef idempotente). |
| Manifest (signature) | Le premier signe l'emporte. 412 → message "Déjà signé par X". |
| Incident (custom note) | Merge automatique (concat des notes + tri temporel). |

## Sécurité

- WS authentifiée par la session existante + bind strict tenantId (message reçu != tenant → drop + log).
- ETag / If-Match empêchent les overwrites cross-user.
- `bootstrap` rate-limit strict (1/min/user) pour éviter un dump du warehouse par bot.
- Pas de payload encrypté-at-rest différent du reste — on s'appuie sur Keychain mobile + IndexedDB (same-origin web).

## Dette réalisée par ce sprint

- Zéro code — livre uniquement le design. L'implémentation complète = 4-6 semaines et nécessite un backend WS (module Nest existant via socket.io, à réutiliser).
