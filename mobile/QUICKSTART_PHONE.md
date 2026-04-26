# Tester l'app TransLog Pro sur ton téléphone — guide rapide

> **3 minutes, sans Android Studio, sans Xcode, sans APK.**

## Ce dont tu as besoin

| Sur ton téléphone | Sur ton Mac |
|---|---|
| L'app **Expo Go** (gratuit) | Node.js + ce repo cloné |
| Caméra (pour scanner le QR) | Backend NestJS qui tourne |

### Installer Expo Go

- **iPhone** : App Store → cherche `Expo Go` → installe
- **Android** : Play Store → cherche `Expo Go` → installe

C'est tout. Tu n'as rien d'autre à installer côté téléphone.

---

## Lancement en 3 commandes

Dans 2 terminaux séparés sur le Mac :

### Terminal 1 — Backend
```bash
cd ~/TranslogPro
npm run start:dev
```
Attends que tu voies `Nest application successfully started` (port 3000).

### Terminal 2 — App mobile
```bash
cd ~/TranslogPro
./mobile/scripts/dev-phone.sh
```

Le script :
1. détecte automatiquement l'IP de ton Mac sur le WiFi
2. configure l'app pour pointer dessus (sinon elle chercherait `localhost`)
3. lance Expo et affiche un **gros QR code dans le terminal**

### Sur le téléphone
1. **iPhone** : ouvre l'app **Caméra** (pas Expo Go) → vise le QR → tape la notif "Ouvrir dans Expo Go"
2. **Android** : ouvre **Expo Go** → bouton "Scan QR code" → vise le QR du terminal

L'app se télécharge en quelques secondes et démarre. **Tu peux tester.**

---

## Identifiants de test

Utilise les seeds dev du projet (cf. `prisma/seeds/iam.seed.ts`). Exemples :

| Profil | Email | Mot de passe |
|---|---|---|
| admin tenant | `admin@trans-express.cg` | `Admin1234!` |
| caissier | `caissier@trans-express.cg` | `Admin1234!` |
| chauffeur | `driver@trans-express.cg` | `Admin1234!` |
| agent quai | `quai@trans-express.cg` | `Admin1234!` |
| agent gare | `station@trans-express.cg` | `Admin1234!` |
| client | `client@trans-express.cg` | `Admin1234!` |

L'app détecte le profil et ouvre le bon portail.

---

## Si ça ne marche pas

| Symptôme | Cause | Fix |
|---|---|---|
| QR scanné mais "Network error" | Téléphone et Mac pas sur le même WiFi | Vérifier que les 2 sont sur le même réseau |
| QR scanné mais reste sur "Loading…" | Pare-feu Mac bloque le port 8081 (Metro) | Préférences Système → Sécurité → Pare-feu → autoriser Node |
| Login échoue avec "Network request failed" | Backend pas joignable depuis le tel | Lance avec `./mobile/scripts/dev-phone.sh --tunnel` (contourne le LAN, plus lent) |
| Erreur "Unable to resolve module" | node_modules incomplets | `cd mobile/translog-mobile && npm install` |
| Avertissement orange "[offline/db] Expo Go detected" dans la console | Normal — Expo Go n'a pas la lib SQLite native | L'app marche, juste pas de cache offline persistant |

---

## Limitations dans Expo Go (par rapport à un vrai build)

L'app fonctionne à **~95 %** dans Expo Go. Ce qui ne marche pas :

- ❌ **Persistance offline** (la file de mutations est en mémoire, perdue au reload). Marche en ligne sans souci.
- ❌ **Impression thermal Bluetooth** (lib ESC/POS native). Le bouton imprimera "no-op" silencieusement.
- ❌ **Authentification biométrique FaceID/TouchID** (lib native partiellement supportée selon version Expo Go).

**Tout le reste marche** : login, navigation, vente de billet, scan QR, signalement, profil, etc.

Pour tester ce qui ne marche pas en Expo Go → voir `mobile/DEVICE_SETUP.md` §3bis (dev build EAS).

---

## Quand tu reviens demain

Tu n'as plus besoin de réinstaller Expo Go. Juste :
```bash
# Terminal 1
npm run start:dev
# Terminal 2
./mobile/scripts/dev-phone.sh
```
Ouvre Expo Go sur le tel, l'app récente est dans l'onglet "Recent".
