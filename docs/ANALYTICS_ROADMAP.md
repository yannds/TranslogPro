# Analytics avancés & BI export — roadmap

## Contexte

Sprint 20 du plan de livraison. L'existant couvre :
- `AnalyticsService.getDashboard()` — compteurs agrégés en temps réel.
- `AnalyticsService.getKpis()` — KPIs lean (Sprint 8).
- `AnalyticsService.getTripsReport()` / `getRevenueReport()` — par période.
- `AnalyticsService.getTopRoutes()` / `getCustomerSegmentation()`.

Limites actuelles :
1. Toutes les agrégations font des `prisma.count / aggregate` direct sur la DB prod → coût croissant avec le volume.
2. Pas d'historique conservé pour compter un "nombre de tickets le 3 mars 2024" quand les opérations tournent sur la DB chaude.
3. Pas d'export vers un outil BI (Metabase / Looker / Superset).

## Architecture cible

```
                   ┌─────────────────────────┐
Prod DB (Postgres) │ tenants, tickets, trips │
                   └──────────┬──────────────┘
                              │  CDC (Debezium / wal2json) — nightly
                              ▼
                   ┌─────────────────────────┐
Warehouse (CH)     │ ClickHouse / Snowflake  │
                   │   schema: analytics.*    │
                   └──────────┬──────────────┘
                              │  SQL direct
                              ▼
                   ┌─────────────────────────┐
BI                 │ Metabase / Looker      │
                   │   dashboards tenant-    │
                   │   scoped (row-level)    │
                   └─────────────────────────┘
```

## Livrables du sprint

### Backend

1. Nouveau module `analytics-warehouse/` :
   - Service `WarehouseExportService` — nightly cron qui lit les tables opérationnelles et écrit des lignes dans `analytics.fact_ticket`, `analytics.fact_parcel`, `analytics.fact_trip`.
   - Pas d'agrégation pré-calculée côté ce module — on stocke l'événement brut.

2. Endpoint `GET /tenants/:tid/analytics/export?format=csv&from=&to=` :
   - Stream CSV tenant-scopé + agency-filtered si scope=agency.
   - Header Content-Disposition avec filename signé + date pour traçabilité RGPD.
   - Rate-limit 10/h/user.

3. Endpoint `GET /tenants/:tid/analytics/cube?dimensions=&measures=` :
   - Grammaire légère inspirée de Cube.js. Permet au frontend de composer des agrégats arbitraires.
   - Exemple : `dimensions=route.name,fareClass & measures=tickets.count,revenue.sum & from=...`.

### Frontend

4. Page `PageAnalyticsCube` — composeur graphique de requêtes :
   - Sélecteur dimensions + mesures (drag-drop ou dropdowns).
   - Rendering Victory Native (mobile) / Recharts (web).
   - Export CSV via le endpoint ci-dessus.

5. Widgets tenant-home :
   - Carte "ventes 30 j" (sparkline)
   - Top 3 routes
   - Écart caisse cumulé (lien vers PageCashDiscrepancies).

### Mobile

6. Écran Admin → "Rapport hebdo" — résumé 7 jours avec export CSV via `expo-sharing`.

## Sécurité

- **Row-level security sur le warehouse** : chaque tenant ne voit que ses données, enforcement au niveau Metabase/Looker via row filters sur `tenant_id`.
- **Audit accès rapports** : chaque export CSV logue dans AuditLog (`data.analytics.export.tenant`).
- **Anonymisation** : pas de PII dans le DW (email/phone → hash SHA256 avec salt tenant). Re-identification impossible hors tenant.
- **Rétention** : 3 ans compressés (conforme comptabilité) puis purge.

## Dépendances

- Choix DW : ClickHouse self-hosted (économique) vs Snowflake (ops réduites). Trancher avant d'implémenter.
- Déclenchement cron : `@nestjs/schedule` suffit pour un nightly ; au-delà → Temporal / AWS Step Functions.

## Estimation

~ 3 semaines dev en parallèle d'un autre sprint. Non bloquant pour les apps mobile MVP. Priorité B.
