# Validation des immatriculations — formats par pays

**Dernière mise à jour : 2026-04-27**

## 1. Problème résolu

Avant ce chantier, le DTO `CreateBusDto.plateNumber` n'était validé que par `@IsString()`. Conséquence : `----`, `   `, `...` ou tout autre bruit passait. Aucun garde-fou contre les fautes de frappe ni les doublons.

## 2. Architecture en 3 niveaux (warn-only)

| Niveau | Règle | Action backend |
|---|---|---|
| **1. Anti-poubelle** | Longueur < 3 OU aucun caractère alphanumérique | 🚫 `400 PLATE_INVALID` |
| **2. Hors masque connu** | Ne match aucun masque enregistré pour le pays | ⚠️ `400 PLATE_ATYPICAL` (sauf si `confirmedAtypical: true`) |
| **3. Doublon dans le tenant** | Même `plateNumber` déjà utilisé | ⚠️ `409 PLATE_DUPLICATE` (sauf si `confirmedDuplicate: true`) |
| **OK** | Match au moins un masque | ✅ silent, persisté |

**Principe** : on ne **bloque jamais une plaque légitime**. Une regex stricte rejetterait des séries rares, vieilles, militaires, diplomatiques, étrangères. L'admin a toujours le dernier mot via les flags `confirmed*` ; l'audit log permet de retrouver qui a forcé.

## 3. Convention de masque (lisible humain, pas de regex)

Convention permissive :
- **Tout chiffre** dans le masque = un emplacement chiffre `[0-9]`
- **Toute lettre** dans le masque = un emplacement lettre `[A-Z]` (hors `excludedLetters`)
- **Tout autre caractère** = séparateur littéral (échappé en regex)

Exemples :
| Masque | Match | Ne match pas |
|---|---|---|
| `001-AS-4`     | `234-AB-1`    | `234-AB-12` (1 chiffre vs 2) |
| `989-BB-SS`    | `001-XY-CD`   | `001-XY-12` (lettres vs chiffres) |
| `AB-123-CD`    | `XY-456-ZW`   | `XY-456-ZW1` (longueur) |

L'admin écrit un **exemple réel** (`001-AS-4`), pas une regex. La structure est déduite automatiquement.

## 4. Stockage

`TenantBusinessConfig.licensePlateFormats : Json` — éditable par tenant via UI admin.

```json
{
  "CG": {
    "label":           "Congo Brazzaville",
    "masks":           ["999-A-9", "999-A-99", "999-AA-9", "999-AA-99", "999-AAA-9", "999-AAA-99"],
    "excludedLetters": ["W", "Y", "O", "I", "Z"],
    "examples":        ["001-AS-4", "234-AB-12", "999-AAQ-4"],
    "notes":           "NNN civil 001–999 (4 chiffres = État/armée). Q = véhicule d'État."
  }
}
```

Plusieurs masques par pays autorisés (ancien + nouveau format coexistent).

## 5. Seed initial — 36 pays

Le registre [prisma/seeds/license-plate-formats.seed.ts](../prisma/seeds/license-plate-formats.seed.ts) contient les formats par défaut pour les 36 pays présents dans `COUNTRY_DEFAULTS` (CEMAC, UEMOA, Maghreb, FR, BE, CN, etc.).

Mécanismes de provisionning :
- **Nouveaux tenants** : seed automatique dans `OnboardingService.seedPricingDefaults()` lors de l'onboarding
- **Tenants existants** : backfill silencieux dans `prisma/seed/seed.ts` (commande `npm run db:seed`). Idempotent : merge les formats par défaut avec ceux déjà personnalisés (l'admin n'est jamais écrasé).

## 6. Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/tenants/:tid/fleet/license-plate-formats` | Lit les formats du tenant + pays par défaut (`Tenant.country`). Utilisé par l'UI pour le placeholder. |
| `POST /api/tenants/:tid/fleet/buses` | Validation graduée. Body `{ plateNumber, plateCountry?, confirmedAtypical?, confirmedDuplicate?, ... }` |
| `PATCH /api/tenants/:tid/fleet/buses/:id` | Idem, validation seulement si `plateNumber` change. |

## 7. Format de réponse d'erreur

```json
{
  "code":        "PLATE_ATYPICAL",
  "message":     "Cette immatriculation ne correspond à aucun format connu pour CG. Confirmez si elle est correcte.",
  "country":     "CG",
  "triedMasks":  ["999-A-9", "999-AA-9", ...],
  "normalized":  "001-AB-12",
  "confirmHint": "Renvoyer le formulaire avec confirmedAtypical=true pour forcer."
}
```

## 8. UX côté frontend

- **Placeholder dynamique** dans `PageFleetVehicles.BusForm` : 1er exemple du pays par défaut du tenant
- **Modale de confirmation** sur 400 PLATE_ATYPICAL ou 409 PLATE_DUPLICATE : retry automatique avec le flag adéquat sur clic "Confirmer"
- Pas de blocage UX — l'admin contrôle.

## 9. Multi-pays (compagnies à plusieurs frontières)

Le DTO accepte un champ optionnel `plateCountry` qui surcharge `Tenant.country`. Une compagnie ayant des agences au Gabon et au Cameroun (formats identiques) peut saisir des plaques de l'un ou l'autre — la validation utilise le bon registre, et les doublons légitimes sont confirmables via `confirmedDuplicate`.

## 10. Tests

- 24 tests unit dans [test/unit/fleet/license-plate-validator.spec.ts](../test/unit/fleet/license-plate-validator.spec.ts)
- Couvre normalize, isJunk, maskToRegex (avec excludedLetters), matchKnownMask, validate (orchestration), findDuplicate (incl. tenant scope + excludeBusId)

## 11. Limites & TODO

- **UI admin tenant** : éditeur des masques par pays (Phase G — reporté à la prochaine itération)
- **Locales** : fr+en uniquement (6 autres en fallback fr)
- **Audit log** : la confirmation `confirmedAtypical=true` / `confirmedDuplicate=true` n'est pas (encore) tracée explicitement dans `AuditLog` — à ajouter pour la traçabilité réglementaire
