# Migration Expo SDK 52 → 53 — Évaluation complète

**Statut** : À faire (branche dédiée)
**Date rédaction** : 2026-04-19
**Nom de l'opération** : `Chantier-Expo53`
**Branche cible** : `chore/expo-sdk-53-upgrade`
**Effort estimé** : 4-8h (pessimiste), 2h (optimiste)

---

## 1. Contexte et motivation

### Le problème actuel

Le projet mobile [mobile/translog-mobile/](mobile/translog-mobile/) tourne sur **Expo SDK 52 + React Native 0.76.0**. Sous Xcode 26.4.1 (installé sur la machine de dev), le template natif généré par `expo prebuild` est **incompatible avec `xcodebuild` CLI** : le simulateur iOS n'est jamais listé comme destination valide, rendant impossible `npx expo run:ios`.

### Contournements tentés (sans succès)

- Ajout explicite de `SUPPORTED_PLATFORMS = "iphoneos iphonesimulator"` dans `project.pbxproj` → échec, `xcodebuild -showdestinations` continue à ne voir que "Any iOS Device".
- `open .xcworkspace` + build UI → build non terminé / silencieux.
- EAS Build (cloud) envisagé comme plan B.

### Pourquoi SDK 53 résout le problème

Expo SDK 53 est aligné sur React Native 0.79+, qui :
- Ajoute dans le template `project.pbxproj` les sections `SUPPORTED_PLATFORMS` et "Supported Destinations" attendues par Xcode 26.
- Utilise la nouvelle structure AppDelegate Swift (déjà compatible iOS 18/26).
- Embarque un Hermes compilé pour les archi iOS 26 device + simulator Apple Silicon.

---

## 2. État actuel — audit

### Stack mobile

| Composant | Version actuelle | Rôle |
|---|---|---|
| `expo` | `~52.0.0` | SDK Expo |
| `react-native` | `0.76.0` | Runtime |
| `react` | `18.3.1` | UI lib |
| `expo-router` | `~4.0.0` | ⚠️ installé mais **inutilisé** (aucun import) |
| `@react-navigation/*` | `^6.x` | Navigation **utilisée** (stack + bottom-tabs) |
| `@op-engineering/op-sqlite` | `^9.0.0` | SQLite offline-first (1 seul fichier : [src/offline/db.ts](mobile/translog-mobile/src/offline/db.ts)) |
| `react-native-mmkv` | `^3.0.0` | Store K/V (1 seul fichier : [src/i18n/useI18n.tsx](mobile/translog-mobile/src/i18n/useI18n.tsx)) |
| `react-native-reanimated` | `~3.16.0` | Animations (transitif) |
| `react-native-screens` | `4.0.0` | Stacks natifs |
| `react-native-svg` | `15.8.0` | SVG |

### Expo modules installés

`expo-asset`, `expo-camera`, `expo-constants`, `expo-local-authentication`, `expo-localization`, `expo-location`, `expo-network`, `expo-router`, `expo-secure-store`, `expo-status-bar`.

### Surface à migrer

- **54 fichiers TS/TSX** dans [mobile/translog-mobile/src/](mobile/translog-mobile/src/)
- **2 fichiers seulement** utilisent les natifs risqués (SQLite + MMKV)
- **0 tests Jest mobile** (pas de filet de sécurité automatisé côté mobile)
- **3 scénarios Maestro E2E** dans [mobile/translog-mobile/maestro/](mobile/translog-mobile/maestro/) (login, sell-ticket, incident)

### Couplages hors mobile

| Type | Cible | Gravité |
|---|---|---|
| Import i18n | `frontend/lib/i18n/locales/{fr,en}` (chemin relatif `../../../../`) | 🟡 moyen |
| API HTTP | `apiFetch()` dans [src/api/client.ts](mobile/translog-mobile/src/api/client.ts) (Bearer + `X-Tenant-Host`) | 🟢 faible |
| Types partagés | **Aucun** (types inférés localement) | 🟢 faible |
| Auth flow | SecureStore + même endpoint `/api/auth/sign-in` | 🟢 faible |

---

## 3. Stack cible (SDK 53)

### Versions visées (dernière stable au 2026-04-19)

| Package | Actuel | Cible | Delta |
|---|---|---|---|
| `expo` | `52.0.0` | `53.0.x` | +1 major |
| `react-native` | `0.76.0` | `0.79.x` | +3 minor (≈6 mois de changes) |
| `react` | `18.3.1` | `19.0.x` | +1 major |
| `expo-router` | `4.0.0` | `5.0.x` | +1 major (ou **à supprimer**, voir §5) |
| `@op-engineering/op-sqlite` | `9.0.0` | `11.x` | +2 major — **vérifier RN 0.79** |
| `react-native-mmkv` | `3.0.0` | `3.x` dernière | mineur |
| `react-native-reanimated` | `3.16.0` | `3.19.x` | mineur |
| `react-native-screens` | `4.0.0` | `4.11.x` | mineur |
| `expo-*` (tous) | SDK 52 | SDK 53 aligné | `expo install --fix` |

### React 18 → 19 : breaking changes clés

- `useRef` : initial value désormais requise
- Types `ReactElement` stricts (peut impacter des `children` génériques)
- `forwardRef` partiellement remplacé par `ref` direct sur composants fonctionnels
- `act()` en tests : signature async only

**Impact TransLog** : 54 fichiers à scanner, surtout [src/navigation/](mobile/translog-mobile/src/navigation/) et les écrans métier.

### React Native 0.76 → 0.79 : breaking changes clés

- `PropsWithChildren` doit être explicite sur tous les composants qui reçoivent `children`
- `StyleSheet.create()` types plus stricts
- `Platform.select` typage resserré
- Nouvelle arch (Fabric + TurboModules) **active par défaut** (déjà activée dans le projet via `newArchEnabled: true`)

**Impact TransLog** : typages stricts à ajuster, composants custom à vérifier.

---

## 4. Effets de bord sur les AUTRES parties du monorepo

### 4.1 Backend NestJS (`src/`)

**Impact : AUCUN.**

- Le mobile appelle le backend uniquement via HTTP (REST).
- Aucune dépendance partagée entre `mobile/translog-mobile/package.json` et `package.json` racine.
- Le contrat API (`/api/auth/*`, `/api/manifest/*`, etc.) reste inchangé.

**Action requise** : ✅ rien. Pas de risque de régression backend.

---

### 4.2 Frontend Web (`frontend/`)

**Impact : QUASI NUL, avec un point de vigilance.**

- Build entièrement séparé (Vite + React DOM, pas React Native).
- **Couplage unique** : [mobile/translog-mobile/src/i18n/useI18n.tsx](mobile/translog-mobile/src/i18n/useI18n.tsx) importe `frontend/lib/i18n/locales/fr` et `/en` via chemin relatif.

**Risques** :
- Si React 19 impose des types différents aux dictionnaires i18n → possible incompat.
- Très peu probable en pratique (les locales sont des objets POJO).

**Actions recommandées** :
- ✅ Ajouter un alias `@translog/i18n` dans `tsconfig` racine pour casser le chemin relatif fragile.
- ✅ Vérifier que `npm run build` frontend passe après upgrade mobile.

---

### 4.3 Tests (unit, integration, security, e2e, playwright)

**Impact : POTENTIELLEMENT NUL, à vérifier.**

- Les configs `jest.*.config.ts` racine **excluent** le dossier `mobile/` ? → à confirmer.
- Playwright n'utilise pas React Native.

**Actions recommandées** :
- ✅ `npm run test:unit` + `test:integration` + `test:security` + `test:e2e` APRÈS upgrade, confirmer 984 PASS maintenus.
- ✅ Vérifier qu'aucun test n'importe accidentellement du code de `mobile/`.

---

### 4.4 CI / CD

**Impact : À configurer.**

- Pas de workflow GitHub Actions mobile actuellement.
- EAS Build config présente ([mobile/translog-mobile/eas.json](mobile/translog-mobile/eas.json)) : 3 profils (dev/preview/prod).

**Actions recommandées** :
- ✅ Après upgrade, relancer `eas build --profile development --platform ios` pour valider que le cloud build passe.
- ⚠️ Si GitHub Actions est ajouté plus tard, verrouiller Xcode version dans le runner.

---

### 4.5 Schéma Prisma / base de données

**Impact : AUCUN.**

Le mobile ne touche pas à la DB directement ; tout passe par l'API.

---

## 5. Risques et points d'attention

### 🔴 Risque élevé

- **`@op-engineering/op-sqlite` v9 → v11** : saut de 2 majors. Vérifier le changelog ; API `open()` a bougé en v10. → Plan de contingence : fallback vers `expo-sqlite` (natif Expo, zéro config) si op-sqlite casse.
- **`expo-router` v4 installé mais inutilisé** : à **supprimer avant** l'upgrade pour éviter un conflit avec la v5 qui traîne une API différente (`Stack.Screen` layout).

### 🟡 Risque moyen

- **Zéro test unitaire mobile** : pas de filet de sécurité automatisé. Risque de régression silencieuse → compensé par 3 scénarios Maestro E2E à exécuter manuellement.
- **Nouvelle arch déjà activée** (`newArchEnabled: true`) : bon pour SDK 53 (alignement) mais peut exposer des bugs de modules tiers pas encore compatibles TurboModules.
- **React 19 + `forwardRef`** : si [src/ui/](mobile/translog-mobile/src/ui/) utilise du `forwardRef`, il faudra migrer.

### 🟢 Risque faible

- Versions des modules `expo-*` : `expo install --fix` résout automatiquement.
- CORS backend : pas impacté (déjà configuré pour `localhost:8081`, `:19006`).

---

## 6. Plan de migration pas-à-pas

**Pré-requis** : branche `chore/expo-sdk-53-upgrade`, tests actuels 984 PASS confirmés sur main.

### Phase 0 — Préparation (30 min)

1. [ ] Créer la branche `chore/expo-sdk-53-upgrade` depuis `main`
2. [ ] Snapshot `package.json` + `package-lock.json` mobile dans un commit de référence
3. [ ] Nettoyer `expo-router` de [mobile/translog-mobile/package.json](mobile/translog-mobile/package.json) (inutilisé)
4. [ ] Vérifier que `npm run test:unit` passe sur main (baseline 984)

### Phase 1 — Upgrade core (1h)

5. [ ] `cd mobile/translog-mobile`
6. [ ] `npx expo install expo@53 --fix` (upgrade Expo + modules `expo-*`)
7. [ ] `npx expo install react@19 react-native@0.79` (aligner React + RN)
8. [ ] Vérifier `package.json` : versions cohérentes
9. [ ] `rm -rf node_modules ios android && npm install`

### Phase 2 — Natifs custom (1-2h)

10. [ ] `npm install @op-engineering/op-sqlite@latest` + lire changelog v9→v11
11. [ ] Adapter [src/offline/db.ts](mobile/translog-mobile/src/offline/db.ts) si l'API `open()` a changé
12. [ ] `npm install react-native-mmkv@latest` + vérifier [src/i18n/useI18n.tsx](mobile/translog-mobile/src/i18n/useI18n.tsx)
13. [ ] Upgrade `react-native-reanimated`, `react-native-screens`, `react-native-svg`, `react-native-gesture-handler`, `react-native-safe-area-context` (versions alignées SDK 53)

### Phase 3 — Typecheck + correction (1h)

14. [ ] `npx tsc --noEmit` → corriger erreurs React 19 / RN 0.79
15. [ ] Ajouter `children: ReactNode` explicite partout où manquant
16. [ ] Passer `forwardRef` → ref direct si React 19 le requiert

### Phase 4 — Build iOS natif (30 min)

17. [ ] `npx expo prebuild --clean --platform ios`
18. [ ] `npx expo run:ios --device "iPhone 17 Pro"` → le build DOIT fonctionner
19. [ ] Test manuel : login, un scan QR, un manifest, un sign-out

### Phase 5 — Build Android natif (30 min)

20. [ ] Émulateur Android Studio disponible
21. [ ] `npx expo prebuild --clean --platform android`
22. [ ] `npx expo run:android`
23. [ ] Test manuel identique iOS

### Phase 6 — Validation croisée (30 min)

24. [ ] Racine projet : `npm run test:unit` (984 doivent passer)
25. [ ] Racine projet : `npm run test:integration`
26. [ ] Racine projet : `npm run test:security`
27. [ ] Racine projet : `npm run test:e2e`
28. [ ] Racine projet : `npm run test:playwright`
29. [ ] Frontend web : `cd frontend && npm run build && npm run preview`
30. [ ] Scénarios Maestro : `maestro test maestro/login.yaml` (+ 2 autres)

### Phase 7 — Documentation + merge (30 min)

31. [ ] Mettre à jour [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) : stack mobile
32. [ ] Mettre à jour [TEST_STATUS.md](TEST_STATUS.md) : SDK 53 confirmé
33. [ ] Commit `chore(mobile): upgrade to Expo SDK 53 + RN 0.79 + React 19`
34. [ ] PR + review + merge

---

## 7. Plan de rollback

Si la Phase 3 ou Phase 4 bloque > 2h :

1. `git checkout main` (la branche reste)
2. On continue en Voie 1 (web) + Voie 3 (EAS Build cloud) en attendant d'isoler le bug
3. On reprend avec moins de pression, éventuellement en sautant SDK 52→53 et en allant direct SDK 54 si disponible

---

## 8. Critères de succès (définition of done)

- [ ] `npx expo run:ios` fonctionne sans edit manuel de pbxproj
- [ ] `npx expo run:android` fonctionne
- [ ] App lance sur iPhone 17 Pro simulator, login → home
- [ ] 984 tests racine PASS
- [ ] Frontend web build OK
- [ ] 3 scénarios Maestro PASS
- [ ] Doc tech + PRD + test status mis à jour
- [ ] Aucun `TODO` introduit dans le code

---

## 9. Décisions de design associées

- **Plus d'Expo Go** : après l'upgrade, les modules natifs rendent Expo Go inutilisable. Dev flow définitif = dev build (`expo run:ios` ou `eas build --profile development`).
- **Tests unitaires mobile à prévoir en post-upgrade** : ajouter `jest.mobile.config.ts` + 5-10 tests smoke sur hooks critiques (auth, offline, i18n). Hors scope de ce chantier mais à planifier.
- **Suppression `expo-router`** : confirmer avec le propriétaire qu'aucune migration routing n'est prévue. Si oui, consolider sur `@react-navigation/*` uniquement.

---

## 10. Ressources

- [Expo SDK 53 changelog](https://expo.dev/changelog/sdk-53) (à consulter avant de démarrer)
- [React 19 upgrade guide](https://react.dev/blog/2024/04/25/react-19-upgrade-guide)
- [React Native 0.79 release notes](https://github.com/facebook/react-native/releases)
- [@op-engineering/op-sqlite v11 migration](https://github.com/OP-Engineering/op-sqlite/releases)
- [docs/WORKFLOWS.md](WORKFLOWS.md) — impact fonctionnel nul mais à relire pour valider les scénarios de test manuel
