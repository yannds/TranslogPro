# Security checklist — passage en production

> **À exécuter AVANT toute mise en production du repo ou du produit.**
> Tant que nous sommes en dev local, certains raccourcis sont tolérés —
> ce document liste ce qu'il faut impérativement nettoyer/faire avant prod.

## 1. Secrets dans l'historique Git

### `.claude/settings.json` — passwords de test DEV en allow-list bash

Le fichier `.claude/settings.json` contenait (jusqu'à commit `68fea08`) des
commandes `curl` avec le password dev `Admin1234!` du compte seed
`ncho@fa.cg` sur le tenant `trans-express` (cf. `scripts/seed-e2e.ts`).

**Le 2026-04-20**, le fichier a été retiré du tracking (`.gitignore`) pour
ne plus être publié. Mais **l'historique Git contient encore les versions
précédentes** — un attaquant qui clone le repo peut encore y trouver le
password via `git log` / `git show`.

**Actions à faire AVANT prod :**

1. **Rotation du password test** `Admin1234!` → nouveau password aléatoire
   - Modifier `scripts/seed-e2e.ts` (SHARED_PASSWORD)
   - Modifier `test/playwright/global-setup.ts` et specs qui l'utilisent
   - Re-seed : `npm run db:reset && npm run seed:e2e`

2. **Nettoyer l'historique Git** (ne supprime pas le contenu, réécrit les
   commits pour retirer le fichier de toutes les versions antérieures) :
   ```bash
   # Option A — BFG Repo-Cleaner (recommandé, rapide)
   brew install bfg
   git clone --mirror git@github.com:yannds/TranslogPro.git
   cd TranslogPro.git
   bfg --delete-files settings.json --no-blob-protection
   git reflog expire --expire=now --all && git gc --prune=now --aggressive
   git push --force

   # Option B — git-filter-repo
   pip install git-filter-repo
   git filter-repo --path .claude/settings.json --invert-paths
   git push --force origin main
   ```
   ⚠️ **Destructif** : oblige tous les collaborateurs à re-cloner.
   À faire pendant une fenêtre de maintenance annoncée.

3. **Audit complet des secrets** avant de rendre le repo public :
   ```bash
   # Installer trufflehog ou gitleaks
   brew install gitleaks
   gitleaks detect --source . --verbose
   ```

## 2. Credentials backend

### `.env` local vs prod

- ✅ `.env` est dans `.gitignore` — OK
- ✅ Aucun `*.env` committé (vérifié par `gitleaks`)
- ⚠️ Vérifier que `DATABASE_URL`, `REDIS_PASSWORD`, `VAULT_TOKEN` sont bien
  lus depuis un `VaultService` / AWS Secrets Manager / `sops` en prod —
  jamais en clair dans un `.env.production`.

### Seeds de test

- `prisma/seeds/iam.seed.ts` — OK, crée rôles/permissions, pas de password
- `scripts/seed-e2e.ts` — CONTIENT `SHARED_PASSWORD = 'Passw0rd!E2E'`
  → à rotate AVANT prod + à mettre en variable d'env

## 3. Hygiène multi-tenant

### Checklist avant prod

- [ ] Tous les endpoints ont un `@RequirePermission` ou sont publics par design
- [ ] Tous les services Prisma filtrent par `tenantId` à la racine
- [ ] `PlatformTenantGuard` empêche les accès *.global depuis un tenant standard
- [ ] Tests `test/security/*` tous au vert
- [ ] RLS Postgres activée sur les tables sensibles (ticket, parcel, user)
- [ ] Audit-log activé sur toutes les actions control.* (permissions *.manage.*)

## 4. Test-only code en prod

### Code à supprimer / gater derrière `NODE_ENV === 'dev'`

- [ ] `scripts/seed-e2e.ts` — ne doit jamais s'exécuter en prod
- [ ] `TestAuthGuard` (si présent) — désactivé en prod
- [ ] Mock providers (`test/helpers/mock-providers.ts`) — out de dist
- [ ] Endpoints `/__dev__/*` éventuels — retirer

## 5. Monitoring & alertes prod

- [ ] Sentry ou équivalent branché
- [ ] Health-check endpoint sécurisé (auth minimum)
- [ ] Metrics dashboard (Grafana / Datadog)
- [ ] Alertes sur : taux d'erreur 5xx, tentatives auth échouées, latence p99

---

**Date création :** 2026-04-20 — Sprint 11
**Rappel créé suite à :** commit `68fea08` poussant `.claude/settings.json` avec passwords dev
**Responsable review :** tenant-admin / security lead avant tag `v1.0-prod`
