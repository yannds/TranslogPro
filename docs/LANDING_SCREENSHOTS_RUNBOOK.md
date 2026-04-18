# Landing screenshots — runbook

Ce runbook explique comment **capturer / mettre à jour les captures d'écran réelles** qui illustrent la landing publique (remplacement progressif des SVG mockups de [PublicLanding.tsx](../frontend/components/public/PublicLanding.tsx)).

---

## Ce qui est automatisé

Spec Playwright : [test/playwright/landing-screenshots.tenant.pw.spec.ts](../test/playwright/landing-screenshots.tenant.pw.spec.ts)

Captures générées (8 fichiers) :
- `hero-dashboard-light.png` / `hero-dashboard-dark.png`
- `deepdive-sell-light.png` / `deepdive-sell-dark.png`
- `deepdive-crm-light.png` / `deepdive-crm-dark.png`
- `deepdive-analytics-light.png` / `deepdive-analytics-dark.png`

Destination : `frontend/public/landing/`.

---

## Pré-requis

1. Stack dev démarrée :
   ```bash
   ./scripts/dev.sh up
   ```
   → Vite `:5173`, Nest `:3000`, Postgres `:5434` seedés. Le tenant E2E `trans-express` est provisionné avec des données démo (1-2 ventes, 1-2 clients, 1-2 trajets, 1-2 rapports) nécessaires pour des captures non vides.

2. Playwright browsers installés :
   ```bash
   npx playwright install chromium
   ```

---

## Capture

```bash
CAPTURE_SCREENSHOTS=1 PLAYWRIGHT_BROWSER=1 npm run test:pw -- landing-screenshots
```

Variables expliquées :
- `CAPTURE_SCREENSHOTS=1` — active le `test.describe.skip` par défaut. **Sans cette var, la suite est ignorée** (pas de pollution CI).
- `PLAYWRIGHT_BROWSER=1` — active le projet `tenant-admin` browser (requis — l'API-only mode ne capture pas d'UI).

Durée : ~30-45 s (4 tests × 2 thèmes = 8 navigations + captures).

---

## Conversion PNG → WebP (optionnel mais recommandé)

Les PNG pèsent 400-800 kB chacun. WebP réduit à 80-150 kB avec une qualité visuelle équivalente à 90 %. Convertir avec `cwebp` (installé via `brew install webp`) :

```bash
cd frontend/public/landing/
for f in *.png; do
  cwebp -q 88 "$f" -o "${f%.png}.webp"
done
```

Puis supprimer les PNG (`rm *.png`) une fois les WebP validés.

---

## Brancher les captures dans la landing

Actuellement, [PublicLanding.tsx](../frontend/components/public/PublicLanding.tsx) utilise des mockups SVG inline (`DashboardMockup`, `SellTicketMockup`, `CrmMockup`, `AnalyticsMockup`, `PhoneMockup`). Pour passer à des captures réelles :

1. Créer un composant `LandingImage` réutilisable (DRY) qui gère light+dark via `<picture>` :
   ```tsx
   <picture>
     <source srcSet="/landing/hero-dashboard-dark.webp"  media="(prefers-color-scheme: dark)" />
     <img    src="/landing/hero-dashboard-light.webp"   alt={t('...')} loading="eager" />
   </picture>
   ```
   → Attention : dans notre app, le thème est piloté par **la classe `.dark` sur `<html>`** (pas `prefers-color-scheme`). Il faut donc adapter :
   ```tsx
   const { theme } = useTheme();
   const src = `/landing/hero-dashboard-${theme}.webp`;
   return <img src={src} alt={t('...')} loading="eager" />;
   ```
   Garder `loading="eager"` pour le hero (au-dessus du fold), `loading="lazy"` pour le reste.

2. Remplacer un mockup SVG à la fois par ce composant. Commencer par `hero-dashboard` (le plus visible).

3. Conserver les mockups SVG comme **fallback** pour les locales non-EN (ou supprimer quand les captures localisées arrivent — voir section suivante).

---

## Variantes localisées (futur)

Pour l'instant, les captures sont en **français** (le dev seed provisionne `language=fr` pour `trans-express`). Si on veut des captures EN ou AR pour servir aux visiteurs non-francophones, soit :
- **Option A** : ajouter une boucle sur les langues dans la spec Playwright, en forçant `localStorage.setItem('translog-lang', 'en')` avant chaque capture. Coût : 4 × 2 × N langues captures.
- **Option B** : accepter que les captures soient en FR pour tous (proche de "Linear" ou "Stripe" qui montrent leur UI EN même aux visiteurs FR). Coût : 0, cohérent avec un SaaS qui ambitionne d'être global.

→ **Recommandation actuelle** : Option B jusqu'à la v1 publique.

---

## Quand re-capturer

À refaire si un des événements suivants survient :
- Changement de design majeur sur `/admin/sell-ticket`, `/admin/crm/customers/:id`, `/admin/analytics`
- Ajout d'un nouveau KPI/widget sur le dashboard `/admin`
- Refonte du thème (palette, typographie)

Pas besoin de re-capturer pour :
- Changement de texte mineur (les captures ne sont pas des docs)
- Nouvelles features qui ne sont pas visibles dans les 4 routes capturées

---

## Dépannage

**Captures vides ou "no data"** :  
Le tenant `trans-express` n'a pas de données. Relancer `./scripts/dev.sh reset` qui recrée le seed E2E complet, ou créer manuellement 1-2 tickets + 1-2 clients via l'UI.

**`ECONNREFUSED` sur `http://trans-express.translog.test:5173`** :  
- Vite pas démarré → `./scripts/dev.sh up`
- /etc/hosts pas configuré pour `*.translog.test` → Playwright lance Chromium avec `--host-resolver-rules` (voir [playwright.config.ts:111](../playwright.config.ts#L111)) qui mappe `*.translog.test → 127.0.0.1` sans toucher `/etc/hosts`. Si le test échoue quand même, vérifier que le global-setup Playwright a bien fait login et écrit `test/playwright/.auth/tenant-admin.json`.

**Capture trop sombre en dark mode** :  
Vérifier que la route cible applique correctement le thème. Le script utilise `localStorage.setItem('translog-theme', 'dark')` en `addInitScript` — la page doit lire cette clé au mount (voir [ThemeProvider.tsx](../frontend/components/theme/ThemeProvider.tsx)).
