# TransLog Pro — Manuel d'utilisation Dashboard KPI SaaS plateforme

> Guide opérationnel post-déploiement. Cible : SUPER_ADMIN, SUPPORT_L1, SUPPORT_L2, ops DevOps.
> Créé 2026-04-20. Complément de référence technique : [PLATFORM_KPI.md](PLATFORM_KPI.md).

---

## 1. État appliqué en production locale (2026-04-20)

### 1.1 Schéma DB — changements déjà persistés

| Objet | Type | Source |
|---|---|---|
| `tenants.estimatedOperationsMonthly` | colonne `jsonb` nullable | Sprint 1 `aabb059` |
| `subscription_changes` | nouvelle table + 4 index + 4 FK | Sprint 1 `aabb059` |
| `platform_kpi_snapshots` | nouvelle table + 1 unique + 1 index | Sprint 1 `aabb059` |
| 4 permissions `data.platform.kpi.*.read.global` | rows dans `role_permissions` | Sprint 3 `9a68c1b` |
| 3 entrées `subscription_changes` (NEW) | data via backfill | Sprint post-7 |

### 1.2 Matrice permissions appliquée aux rôles système

```
SUPER_ADMIN (roleId=...) — 4 perms KPI
  data.platform.kpi.adoption.read.global
  data.platform.kpi.business.read.global
  data.platform.kpi.ops.read.global
  data.platform.kpi.retention.read.global

SUPPORT_L1 (roleId=...) — 2 perms KPI
  data.platform.kpi.adoption.read.global
  data.platform.kpi.ops.read.global

SUPPORT_L2 (roleId=...) — 3 perms KPI
  data.platform.kpi.adoption.read.global
  data.platform.kpi.ops.read.global
  data.platform.kpi.retention.read.global
```

Conséquence UI : sur `/admin/platform/dashboard`, chaque section n'apparaît que si l'utilisateur a la permission correspondante. SUPER_ADMIN voit tout, SUPPORT_L1 voit 6/7 sections (pas le MRR), SUPPORT_L2 voit 7/7 sans MRR.

---

## 2. Procédure de backup / restore

### 2.1 Backup réalisé

Emplacement : `/Users/dsyann/TranslogPro-backups/` (hors repo git, jamais commité).

```
translog-before-kpi-sprint-20260420-114313.dump    2.6 MB  (pg_restore custom format)
translog-before-kpi-sprint-20260420-114313.sql      18 MB  (SQL plain, lisible)
```

Contenu : **131 tables avec données**, y compris `_prisma_migrations`, `roles`, `role_permissions`, `tenants`, `plans`, `platform_subscriptions`, `users`, `platform_config` et les 2 nouvelles tables KPI.

### 2.2 Procédure de restore (si rollback nécessaire)

**Attention** : un restore **écrase** les données actuelles. Toujours re-dumper l'état courant AVANT le restore.

```bash
# 1. Safety dump de l'état actuel (au cas où)
docker exec translog-postgres pg_dump \
  --dbname="postgresql://app_user:app_password@localhost/translog" \
  --format=custom --no-owner --no-privileges \
  --file="/tmp/pre-restore-$(date +%s).dump"

# 2. Restore depuis le backup pré-sprint KPI
docker cp /Users/dsyann/TranslogPro-backups/translog-before-kpi-sprint-20260420-114313.dump \
  translog-postgres:/tmp/restore.dump

docker exec translog-postgres pg_restore \
  --dbname="postgresql://app_user:app_password@localhost/translog" \
  --clean --if-exists --no-owner --no-privileges \
  /tmp/restore.dump

# 3. Vérifier
docker exec translog-postgres psql \
  --dbname="postgresql://app_user:app_password@localhost/translog" \
  -c "SELECT count(*) FROM tenants; SELECT count(*) FROM users;"
```

### 2.3 Backup régulier recommandé

Ajouter un cron quotidien (à configurer par DevOps) :

```bash
# /etc/cron.daily/translog-backup ou équivalent
#!/bin/bash
BACKUP_DIR=/var/backups/translog
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p $BACKUP_DIR
docker exec translog-postgres pg_dump \
  --dbname="postgresql://app_user:app_password@localhost/translog" \
  --format=custom --no-owner \
  --file="/tmp/daily-${TS}.dump"
docker cp translog-postgres:/tmp/daily-${TS}.dump $BACKUP_DIR/
docker exec translog-postgres rm -f /tmp/daily-${TS}.dump
# Rotation 30 jours
find $BACKUP_DIR -name "daily-*.dump" -mtime +30 -delete
```

---

## 3. Utilisation du dashboard (côté utilisateur final)

### 3.1 Accès

URL : `https://admin.translog.<domain>/admin/platform/dashboard` (sous-domaine admin plateforme).
Auth : Session SA/L1/L2 active. `PlatformTenantGuard` bloque tout autre utilisateur avec 403.

### 3.2 Sections disponibles (montage conditionnel)

Chaque section ne se monte qu'avec la permission correspondante. Ordre d'affichage :

| # | Section | ID DOM | Permission requise | Description |
|---|---|---|---|---|
| 1 | North Star | `#pk-northstar` | adoption | % ops via SaaS (3 modes : déclaratif/heuristique/comparé) |
| 2 | Business & Traction | `#pk-mrr` | **business (SA only)** | MRR, ARR, ARPU, net new, par plan |
| 3 | Activité transactionnelle | `#pk-transactional` | adoption | Billets, GMV, trajets, ponctualité |
| 4 | Adoption détaillée | `#pk-adoption-detail` | adoption | DAU/MAU STAFF/DRIVER/CUSTOMER + modules |
| 5 | Activation (early stage) | `#pk-activation` | adoption | Funnel 4 étapes |
| 6 | Rétention cohortes | `#pk-retention` | **retention (SA + L2)** | D7/D30/D90 par mois de signup |
| 7 | KPI stratégiques | `#pk-strategic` | adoption | Dépendance SaaS, top tenants actifs |

### 3.3 Filtres et interactions

- **Toggle mode North Star** : boutons `Déclaratif | Heuristique | Comparé` en haut de la section 1.
  - *Déclaratif* nécessite que le tenant ait rempli `Tenant.estimatedOperationsMonthly` via `/admin/settings/operations-estimate`. Sinon fallback `Heuristique`.
  - *Heuristique* calcule `actual / (capacity × trips × targetOccupancy)`. `targetOccupancy` configurable (défaut 0.65).
  - *Comparé* affiche les deux.
- **Filtres période** par section : `7j | 14j | 30j | 60j | 90j | 180j | 365j` (selon pertinence).
- **Table tenants** (North Star, Strategic, MRR) : clic ligne = drill-down à venir (extension).
- **Heatmap rétention** : les cellules vert/teal/ambre/rouge indiquent la santé de la cohorte.

### 3.4 Use-case SUPPORT_L1 (non vu : MRR)

Scénario typique : repérer tenants en difficulté pour proposer une action commerciale.

1. Ouvrir `/admin/platform/dashboard`
2. Section **Activation funnel** → identifier les tenants bloqués à `TICKET_SOLD` (ont créé un trip mais pas vendu)
3. Section **Adoption détaillée** → repérer les modules sous-adoptés (barre ambre)
4. Cliquer sur le tenant dans le top 10 des inactifs (section Strategic)
5. Envoyer email via `/admin/platform/support` avec un template "formation/webinaire"

### 3.5 Use-case SUPER_ADMIN (vue complète)

Scénario typique : prépar une revue investisseurs.

1. Section **North Star — mode déclaratif** → % ops via SaaS par tenant (si estimations remplies)
2. Section **Business & Traction** → MRR / ARR / ARPU / croissance MoM, net new MRR avec breakdown new/expansion/contraction/churn
3. Section **Rétention cohortes** → heatmap D30/D90 par mois
4. Section **KPI stratégiques** → dépendance SaaS, actions/user/semaine, top 10 tenants actifs

**Export** : les tableaux utilisent `DataTableMaster` qui supporte CSV / JSON / XLS / PDF (menu contextuel en haut à droite de chaque table).

---

## 4. Administration — Configuration et seeds

### 4.1 Clés `PlatformConfig` (`kpi.*`)

Édition via `/admin/platform/settings` (SA only) ou SQL direct.

| Clé | Type | Défaut | Rôle |
|---|---|---|---|
| `kpi.targetOccupancyRate` | 0..1 | 0.65 | Taux occupation cible (North Star heuristique) |
| `kpi.defaultPeriodDays` | 1..365 | 30 | Période par défaut KPI |
| `kpi.moduleAdoptionThreshold` | 0..1 | 0.3 | Seuil adoption module |
| `kpi.cacheTtlSeconds` | 10..3600 | 60 | TTL cache KPI en mémoire |
| `kpi.activation.minTickets` | 1..1000 | 1 | Seuil billets pour étape `TICKET_SOLD` |
| `kpi.activation.minTrips` | 1..1000 | 1 | Seuil trajets pour étape `TRIP_CREATED` |

**Impact édition** : écriture en DB → cache invalidé à la prochaine lecture (max 60s). Pas de redéploiement nécessaire.

SQL direct (cas d'urgence) :
```sql
UPDATE platform_config SET value = '0.7', "updatedBy" = 'admin-sql', "updatedAt" = now()
  WHERE key = 'kpi.targetOccupancyRate';
-- Créer si absent :
INSERT INTO platform_config (key, value, "updatedBy")
  VALUES ('kpi.targetOccupancyRate', '0.7', 'admin-sql')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

### 4.2 Gérer les droits KPI par rôle

**Attribution standard (idempotent)** :

Le fichier `prisma/seeds/iam.seed.ts` définit les permissions à seed pour SUPER_ADMIN, SUPPORT_L1, SUPPORT_L2. La fonction `bootstrapPlatform()` les upsert.

```bash
# Re-exécution idempotente du bootstrap IAM
npx ts-node -e "import('./prisma/seeds/iam.seed').then(m => m.bootstrapPlatform()).then(() => process.exit(0))"
```

Si le bootstrap ne passe pas (cas constaté 2026-04-20), application SQL directe :

```sql
-- SUPER_ADMIN : 4 perms
INSERT INTO role_permissions (id, "roleId", permission)
SELECT md5(r.id || p), r.id, p
FROM roles r CROSS JOIN (VALUES
  ('data.platform.kpi.business.read.global'),
  ('data.platform.kpi.adoption.read.global'),
  ('data.platform.kpi.retention.read.global'),
  ('data.platform.kpi.ops.read.global')
) v(p)
WHERE r."tenantId" = '00000000-0000-0000-0000-000000000000' AND r.name = 'SUPER_ADMIN'
ON CONFLICT ("roleId", permission) DO NOTHING;

-- SUPPORT_L1 : adoption + ops uniquement
INSERT INTO role_permissions (id, "roleId", permission)
SELECT md5(r.id || p), r.id, p
FROM roles r CROSS JOIN (VALUES
  ('data.platform.kpi.adoption.read.global'),
  ('data.platform.kpi.ops.read.global')
) v(p)
WHERE r."tenantId" = '00000000-0000-0000-0000-000000000000' AND r.name = 'SUPPORT_L1'
ON CONFLICT ("roleId", permission) DO NOTHING;

-- SUPPORT_L2 : L1 + retention
INSERT INTO role_permissions (id, "roleId", permission)
SELECT md5(r.id || p), r.id, p
FROM roles r CROSS JOIN (VALUES
  ('data.platform.kpi.adoption.read.global'),
  ('data.platform.kpi.ops.read.global'),
  ('data.platform.kpi.retention.read.global')
) v(p)
WHERE r."tenantId" = '00000000-0000-0000-0000-000000000000' AND r.name = 'SUPPORT_L2'
ON CONFLICT ("roleId", permission) DO NOTHING;
```

**Retirer un droit ponctuellement** (cas exceptionnel) :

```sql
DELETE FROM role_permissions
WHERE "roleId" = (
  SELECT id FROM roles WHERE "tenantId" = '00000000-0000-0000-0000-000000000000' AND name = 'SUPPORT_L1'
)
AND permission = 'data.platform.kpi.adoption.read.global';
```

⚠️ **Toujours faire un backup avant de retirer une permission** (voir §2.3). Ne jamais retirer `data.platform.metrics.read.global` aux rôles L1/L2 — casse le dashboard legacy.

### 4.3 Backfill `SubscriptionChange`

**But** : reconstituer l'historique `SubscriptionChange` à partir des `PlatformSubscription` existantes (entrée NEW pour chaque sub, entrée CHURN pour chaque sub CANCELLED).

**Propriétés** :
- **Idempotent** : ré-exécution = 0 ligne créée si les entrées existent déjà.
- **Robuste aux orphelins** : subscriptions dont le tenant a été supprimé (cascade manquante) sont ignorées avec compteur.
- **Isolé** : ignore `PLATFORM_TENANT_ID`.

```bash
npx ts-node prisma/seeds/subscription-change.backfill.ts
```

Sortie attendue :
```
✅ Backfill SubscriptionChange terminé :
   - N entrées NEW créées
   - M entrées CHURN créées
   - 0 subscriptions ignorées (tenant plateforme)
   - X subscriptions orphelines ignorées (tenant supprimé)
```

**Quand l'exécuter** :
- 1× après livraison sprint KPI (fait 2026-04-20 : 3 NEW, 59 orphelins)
- À chaque import de données legacy
- Jamais automatiquement — c'est un seed one-shot, pas un cron.

### 4.4 Seeds apparentés

| Seed | Usage | Idempotence |
|---|---|---|
| `prisma/seeds/iam.seed.ts` → `bootstrapPlatform()` | Crée PLATFORM_TENANT + rôles SA/L1/L2 + permissions | ✅ upsert |
| `prisma/seeds/iam.seed.ts` → `seedTenantRoles(tenantId)` | Crée rôles tenant (TENANT_ADMIN, AGENCY_MANAGER, etc.) | ✅ upsert |
| `prisma/seeds/plans.seed.ts` | Catalogue plans par défaut | ✅ upsert par slug |
| `prisma/seeds/backfill-subscriptions.ts` | Crée 1 sub TRIAL par tenant sans sub | ✅ skip si sub existe |
| `prisma/seeds/subscription-change.backfill.ts` | Historique SubscriptionChange | ✅ skip si NEW/CHURN existe |
| `prisma/seeds/crm-customer.backfill.ts` | Migration User(CUSTOMER) → Customer | ✅ matching phone/email |

---

## 5. Monitoring & santé du dashboard

### 5.1 Vérifier que les endpoints répondent

```bash
# Login SA pour obtenir une session
curl -c /tmp/sa.jar -X POST https://admin.translog.localhost/api/auth/signin \
  -H "Content-Type: application/json" \
  -d '{"email":"sa@translog.io","password":"..."}'

# Test des 7 endpoints KPI
for ep in north-star mrr retention transactional adoption activation strategic; do
  echo "=== $ep ==="
  curl -s -b /tmp/sa.jar https://admin.translog.localhost/api/platform/kpi/$ep | jq '.|keys'
done
```

Réponse attendue :
- 200 avec payload JSON sur chaque endpoint pour SA
- 403 sur `/mrr` pour SUPPORT_L1
- 403 sur `/retention` pour SUPPORT_L1

### 5.2 Vérifier le cache

Le cache est in-process, TTL configurable (défaut 60s). Deux requêtes identiques à < 60s d'intervalle → pas de second hit DB.

Log à surveiller : si les réponses deviennent lentes (> 2s sur `/platform/kpi/*`), probablement :
- Cache TTL trop court → ↗ `kpi.cacheTtlSeconds`
- Volume de données inattendu → ajouter un pre-aggregate via cron dans `platform_kpi_snapshots`

### 5.3 Vérifier les tests

```bash
# Unit (local, rapide)
npx jest --config jest.unit.config.ts test/unit/platform-kpi/

# Security (sanity)
npx jest --config jest.security.config.ts test/security/platform-kpi-access.spec.ts

# Playwright (nécessite stack up)
npm run test:pw -- platform-kpi
```

---

## 6. Troubleshooting

### 6.1 Section manquante pour un SA

**Symptôme** : un SUPER_ADMIN voit moins de 7 sections.

**Diagnostic** :
```sql
SELECT rp.permission
FROM role_permissions rp
JOIN roles r ON r.id = rp."roleId"
JOIN users u ON u."roleId" = r.id
WHERE u.email = 'sa@translog.io'
  AND rp.permission LIKE '%kpi.%'
ORDER BY rp.permission;
```

**Remède** : ré-appliquer les 4 permissions via le SQL de §4.2.

### 6.2 Endpoints renvoient 0 pour tout

**Symptôme** : North Star `pctViaSaasAvg = null`, MRR = 0 €, activation = 0.

**Diagnostic** :
- Est-ce que `SELECT count(*) FROM tenants WHERE id != '00000000-0000-0000-0000-000000000000' AND "isActive" = true;` > 0 ?
- Si 0, c'est normal : environnement vide.
- Si > 0, vérifier que `PlatformSubscription` et `Ticket` ont des entrées récentes (< 30j).

### 6.3 Playwright `platform-kpi.sa.pw.spec.ts` échoue

**Symptôme** : 9 tests en échec.

**Causes possibles** :
1. Frontend dev server non rebuild → refresh cache browser, rebuild bundle
2. Page cached côté service worker → clear cache Playwright
3. Permissions KPI pas seedées sur la DB de test → rejouer §4.2 sur la DB Playwright

### 6.4 Backfill SubscriptionChange — orphelins

**Symptôme** : beaucoup de lignes "orphelines ignorées".

**Raison** : cleanup E2E passé ayant supprimé des tenants sans cascader les PlatformSubscription. FK actuelle = `ON DELETE RESTRICT` donc théoriquement impossible — mais si elle a été ajoutée *après* les deletes, les orphelins persistent.

**Remède (sans perte de donnée utile)** : supprimer les orphelins manuellement :
```sql
-- PRÉVIEW (à exécuter d'abord)
SELECT count(*) FROM platform_subscriptions s
LEFT JOIN tenants t ON t.id = s."tenantId"
WHERE t.id IS NULL;

-- BACKUP d'abord (voir §2)
-- Puis DELETE
DELETE FROM platform_subscriptions
WHERE "tenantId" NOT IN (SELECT id FROM tenants);
```

---

## 7. Checklist de déploiement (pour référence)

Si vous redéployez l'environnement (nouveau prod, staging, dev partagé) :

- [ ] **1. Schema** : `npx prisma db push` (applique le schema additif KPI)
- [ ] **2. IAM Bootstrap** : `npx ts-node -e "import('./prisma/seeds/iam.seed').then(m => m.bootstrapPlatform())"` (crée PLATFORM_TENANT + 3 rôles + permissions)
- [ ] **3. Vérif perms KPI** : SQL §4.2 (ON CONFLICT DO NOTHING — idempotent)
- [ ] **4. Plans seed** : `npx ts-node prisma/seeds/plans.seed.ts` (si nouveau env)
- [ ] **5. Subscriptions seed** : `npx ts-node prisma/seeds/backfill-subscriptions.ts` (1 TRIAL/tenant sans sub)
- [ ] **6. KPI Backfill** : `npx ts-node prisma/seeds/subscription-change.backfill.ts`
- [ ] **7. Smoke test UI** : login SA → `/admin/platform/dashboard` → 7 sections visibles
- [ ] **8. Smoke test API** : §5.1
- [ ] **9. Playwright** : `npm run test:pw -- platform-kpi`
- [ ] **10. Backup** : §2.3 (cron quotidien)

---

## 8. Références croisées

- **Référence technique** : [PLATFORM_KPI.md](PLATFORM_KPI.md) — archi service, endpoints, tests
- **Schéma Prisma** : [prisma/schema.prisma](../prisma/schema.prisma) (lignes 75-78 pour `estimatedOperationsMonthly`, ~3490 pour `SubscriptionChange`, ~3530 pour `PlatformKpiSnapshot`)
- **Permissions** : [src/common/constants/permissions.ts:291-301](../src/common/constants/permissions.ts)
- **Service** : [src/modules/platform-kpi/platform-kpi.service.ts](../src/modules/platform-kpi/platform-kpi.service.ts)
- **Controller** : [src/modules/platform-kpi/platform-kpi.controller.ts](../src/modules/platform-kpi/platform-kpi.controller.ts)
- **UI sections** : [frontend/components/platform/](../frontend/components/platform/)
- **i18n** : [frontend/lib/i18n/locales/fr.ts](../frontend/lib/i18n/locales/fr.ts) + [en.ts](../frontend/lib/i18n/locales/en.ts) (namespace `platformKpi.*`)
- **TODO 6 locales** : [TODO_i18n_propagation.md](TODO_i18n_propagation.md)

## 9. Contacts & propriétaires

- **Propriétaire produit** : le PO TransLog (voir `TECHNICAL_ARCHITECTURE.md`)
- **Propriétaire tech** : le tech lead backend (modules platform-*) + tech lead frontend (composants platform/)
- **Escalade** : SA via `/admin/platform/support` ou incident majeur → équipe oncall

---

*Dernière mise à jour : 2026-04-20 post Sprint KPI. Mettre à jour après chaque modification du dashboard, des permissions, ou du schéma.*
