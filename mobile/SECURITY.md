# Sécurité mobile — état des lieux & plan

## En place (Sprints 6-18)

### Auth
- Token bearer opaque 256 bits (`src/auth/token.ts`) stocké dans Keychain iOS / Keystore Android via `expo-secure-store`.
- `accessible: AFTER_FIRST_UNLOCK` — token lisible uniquement après unlock device post-reboot.
- Expiration serveur 30 j + rotation ≥ 15 j (session-rotation.spec.ts).
- Biométrie opt-in via `src/auth/biometric.ts` (FaceID/TouchID/Android Biometric). Fallback PIN device autorisé.

### Réseau
- HTTPS strict en prod (base URL `expo.extra.apiBaseUrl`).
- Tous les endpoints tenant-scopés : `TenantIsolationGuard` + `PathTenantMatchGuard` côté backend.
- `Idempotency-Key` systématique sur mutations (outbox + inline).
- 401 → token auto-purgé, retour login (AuthContext).

### Stockage local
- SQLite `translog_offline.db` (`@op-engineering/op-sqlite`). Protection : class `NSFileProtectionCompleteUntilFirstUserAuthentication` par défaut iOS, chiffrement disque Android (FDE / FBE).
- Outbox payloads peuvent contenir des données métier sensibles (noms passagers, téléphones). Durée courte : purge DONE > 7 j.

### Observability
- Capture globale erreurs JS (`src/telemetry/telemetry.ts`). Driver console par défaut, injectable Sentry en prod.

## À venir (roadmap Sprint 18 étendu)

### SQLCipher
- Activer la version chiffrée de `op-sqlite` (option `encryptionKey` générée au premier launch et stockée Keychain).
- Impact : léger surcoût CPU sur queries — négligeable pour notre volume outbox.
- Priorité : Haute pour les apps caissier / quai qui stockent ephéméralement le cash en mutation.

### Certificate pinning
- Empêche MITM via CA compromise / proxy corporate.
- Implémentation via `react-native-ssl-pinning` ou config native iOS `NSAppTransportSecurity.NSPinnedDomains`.
- Pré-requis : fournir SPKI hash de `*.translogpro.com` et de 2 backup.
- Priorité : Haute une fois le domaine prod stable.

### Jailbreak / root detection
- Heuristiques : présence Cydia, Magisk, chemins /sbin/su, libs de tweak connues.
- `react-native-jailbreak-monitor` ou `expo-device.isRootedExperimentalAsync` (Android).
- Politique : warning UI sur device suspect + forcer re-login biométrique, ne pas bloquer l'app (false-positives > 1 %).

### Token rotation mobile
- Aujourd'hui : session serveur 30 j. Mobile partage la même.
- Ajout : rotation côté app toutes les 24 h en silence (GET /auth/me avec new token via Set-Cookie-like header).
- Impact blast radius : réduit d'un facteur 30 en cas de vol token.

### Logs structurés
- Format JSON (`level, ts, msg, ctx`) piped vers stdout ; lu par le driver Sentry ou NewRelic en prod.
- Aucun PII logué — enforcement via ESLint custom rule + code review.

## Check-list sécurité avant soumission store

- [ ] Aucun `console.log` de token ou password dans le bundle release (`eas build --profile production` minifie + strip)
- [ ] `app.json.extra.apiBaseUrl` pointe HTTPS prod
- [ ] `PrivacyInfo.xcprivacy` à jour avec toutes les libs natives
- [ ] Pas d'AppTransportSecurity `NSAllowsArbitraryLoads=true` en release
- [ ] Screenshots masquent les données passagers réelles (RGPD)
- [ ] Politique de confidentialité hébergée + URL validée par le juriste
