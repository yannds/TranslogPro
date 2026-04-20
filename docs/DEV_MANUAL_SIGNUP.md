# Manuel — Tester le signup SaaS en dev local

Ce manuel explique comment créer un tenant via le wizard public
`/signup` sur ta machine de dev et accéder à son espace.
**Si ton app tourne déjà** (tu peux ouvrir
[https://translog.test](https://translog.test)), **une seule commande
est nécessaire** : `npm run dev:sync-hosts` avant de cliquer sur le
CTA du SuccessScreen. Va directement à la [section 1](#1-créer-un-tenant-via-le-wizard).

---

## 0. Pré-requis — setup one-shot (à sauter si ton app tourne déjà)

À faire **uniquement** dans ces cas :

- Première installation sur la machine
- Après `./scripts/dev-down.sh` (arrêt complet du stack)
- Après reboot si Docker Desktop s'est arrêté

```bash
./scripts/dev-up.sh
```

Ce script installe mkcert, génère les certs wildcard, lance Docker
(Postgres + Caddy + etc.), applique le schéma Prisma, seed les
tenants de base et écrit le bloc `TRANSLOG DEV` initial dans
`/etc/hosts`.

Puis, dans 2 terminaux séparés (hot-reload) :

```bash
# Terminal A
npm run start:dev

# Terminal B
npm run dev --prefix frontend
```

> **Une fois ça fait, tu ne retouches plus à `dev-up.sh`.** Ton stack
> tourne en arrière-plan. Pour les tests signup suivants, tu n'as
> besoin que de `npm run dev:sync-hosts` (voir sections 2-3).

---

## 1. Créer un tenant via le wizard

Ouvre [https://translog.test/signup](https://translog.test/signup)
dans un navigateur. Remplis les 3 étapes :

| Étape   | Champs                                                 |
|---------|--------------------------------------------------------|
| Admin   | Nom complet, email, mot de passe (≥ 8 caractères)      |
| Company | Nom, slug (auto-dérivé), pays, activité                |
| Plan    | Un des plans publics (trial 30 j par défaut)           |

> **L'envoi d'email n'est pas bloquant.** Le welcome email part en
> fire-and-forget (`void this.sendWelcomeEmail()`) — si SMTP n'est
> pas configuré, tu verras juste un `WARN Welcome email failed` dans
> les logs backend, rien de plus. Le tenant est créé, tu peux avancer.

À la soumission :
- Backend `POST /api/public/signup` → crée Tenant + User admin + abonnement + agence par défaut
- Frontend bascule sur le `SuccessScreen` avec un gros bouton
  **« Accéder à mon espace »** → `https://<slug>.translog.test/login`

---

## 2. Le signal dev-only

En dev local (domaine `translog.test`), le SuccessScreen affiche un
**banner jaune** juste au-dessus du bouton :

> ⚠ **Dev local : un pas avant de cliquer**
>
> Le sous-domaine `<slug>.translog.test` n'est pas encore dans
> `/etc/hosts`. Lance la commande ci-dessous (sudo requis) puis
> clique sur le bouton :
>
>     npm run dev:sync-hosts

Ce banner ne s'affiche **qu'en dev** (condition :
`VITE_PLATFORM_BASE_DOMAIN === 'translog.test'`). En prod il est
invisible.

---

## 3. Synchroniser /etc/hosts

Dans un terminal :

```bash
npm run dev:sync-hosts
```

Le script :
1. Lit la liste des slugs depuis la DB (`SELECT slug FROM tenants`)
2. Filtre les tenants jetables (`pw-saas-*`, `pw-a-*`, `pw-e2e-*`,
   `e2e-*`) pour ne pas polluer `/etc/hosts` pendant les tests CI
3. Régénère le bloc `TRANSLOG DEV` dans `/etc/hosts` (sudo requis)
4. Idempotent — tu peux le relancer autant que tu veux

### Variante dry-run (aucune écriture, aucun sudo)

```bash
npm run dev:sync-hosts:dry
```

Affiche ce qui serait écrit sans toucher à `/etc/hosts`. Utile pour
vérifier que ton slug est bien pris en compte avant de lancer la
version réelle.

---

## 4. Se connecter au tenant

Clique sur **« Accéder à mon espace »** dans le SuccessScreen, ou
va directement à :

```
https://<slug>.translog.test/login
```

Identifiants : le couple **email + mot de passe** saisi à l'étape 1
du wizard. Ton User est créé avec `userType=TENANT_ADMIN` sur ce
tenant, donc tu arrives directement sur le dashboard admin.

---

## 5. Supprimer un tenant de test

### Tenants de test jetables (préfixes whitelistés)

```bash
npx ts-node scripts/cleanup-e2e-tenants.ts pw-saas-     # défaut
npx ts-node scripts/cleanup-e2e-tenants.ts pw-a-
npx ts-node scripts/cleanup-e2e-tenants.ts pw-e2e-
npx ts-node scripts/cleanup-e2e-tenants.ts e2e-
```

Ce script refuse tout préfixe hors whitelist → impossible de
supprimer un tenant de prod par accident. Il utilise
`SET LOCAL session_replication_role = 'replica'` dans une
transaction pour contourner les FK non-cascade (réservé au cleanup
E2E, jamais dans le code applicatif).

### Un tenant créé via signup manuel

Pour l'instant il n'y a pas de commande CLI dédiée aux tenants créés
via signup — tu peux :

- Donner au slug un préfixe whitelisté (`e2e-maboite`) pour pouvoir
  le supprimer via `cleanup-e2e-tenants.ts`
- Ou le supprimer via Prisma Studio : `npx prisma studio` → table
  `tenants` → delete

Après suppression, relance `npm run dev:sync-hosts` pour retirer le
slug de `/etc/hosts`.

---

## 6. Tout arrêter / tout désinstaller

```bash
./scripts/dev-down.sh          # arrête Docker, retire bloc /etc/hosts
./scripts/dev-down.sh --full   # + supprime volumes DB, certs, CA mkcert
./scripts/dev-restore-hosts.sh # restaure /etc/hosts à l'identique du backup
```

---

## Cheat-sheet

### Flux normal (stack déjà up)
| Action                                | Commande                          |
|---------------------------------------|-----------------------------------|
| Créer un tenant via wizard            | [https://translog.test/signup](https://translog.test/signup) |
| **Sync `/etc/hosts` après signup**    | **`npm run dev:sync-hosts`**      |
| Dry-run sync (aucun sudo)             | `npm run dev:sync-hosts:dry`      |
| Purger tenants E2E                    | `npx ts-node scripts/cleanup-e2e-tenants.ts <prefix>` |

### Setup / teardown (rare)
| Action                                | Commande                          |
|---------------------------------------|-----------------------------------|
| Setup initial (1ʳᵉ fois / après down) | `./scripts/dev-up.sh`             |
| Backend + frontend hot-reload         | `npm run start:dev` / `npm run dev --prefix frontend` |
| Arrêter le stack                      | `./scripts/dev-down.sh`           |
| Tout désinstaller                     | `./scripts/dev-down.sh --full`    |

---

## Architecture rappel

- **Domaine dev** : `translog.test` (RFC 2606 TLD `.test`, non
  routable — safe). Override via
  `PLATFORM_BASE_DOMAIN=xxx ./scripts/dev-up.sh`.
- **Source de vérité config** : [scripts/dev.config.sh](../scripts/dev.config.sh)
- **Email welcome** : fire-and-forget, non bloquant
  ([src/modules/public-signup/public-signup.service.ts:194](../src/modules/public-signup/public-signup.service.ts#L194))
- **Success screen** :
  [frontend/components/public/PublicSignup.tsx:648-707](../frontend/components/public/PublicSignup.tsx#L648-L707)
- **Script sync hosts** : [scripts/dev-sync-hosts.sh](../scripts/dev-sync-hosts.sh)
- **Cleanup E2E** : [scripts/cleanup-e2e-tenants.ts](../scripts/cleanup-e2e-tenants.ts)
