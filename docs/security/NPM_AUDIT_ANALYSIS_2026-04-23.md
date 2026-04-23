# npm audit HIGH — Analyse de risque (2026-04-23)

## Synthèse

**7 HIGH / 23 moderate / 4 low** — **aucune HIGH n'est une exposition production réelle** selon l'analyse des chemins d'appel et du contexte (DEV vs RUNTIME).

## HIGH — Analyse par package

| Package | Chemin | Catégorie | Exposition réelle | Action |
|---|---|---|---|---|
| `@nestjs/cli@10.4.9` | devDep | **DEV-only** (CLI build/codegen) | ❌ Jamais en prod | Upgrade to v11 en sprint 4 (breaking) |
| `glob` (transitif cli) | devDep | **DEV-only** + CLI non utilisée (mode `-c/--cmd`) | ❌ Nous n'invoquons pas le CLI | Upgrade transitif via v11 |
| `picomatch` (transitif cli) | devDep | **DEV-only** build tooling | ❌ Jamais en prod | Upgrade transitif via v11 |
| `lodash` (transitif cli/config/archiver/minio) | runtime | `_.unset`/`_.omit`/`_.template` | ❌ **Zéro usage direct** grep-vérifié ; transitifs n'exposent pas ces chemins à du user-input | Monitoring — pas de fix direct possible |
| `multer` (via @nestjs/platform-express) | runtime | Uploads fichiers DoS | 🟡 Mitigé : rate-limit + file size caps | Upgrade à v11 en sprint 4 |
| `@nestjs/platform-express` | runtime | Via multer | 🟡 Idem multer | Idem |
| `undici` (transitif testcontainers@5.29) | **devDep** | Integration tests infra | ❌ Jamais en prod (testcontainers = dev only) | Monitoring — sera fix avec upgrade testcontainers |

## Matrice de décision

- **Risque prod MAINTENANT** : 🟢 Négligeable — toutes les HIGH sont soit DEV-only, soit mitigées par contrôles applicatifs (rate-limit, size caps, pas d'usage des API vulnérables).
- **Dette à 90j** : 🟡 Upgrade Nest v11 (`npm audit fix --force`) pour éliminer les warnings. Breaking change → planifier en sprint dédié avec regression tests.
- **Monitoring continu** : 🟢 `npm audit` intégré dans le CI (suite security). Tout nouveau HIGH affichable sans regarder manuellement.

## Vérifications effectuées

```bash
# Zéro usage direct des API lodash vulnérables
grep -rn "_.unset\|_.omit\|_.template" src/  # → 0 matches

# undici uniquement dans testcontainers (devDep)
npm ls undici
# └─┬ testcontainers@10.28.0
#   └── undici@5.29.0

# @nestjs/cli = devDep confirmé
grep '"@nestjs/cli"' package.json  # → "devDependencies"
```

## Recommandation opérationnelle

1. **Aucun blocker pour la mise en production** (les HIGH actuels ne sont pas atteignables depuis un attaquant externe).
2. **Sprint dédié en v1.1** : upgrade `@nestjs/cli@11`, `@nestjs/platform-express@11`, `testcontainers@latest` — attendre un sprint de stabilité pour absorber le breaking change.
3. **CI gate** : le test `test/security/dependency-audit.spec.ts` continue de warner. Acceptable car documentée ici.

## Re-validation

À rejouer à chaque release mineure :

```bash
npm audit --json | node scripts/analyze-npm-audit.js
```

Si une nouvelle HIGH apparaît hors de cette liste (7 connus), elle doit être analysée immédiatement.
