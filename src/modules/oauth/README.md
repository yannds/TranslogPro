# OAuth module — architecture & usage

Module d'authentification sociale, **décorrélé des providers concrets**. L'objectif est qu'ajouter, retirer ou remplacer un provider (Google, Microsoft, Facebook, Apple, GitHub, …) se fasse sans modifier le cœur : registry, service, controller, ou frontend.

Le module existe dans la codebase mais **n'est pas importé dans `AppModule`** — rien n'est exposé en runtime tant que cette activation explicite n'est pas faite.

---

## Activer le module

1. Setter les env vars d'au moins un provider (voir section "Providers") + `PUBLIC_APP_URL`.
2. Optionnel : `OAUTH_LINKING_STRATEGY` (défaut `PROMPT`).
3. Importer `OAuthModule` dans `src/app.module.ts` :

```ts
import { OAuthModule } from './modules/oauth/oauth.module';
// …
imports: [ …, OAuthModule, … ]
```

4. Afficher les boutons côté UI :

```tsx
import { OAuthButtonsStrip } from '../components/auth/OAuthButtonsStrip';
// À intégrer sous le bouton Sign In de LoginPage :
<OAuthButtonsStrip />
```

Le composant est auto-silencieux : si le module backend n'est pas monté (404 sur `/api/auth/oauth/providers`), il ne rend rien.

---

## Ajouter un provider (ex: Apple)

1. Créer `src/modules/oauth/providers/apple.provider.ts` qui implémente `IOAuthProvider` (voir `google.provider.ts` comme référence).
2. Ajouter la classe dans `OAUTH_PROVIDER_CLASSES` de `oauth.module.ts` (une ligne).
3. Setter ses env vars en prod / staging.

Aucun autre fichier à modifier. Le registry, le controller, le service et le frontend découvrent le nouveau provider automatiquement.

## Retirer un provider

- Production : unset ses env vars → `isEnabled=false` → registry ignore → UI ne rend plus le bouton → routes 404.
- Permanent : retirer la classe de `OAUTH_PROVIDER_CLASSES` + supprimer le fichier.

## Remplacer un provider

Modifier uniquement sa classe — les consommateurs restent inchangés tant que l'interface `IOAuthProvider` est respectée.

---

## Providers fournis

| Clé | Classe | Env vars requises |
|---|---|---|
| `google` | [GoogleOAuthProvider](providers/google.provider.ts) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| `microsoft` | [MicrosoftOAuthProvider](providers/microsoft.provider.ts) | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, (optionnel) `MICROSOFT_TENANT` |
| `facebook` | [FacebookOAuthProvider](providers/facebook.provider.ts) | `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET` |

Chaque provider implémente un parcours OAuth 2.0 / OIDC complet : `buildAuthorizeUrl` → exchange → `NormalizedOAuthProfile`. Les appels HTTP utilisent `fetch` natif (Node ≥ 18) — aucune dépendance npm ajoutée.

---

## Stratégies de linking

Quand un profil OAuth arrive avec un email qui match un `User` existant (via credential ou autre OAuth), la politique est contrôlée par `OAUTH_LINKING_STRATEGY` :

| Valeur | Comportement |
|---|---|
| `AUTO_LINK_VERIFIED` | Lie automatiquement **si** `profile.emailVerified === true`. Sinon refus. |
| `PROMPT` (défaut) | Refuse l'auto-link, renvoie `LINKING_REQUIRED` — le frontend doit confirmer. |
| `DENY` | Refuse toujours. Le user doit se connecter avec sa méthode existante. |

**Jamais** de création silencieuse de `User` : OAuth authentifie, ne provisionne pas.

---

## Sécurité

- **State CSRF** : nonce 256 bits en Redis, one-shot, TTL 10 min ([oauth-state.service.ts](oauth-state.service.ts)).
- **Cookie** : `sameSite=lax` (requis pour le redirect cross-domain du provider) + `httpOnly` + `secure` en prod.
- **Open redirect** : `returnTo` validé (doit commencer par `/`, pas `//`, cap 512 chars).
- **Audit log** : chaque login OAuth et chaque linking écrit une ligne `auth.oauth.*` dans `AuditLog`.
- **Verified email requis** pour l'auto-link. Facebook est forcé à `emailVerified=false` (pas de garantie).

---

## Contrat stable

Le test `test/unit/oauth/oauth-provider.registry.spec.ts` verrouille le contrat d'extensibilité. **Ne pas le casser sans y réfléchir** — il garantit qu'un provider peut être ajouté ou retiré en ne touchant qu'un fichier.
