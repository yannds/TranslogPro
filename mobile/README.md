# TransLog Pro — Mobile (Expo)

Application mobile multi-rôles pour TransLog Pro, compatible iOS et Android via Expo. Unique bundle qui ouvre, selon le profil de l'utilisateur authentifié :

| Rôle | Portail | Écrans clés |
|------|---------|-------------|
| Caissier             | `cashier`   | Ouverture caisse · transactions · signalement incident |
| Chauffeur            | `driver`    | Trajets, check-in, SOS *(stub)* |
| Agent de gare        | `station`   | Vente rapide, pointage *(stub)* |
| Agent de quai        | `quai`      | Scan QR, manifests *(stub)* |
| Admin tenant         | `admin`     | KPIs, remboursements *(stub)* |
| Client (voyageur)    | `customer`  | Signalement incident |

La résolution du rôle se fait côté client dans `src/navigation/portalForUser.ts` à partir des permissions renvoyées par `GET /api/auth/me`. Les écrans « stub » sont des placeholders explicites — ils donnent la liste des features à venir et restent fonctionnels (logout possible) pour ne pas bloquer l'utilisateur.

## Offline-first

- **SQLite** local (`src/offline/db.ts`) — table `outbox` pour les mutations différées, table `cache` pour les lectures.
- `src/offline/outbox.ts` — `enqueueMutation` (idempotency-key incluse) + `flushOutbox` (backoff exponentiel, 10 retries max) + `startSyncLoop` (démarré dans `App.tsx`).
- `src/offline/useOnline.ts` — hook `expo-network` pour afficher l'état réseau courant.

Les mutations critiques (ouverture/clôture caisse, vente billet, signalement incident) passent systématiquement par l'outbox si `!online`. Le serveur applique l'idempotency-key pour éviter les doublons lors du rejeu.

## i18n

Les dictionnaires sont partagés avec le front web : `src/i18n/useI18n.ts` importe directement les fichiers `frontend/lib/i18n/locales/*.ts`. Si vous distribuez l'app mobile hors du monorepo, dupliquer les locales dans `assets/i18n/` et adapter l'import.

Locales prises en charge au démarrage : `fr`, `en`. Ajout des 6 autres (wo, ln, ktu, es, pt, ar) : importer les modules correspondants et les déclarer dans l'objet `LOCALES`.

## Light / Dark

`src/theme/ThemeProvider.tsx` bascule automatiquement sur `useColorScheme()`. Les palettes (`src/theme/colors.ts`) respectent WCAG AA (contrastes vérifiés) et les recommandations Apple HIG / Material. Les cibles tactiles font ≥ 44pt iOS / 48dp Android (boutons, chips).

## API & Auth

- Base URL via `expo.extra.apiBaseUrl` (`app.json`) ou `EXPO_PUBLIC_API_BASE_URL`.
- Bearer token stocké dans le **keychain iOS / keystore Android** via `expo-secure-store` (`src/auth/token.ts`).
- `AuthProvider` (`src/auth/AuthContext.tsx`) gère login / logout / refresh. 401 → token nettoyé + retour login.

## Structure

```
translog-mobile/
├─ App.tsx                     point d'entrée (providers + sync loop)
├─ index.ts                    registerRootComponent
├─ app.json                    config Expo (permissions iOS/Android, scheme, icons)
├─ package.json                Expo SDK 52 (new architecture)
├─ tsconfig.json
└─ src/
   ├─ api/
   │  ├─ client.ts             apiFetch / ApiError / OfflineError
   │  └─ config.ts             resolution baseUrl
   ├─ auth/
   │  ├─ AuthContext.tsx       Provider
   │  └─ token.ts              expo-secure-store
   ├─ cashier/
   │  └─ CashierHomeScreen.tsx écran caissier principal
   ├─ incidents/
   │  └─ IncidentReportScreen.tsx
   ├─ i18n/useI18n.ts          dict partagé avec le frontend web
   ├─ navigation/
   │  ├─ Navigator.tsx         Stack + Tabs par rôle
   │  └─ portalForUser.ts      dérivation rôle → portail
   ├─ offline/
   │  ├─ db.ts                 SQLite (@op-engineering/op-sqlite)
   │  ├─ outbox.ts             enqueue + flush + sync loop
   │  └─ useOnline.ts          hook expo-network
   ├─ screens/
   │  ├─ LoginScreen.tsx
   │  └─ RolePlaceholderScreen.tsx
   └─ theme/
      ├─ colors.ts             palettes light/dark WCAG AA
      └─ ThemeProvider.tsx
```

## Build & distribution

### Installation locale
```
cd mobile/translog-mobile
npm install
npx expo install expo-router expo-localization expo-secure-store expo-status-bar expo-network react-native-mmkv
npm start
```

### Apple App Store
1. `eas build --platform ios --profile production`.
2. Vérifier **Info.plist** :
   - `NSLocationWhenInUseUsageDescription` — position pour signalement (opt-in)
   - `NSCameraUsageDescription` — scan QR billets
   - `ITSAppUsesNonExemptEncryption=false` (app ne fait pas de crypto custom)
3. Soumettre via Xcode ou `eas submit --platform ios`.

### Google Play Store
1. `eas build --platform android --profile production`.
2. Vérifier **AndroidManifest** (permissions déclarées dans `app.json.android.permissions`).
3. Soumettre AAB via Play Console.

### Conformité store

- **iOS App Review** : données sensibles chiffrées (Keychain), politique de confidentialité obligatoire, consentement explicite pour GPS & caméra.
- **Google Play** : Data safety form, nouvelle politique 2025 (offline-friendly), permissions runtime.
- **Privacy Manifest (iOS 17+)** : ajouter `PrivacyInfo.xcprivacy` quand requis par Apple — au minimum déclarer `NSPrivacyAccessedAPIType` pour `UserDefaults`, `FileTimestamp`, `SystemBootTime`.

## Impression Bluetooth (Sprint 11)

L'abstraction d'impression vit dans `src/printer/` :
- `printer.types.ts` — contrat `PrinterDriver` + `ReceiptPayload`.
- `mock.driver.ts`   — driver console, utilisable en Expo Go.
- `templates.ts`     — templates FR/EN (ticket + colis).
- `printer.queue.ts` — file SQLite + backoff exponentiel + rejeu.

**En Expo Go** : les reçus s'affichent dans les logs. Idéal pour prototyper sans matériel.

**Pour le binaire EAS natif** (prod) : installer `@brooons/react-native-bluetooth-escpos-printer` (ou équivalent Expo-compatible via config plugin), créer un driver qui implémente l'interface `PrinterDriver`, et l'injecter au démarrage via `setPrinterDriver(real)` dans `App.tsx`. Le reste du code consomme via `queuePrint()` — zéro changement applicatif.

## Roadmap par rôle

- **Caissier (v0.1 en place)** : ouverture/clôture caisse, vente billet simple (à compléter), flux TX réel avec imprimante Bluetooth.
- **Chauffeur** : manifest offline 24 h, SOS one-tap, log trajet, scan QR passagers.
- **Agent de gare** : DataTable compacte ventes, vérif QR, export CSV fin de journée.
- **Agent de quai** : scan massif QR passagers, signature manifest, incidents bagages.
- **Admin tenant** : dashboard KPIs avec cache offline, validation rapide remboursements, clôture audit caisse.

Chaque rôle réutilise les primitives de `src/api/`, `src/offline/`, `src/i18n/`, `src/theme/` — aucune duplication.
