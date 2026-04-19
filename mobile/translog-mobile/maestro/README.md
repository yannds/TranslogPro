# Maestro E2E — TransLog Pro Mobile

3 flows critiques :
- `login.yaml`        — connexion CASHIER depuis état propre
- `sell-ticket.yaml`  — vente billet complète (wizard 3 étapes)
- `incident.yaml`     — signalement incident

## Prérequis

1. Installation Maestro :
   ```
   brew install facebook/fb/maestro
   ```
   (Linux : voir https://maestro.mobile.dev/getting-started/installing-maestro)

2. Un device / émulateur connecté (Android Studio ou Xcode Simulator).

3. Backend dev + seed E2E (tenant demo + caissier seedé) :
   ```
   cd /Users/dsyann/TranslogPro
   npm run start:dev
   ```

4. App mobile installée sur le device :
   ```
   cd mobile/translog-mobile
   npx expo start   # puis 'i' ou 'a'
   ```

## Exécution locale

```bash
cd mobile/translog-mobile/maestro
cp env.ci.example env.ci    # remplir avec les creds E2E réels
maestro test login.yaml        --env-file env.ci
maestro test sell-ticket.yaml  --env-file env.ci
maestro test incident.yaml     --env-file env.ci
```

Ou tout en une passe :
```
maestro test --env-file env.ci .
```

## CI (GitHub Actions)

Maestro Cloud (payant, cross-platform) ou job self-hosted avec émulateur Android :

```yaml
# .github/workflows/mobile-e2e.yml (exemple)
name: Mobile E2E
on: [pull_request]
jobs:
  maestro:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - uses: reactivecircus/android-emulator-runner@v2
        with:
          api-level: 34
          script: |
            curl -Ls https://get.maestro.mobile.dev | bash
            export PATH="$PATH":"$HOME/.maestro/bin"
            maestro test mobile/translog-mobile/maestro --env E2E_EMAIL=${{ secrets.E2E_EMAIL }} --env E2E_PASSWORD=${{ secrets.E2E_PASSWORD }}
```

## Stratégie

- Les flows référencent des **texts visibles** (pas de `testID`). Simple, fragile aux changements UI.
- Ajouter progressivement des `testID` sur les éléments critiques (ex. `data-testid="trip-card"`) pour durcir.
- Les flows sont idempotents : `clearState: true` dans `login` garantit un état neutre.
- Le seed E2E doit créer : 1 tenant + 1 CASHIER + 1 caisse ouverte + 1 trip PLANNED d'aujourd'hui. Script : `npm run seed:e2e` (à créer si absent).
