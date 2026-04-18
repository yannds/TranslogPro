# Tests Playwright — TransLog Pro

Tests E2E navigateur pour le portail plateforme SaaS + multi-tenant signin + impersonation.

## Architecture

```
test/playwright/
├── global-setup.ts              # Seed E2E + storageState auth par rôle
├── fixtures-portal.ts           # test/expect étendus (apiRequest + cleanupRegister)
├── fixtures.ts                  # fixtures existantes (multi-tenant Prisma)
├── .auth/                       # storageState (gitignoré)
│   ├── super-admin.json
│   └── tenant-admin.json
├── .report/                     # HTML reporter (gitignoré)
│
├── *.setup.pw.ts                # project 'setup' (réservé global-setup)
├── *.sa.pw.spec.ts              # project 'super-admin'  (storageState SA)
├── *.tenant.pw.spec.ts          # project 'tenant-admin' (storageState TA)
├── *.public.pw.spec.ts          # project 'public'       (non-auth)
├── *.api.spec.ts                # project 'api'          (HTTP direct, existants)
└── *.browser.spec.ts            # project 'browser'      (setup complet mkcert/dnsmasq)
```

## Pré-requis

1. **Backend + Frontend up** :
   ```bash
   ./scripts/dev.sh
   ```
   Attendus : Nest `:3000`, Vite `:5173`, Postgres `:5434`, Redis, Vault, MinIO.

2. **Seeds IAM initiaux** :
   ```bash
   npx ts-node prisma/seeds/iam.seed.ts
   ```

3. **Browsers Playwright** (une seule fois) :
   ```bash
   npx playwright install chromium
   ```

Le `global-setup.ts` Playwright lance automatiquement `scripts/seed-e2e.ts`
pour garantir la présence des comptes E2E, donc pas besoin de le lancer à la
main.

## Commandes

| Commande              | Description |
|-----------------------|-------------|
| `npm run test:pw`         | Lance toute la suite headless |
| `npm run test:pw:ui`      | Mode UI interactif (debug visuel) |
| `npm run test:pw:headed`  | Lance headless=false (voir le browser) |
| `npm run test:pw:report`  | Ouvre le dernier rapport HTML |
| `npm run seed:e2e`        | Re-seed les comptes E2E (idempotent) |

### Filtrage par projet

```bash
npx playwright test --project=super-admin           # tests SA uniquement
npx playwright test --project=tenant-admin          # tests tenant uniquement
npx playwright test --project=public                # tests non-auth uniquement
npx playwright test --project=api                   # tests HTTP existants
```

### Un seul fichier / un seul test

```bash
npx playwright test test/playwright/platform-dashboard.sa.pw.spec.ts
npx playwright test -g "crée un nouveau plan"
```

### Debug

```bash
npx playwright test --debug                                  # inspector Playwright
npx playwright test --project=super-admin --headed           # voir le browser
```

## Comptes E2E seedés

| Rôle | Email | Mot de passe | Tenant |
|------|-------|--------------|--------|
| SUPER_ADMIN  | `e2e-sa@translog.test`       | `Passw0rd!E2E` | plateforme (`__platform__`) |
| TENANT_ADMIN | `e2e-tenant-admin@e2e.local` | `Passw0rd!E2E` | `pw-e2e-tenant` |

Ces comptes sont recréés / réinitialisés à chaque run (mot de passe refreshed)
par `scripts/seed-e2e.ts`.

## Convention de nommage

| Suffixe | Project | Storage state | Usage |
|---------|---------|---------------|-------|
| `*.sa.pw.spec.ts` | `super-admin` | `super-admin.json` | Pages `/admin/platform/*` |
| `*.tenant.pw.spec.ts` | `tenant-admin` | `tenant-admin.json` | Pages `/admin/*` côté tenant |
| `*.public.pw.spec.ts` | `public` | aucun | Login page, redirections |
| `*.api.spec.ts` | `api` | aucun | HTTP direct (multi-tenant, impersonation) |
| `*.browser.spec.ts` | `browser` | aucun | Setup complet (mkcert, dnsmasq) |

Un test **doit** porter le suffixe adapté — sinon il ne sera exécuté par aucun
project. C'est volontaire : force la discipline sur le contexte auth.

## Rédiger un nouveau test

```ts
import { test, expect } from './fixtures-portal';

test.describe('[pw:sa] Ma fonctionnalité', () => {
  test('fait quelque chose', async ({ page, apiRequest, cleanupRegister }) => {
    await page.goto('/admin/platform/...');
    await expect(page.getByRole('heading')).toContainText(/.../);

    // Cleanup DB automatique en fin de test
    cleanupRegister(async () => {
      await apiRequest.delete('/api/.../xxx');
    });
  });
});
```

## CI

En CI :
- `CI=1 npm run test:pw` → retry x1 automatique
- `forbidOnly: true` (bloque tout `.only`)
- Rapport HTML uploadé en artifact (`test/playwright/.report`)

## Troubleshooting

**Erreur "Login échoué HTTP 401"** dans globalSetup :
- La DB n'a pas les rôles IAM → `npx ts-node prisma/seeds/iam.seed.ts`
- L'API Nest n'est pas up → `./scripts/dev.sh`

**Erreur "Vite KO"** :
- Vite pas démarré → `cd frontend && npm run dev` (ou `./scripts/dev.sh`)

**Tests bloqués** :
- Cache storageState corrompu → `rm -rf test/playwright/.auth && npm run test:pw`

**Rate-limit 429 sur sign-in** :
- Le fixtures.ts appelle `FLUSHDB` sur Redis avant chaque test. Si Redis pas
  accessible, lance manuellement : `docker exec -it translog-redis redis-cli FLUSHDB`
