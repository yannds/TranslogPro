# Tester l'app TransLog Pro sur ton téléphone — guide rapide

> **3 minutes, sans Android Studio, sans Xcode, sans APK.**

## 2 axes indépendants à comprendre

L'app mobile a **2 sources** distinctes :

| Axe | Choix | Ce qu'il faut |
|---|---|---|
| **Le code JS** (interface) vient de… | Mac (Metro local) **OU** cloud (EAS Update) | Mac : 1 commande ; cloud : 1 publish |
| **L'API** (données) vient de… | Backend local **OU** prod en ligne | Local : `npm run start:dev` ; prod : rien à lancer |

→ Tu peux mixer librement. Le scénario le plus rapide pour toi maintenant : **JS depuis Mac + API prod en ligne** (rien à lancer côté backend).

---

## ⚡ Option 1 — La plus simple : tester contre la prod en ligne

**Backend** : rien à lancer, on tape direct sur l'infra prod (`https://<tenant>.translog.dsyann.info`).
**Côté Mac** : juste Metro (sert le JS).

### 1. Installer Expo Go (1 fois)
- iPhone : App Store → `Expo Go` → installer
- Android : Play Store → `Expo Go` → installer

### 2. Lancer Metro avec API prod
```bash
cd ~/TranslogPro
./mobile/scripts/dev-phone.sh --prod
```

Le script :
- pointe l'app sur `https://trans-express.translog.dsyann.info` par défaut
- ping `/health/live` pour valider que la prod répond
- lance Expo + affiche un QR

### 3. Sur le téléphone
- **iPhone** : ouvre **Caméra** (pas Expo Go), vise le QR du terminal, tape la notif "Ouvrir dans Expo Go"
- **Android** : ouvre **Expo Go**, bouton "Scan QR code", vise le QR

L'app charge en 5-10 sec et tu te connectes avec un compte prod.

### Variantes
```bash
./mobile/scripts/dev-phone.sh --prod --tenant demo            # autre tenant slug
./mobile/scripts/dev-phone.sh --prod --tunnel                 # si pas sur le même WiFi
API_BASE_URL=https://staging.translog.dsyann.info ./mobile/scripts/dev-phone.sh   # URL custom
```

---

## 🛠 Option 2 — Tester contre ton backend local

Utile si tu touches au code backend et que tu veux voir les changements en direct.

### Terminal 1 — Backend
```bash
cd ~/TranslogPro
npm run start:dev
```
Attendre `Nest application successfully started` (port 3000).

### Terminal 2 — App mobile
```bash
cd ~/TranslogPro
./mobile/scripts/dev-phone.sh
```
Le script détecte ton IP LAN et pointe l'app dessus. Mac et tel doivent être sur le **même WiFi**.

### Identifiants seed dev local
- admin : `admin@trans-express.cg` / `Admin1234!`
- caissier : `caissier@trans-express.cg` / `Admin1234!`
- chauffeur : `driver@trans-express.cg` / `Admin1234!`
- agent quai : `quai@trans-express.cg` / `Admin1234!`
- agent gare : `station@trans-express.cg` / `Admin1234!`
- client : `client@trans-express.cg` / `Admin1234!`

---

## 🌍 Option 3 — Tout en cloud (zéro Mac), via EAS Update

Quand tu publies une mise à jour JS sur EAS, n'importe qui ouvrant l'app récupère le bundle directement depuis le cloud Expo. Plus aucun terminal local nécessaire.

### Setup (1 fois)
```bash
cd mobile/translog-mobile
npx eas-cli login                        # crée un compte gratuit Expo si besoin
npx eas-cli init                         # lie le projet à un projectId EAS
```

### Publier une update
```bash
EXPO_PUBLIC_API_BASE_URL=https://trans-express.translog.dsyann.info \
npx eas-cli update --branch production --message "test phone"
```

Cette commande retourne une URL `exp://u.expo.dev/...`. Tu peux :
- L'ouvrir dans Expo Go directement
- Ou la coller dans n'importe quel scanner QR
- Ou la partager à un testeur (il scanne, il a l'app)

⚠ **Note** : Expo Go récupère uniquement le bundle JS. Pour les libs natives custom (impression Bluetooth, biométrie complète) il faut un dev build EAS — voir `mobile/DEVICE_SETUP.md` §3bis.

---

## Pourquoi pas un APK simple à installer ?

Tu pourrais aussi faire :
```bash
cd mobile/translog-mobile
npx eas-cli build --profile preview --platform android
```
→ ~10 min de build cloud → APK téléchargeable sur ton tel → install side-load → app autonome qui tape la prod.
Voir `mobile/DEVICE_SETUP.md` §3ter. Mais Expo Go est plus rapide pour tester.

---

## Troubleshooting

| Symptôme | Cause | Fix |
|---|---|---|
| QR scanné, "Network error" | Tel et Mac pas sur le même WiFi | `--tunnel` ou même WiFi |
| `ECONNREFUSED` au login | Backend local pas lancé | `npm run start:dev` ou `--prod` |
| Boucle blanche infinie au démarrage | Bundle JS pas téléchargé (firewall, 4G) | `--tunnel` |
| Avertissement console "[offline/db] Expo Go detected" | Normal, Expo Go n'a pas la lib SQLite native | Marche, juste pas de cache offline persistant |
| `Unable to resolve module` | node_modules incomplets | `cd mobile/translog-mobile && npm install` |

---

## Ce qui marche / ne marche pas en Expo Go

L'app fonctionne à **~95 %** dans Expo Go. Limitations :
- ❌ Pas de persistance offline durable (file de sync en mémoire, perdue au reload)
- ❌ Impression thermal Bluetooth (lib ESC/POS native)
- ❌ Biométrie FaceID/TouchID partiellement supportée

**Tout le reste marche** : login, navigation, vente billet, scan QR, signalement, profil, dashboards admin (Trips/Incidents/SAV), lookup client, annulation, refund, etc.

Pour tester ce qui ne marche pas en Expo Go → dev build EAS (`mobile/DEVICE_SETUP.md` §3bis).
