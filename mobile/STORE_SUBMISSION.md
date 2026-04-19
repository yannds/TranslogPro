# Soumission App Store + Google Play — TransLog Pro Mobile

Document opérationnel Sprint 16. Livrables couverts :
- `eas.json` (profils dev/preview/production + submit auto)
- `PrivacyInfo.xcprivacy` (manifest obligatoire iOS 17+)
- Check-list assets manquants (icônes, splash, screenshots)
- Google Play Data Safety form (à remplir manuellement)

## Pré-requis comptes

- **Apple Developer** actif (99 $/an) + access App Store Connect
- **Google Play Console** (25 $ unique) + compte de service GCP pour `eas submit`
- **EAS** : `eas login` avec un compte Expo lié au project slug `translog-pro`

Remplace dans `eas.json` :
```
appleId         → email du compte Apple Developer
ascAppId        → ID numérique App Store Connect (après création de l'app)
appleTeamId     → 10 chars (Developer → Membership)
serviceAccountKeyPath → JSON clé GCP téléchargé depuis IAM
```

## Assets à créer (non générés automatiquement)

| Fichier | Taille | Notes |
|---|---|---|
| `assets/icon.png`          | 1024×1024 | PNG RGBA, pas de coin arrondi (iOS les ajoute) |
| `assets/adaptive-icon.png` | 1024×1024 | foreground Android, fond teal #0f766e |
| `assets/splash.png`        | 1284×2778 | iPhone 15 Pro Max, centré, marges confortables |
| Screenshots iOS 6.7"       | 1290×2796 × 3+ | iPhone 15 Pro Max, localisés FR + EN |
| Screenshots iOS 5.5" (legacy) | 1242×2208 × 3+ | obligatoire si support iOS < 12 |
| Screenshots Android phone  | 1080×1920 × 2+ | téléphone classique |
| Screenshots Android tablet | 2732×2048 × 1+ | tablette 10" |

Pour Expo, placer dans `mobile/translog-mobile/assets/`. Pour les store, uploader via App Store Connect / Play Console.

## PrivacyInfo.xcprivacy

Installé à la racine `mobile/translog-mobile/`. EAS Build l'inclut automatiquement dans le bundle iOS (vérifier après build).

**À compléter si on ajoute Sentry / Firebase :** chaque SDK tiers apporte ses propres `NSPrivacyAccessedAPITypes` — consulter sa doc et étendre le fichier.

## Politique de confidentialité

URL obligatoire pour les deux stores. Héberger sur `https://translogpro.com/privacy` (exemple).

Minimum attendu :
- Types de données collectés (email, GPS opt-in, UUID appareil via auth token stocké)
- Finalités (auth, sécurité, audit, signalement citoyen)
- Droits RGPD (accès, suppression) — formulaire/contact
- Durée de conservation (GPS citoyen : 24 h ; sessions : 30 j)
- Sous-traitants (Apple/Google pour push, SRE cloud)

Déclarer l'URL dans `app.json` → `extra.privacyUrl` pour usage in-app + dans les deux store consoles.

## Google Play — Data Safety form

| Section | Réponse |
|---|---|
| Collecte de données | Oui (email, localisation approximative opt-in, données de l'app) |
| Partage avec tiers | Non (pas d'analytics tiers, pas d'ad SDKs) |
| Chiffrement en transit | Oui (HTTPS) |
| Chiffrement au repos | Oui (Keystore Android + SQLite iOS protection class) |
| Suppression sur demande | Oui — formulaire de suppression à documenter dans la policy |

## Procédure de soumission

### iOS — TestFlight → App Store

```bash
cd mobile/translog-mobile
eas build --profile production --platform ios
eas submit --profile production --platform ios
```

Dans App Store Connect :
1. Remplir metadata (titre, description, keywords, catégorie "Business")
2. Uploader screenshots
3. Renseigner l'URL privacy
4. Review info → compte de démo avec permissions CASHIER_* + DRIVER_*
5. Soumettre pour review

### Android — Internal testing → Production

```bash
cd mobile/translog-mobile
eas build --profile production --platform android
eas submit --profile production --platform android
```

Dans Play Console :
1. Internal testing d'abord (track=internal dans eas.json)
2. Data Safety form
3. Promouvoir progressivement : Internal → Closed testing → Open testing → Production

## Check-list finale avant release

- [ ] Icônes + splash intégrés
- [ ] Screenshots iOS 6.7" + Android phone + tablet
- [ ] `app.json.extra.privacyUrl` renseigné
- [ ] PrivacyInfo.xcprivacy à jour (vérifier nouvelles deps natives)
- [ ] `bundleIdentifier` iOS + `package` Android validés chez Apple/Google
- [ ] Comptes test fournis à Apple review (email + password + rôle CASHIER)
- [ ] Données de test seedées (tenant demo + 1 trip actif + 1 caisse ouvrable)
- [ ] Sentry DSN injecté via `setTelemetryDriver()` en prod (Sprint 15)
- [ ] EAS submit credentials validés (appleId, Team ID, service account)
