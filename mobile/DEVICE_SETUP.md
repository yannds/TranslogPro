# Outillage test device — installer iOS + Android + Expo Go + Maestro

Guide d'installation + script d'amorçage pour tester l'app mobile TransLog Pro localement **et** en CI.

Prérequis : macOS (iOS). Linux/Windows : Android uniquement.

---

## 1. Xcode + iOS Simulator (macOS)

```bash
# 1. Installer Xcode depuis l'App Store (plusieurs Go, prévoir 1 h).
# 2. Command Line Tools :
xcode-select --install

# 3. Accepter la licence (une fois suffit) :
sudo xcodebuild -license accept

# 4. Activer le Simulator par défaut + CLI :
xcrun simctl list devices
# Installer un runtime si manquant :
#   Xcode → Settings → Components → iOS 17.4 Simulator → Get
```

Vérification :
```bash
xcrun simctl list runtimes
open -a Simulator
```

---

## 2. Android Studio + Emulator

### Installation
1. Télécharger https://developer.android.com/studio
2. Lors de la première ouverture, laisser le setup wizard installer :
   - Android SDK Platform 34 (Android 14)
   - Android SDK Build-Tools
   - Android Emulator + Platform-Tools

### Variables d'env (à ajouter dans `~/.zshrc` ou `~/.bashrc`)
```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"        # macOS
# export ANDROID_HOME="$HOME/Android/Sdk"              # Linux
export PATH="$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin"
```

### Créer un AVD (Android Virtual Device) headless
```bash
# Lister les images disponibles
sdkmanager --list | grep "system-images;android-34"

# Installer l'image Google APIs x86_64 (recommandé pour émulateur)
sdkmanager "system-images;android-34;google_apis;x86_64"

# Créer l'AVD
avdmanager create avd \
  --name translog-pixel6 \
  --package "system-images;android-34;google_apis;x86_64" \
  --device "pixel_6" \
  --force

# Lancer (sans UI, utile en CI)
emulator -avd translog-pixel6 -no-audio -no-window -gpu swiftshader_indirect &
```

### Vérif
```bash
adb devices
# doit lister 'emulator-5554 device'
```

---

## 3. Expo Go sur ton téléphone physique

- **iOS** : App Store → "Expo Go" (gratuit)
- **Android** : Play Store → "Expo Go" (gratuit)

Scanner le QR code affiché par `npx expo start` (même réseau WiFi que le Mac).

Si ton device refuse localhost :
- Option A : `expo start --tunnel` (via ngrok, plus lent mais contourne le LAN)
- Option B : dans `app.json`, remplace `extra.apiBaseUrl` par l'IP LAN de ton Mac (ex. `http://192.168.1.23:3000`)

---

## 4. Maestro (E2E mobile)

```bash
# Installation
curl -Ls "https://get.maestro.mobile.dev" | bash
echo 'export PATH="$HOME/.maestro/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

# Vérifier
maestro --version
```

Usage :
```bash
cd mobile/translog-mobile/maestro
cp env.ci.example env.ci   # remplir creds
maestro test --env-file env.ci .
```

Dashboards en temps réel :
```bash
maestro studio           # cliquable, génère des YAMLs
maestro cloud            # upload → exécution sur ferme de devices (payant)
```

---

## 5. Script all-in-one pour dev

Place ce bloc dans `mobile/scripts/dev-up.sh` :

```bash
#!/usr/bin/env bash
set -euo pipefail

# Démarre backend + émulateur Android + Metro bundler, en parallèle.

# 1. Backend
(cd "$(dirname "$0")/../.." && npm run start:dev) &
BACK_PID=$!

# 2. Android emulator (si pas déjà lancé)
if ! adb devices | grep -q "emulator-"; then
  emulator -avd translog-pixel6 -no-audio -gpu swiftshader_indirect &
  ANDROID_PID=$!
  echo "Waiting for emulator..."
  adb wait-for-device
fi

# 3. Expo (foreground — Ctrl+C arrête tout)
cd "$(dirname "$0")/.."
npx expo start --android

# Cleanup
kill $BACK_PID 2>/dev/null || true
[ -n "${ANDROID_PID:-}" ] && kill $ANDROID_PID 2>/dev/null || true
```

```bash
chmod +x mobile/scripts/dev-up.sh
./mobile/scripts/dev-up.sh
```

---

## 6. Check-list "je peux tester"

- [ ] `xcrun simctl list devices` retourne au moins un simulateur iOS
- [ ] `adb devices` retourne au moins un emulator Android
- [ ] `expo --version` ≥ 52
- [ ] `maestro --version` présent
- [ ] `cd mobile/translog-mobile && npm install` réussi
- [ ] `npx expo start` démarre et affiche le QR
- [ ] Depuis un device physique avec Expo Go : scan QR → app charge sans erreur (au moins login)
- [ ] Backend dev accessible depuis device (LAN ou --tunnel)
- [ ] Test manuel : login → caisse s'ouvre → vente de billet réussie (seed E2E requis)

---

## 7. CI GitHub Actions (extrait)

```yaml
# .github/workflows/mobile-typecheck.yml
name: Mobile typecheck
on: [pull_request]
jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: cd mobile/translog-mobile && npm ci && npx tsc --noEmit

  maestro:
    runs-on: macos-14
    needs: typecheck
    steps:
      - uses: actions/checkout@v4
      - uses: reactivecircus/android-emulator-runner@v2
        with:
          api-level: 34
          target: google_apis
          arch: x86_64
          script: |
            npm ci
            cd mobile/translog-mobile && npm ci
            curl -Ls get.maestro.mobile.dev | bash
            export PATH="$HOME/.maestro/bin:$PATH"
            # (build preview APK + install + run maestro flows)
            # Voir maestro/README.md pour le détail.
```

---

## 8. Dépannage courant

| Erreur | Cause probable | Fix |
|---|---|---|
| `EMFILE: too many open files` | macOS limite ulimit faible | `ulimit -n 4096` ou `launchctl limit maxfiles 65536` |
| `Network request failed` sur device | localhost non accessible du phone | utiliser `--tunnel` ou IP LAN dans app.json |
| `adb devices` vide après reboot | émulateur arrêté | relancer `emulator -avd translog-pixel6` |
| Expo Go refuse un build native-required | Lib custom (ex. ESC/POS BT) requise | `eas build --profile preview --platform android`, installer l'APK généré |
| Xcode runtime manquant | iOS SDK non téléchargé | Xcode → Settings → Platforms → iOS 17.4 → Get |
