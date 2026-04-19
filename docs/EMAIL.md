# Email transactionnel — documentation complète

> Documentation de référence pour l'envoi d'emails sur TransLog Pro.
> Cible : admin plateforme, admin tenant (branding uniquement), intégrateur.

---

## 1. Où configurer quoi

| Type de config | Où | Qui | Sensibilité |
|---|---|---|---|
| **Provider actif** (console / smtp / resend / o365) | Variable d'env `EMAIL_PROVIDER` | Admin plateforme au déploiement | Flag non sensible |
| **Credentials du provider** (SMTP pass, Resend API key, O365 client secret…) | HashiCorp Vault | Admin plateforme via CLI/UI Vault | **Secret — jamais en DB, jamais en .env** |
| **Identité d'envoi tenant** (from name, from address, reply-to) | Table `tenant_brands` | Admin tenant via `/admin/white-label` | Non sensible — visible par le destinataire |
| **État/healthcheck** (dernier test, statut UP/DOWN) | Table `email_provider_states` | Écrit par backend via UI plateforme | Diagnostic |

**Règle** : un secret ne transite jamais par l'API applicative. Un dump de la base de l'app ne compromet aucun accès au provider email.

---

## 2. Les 4 providers

| Key | Display | Implémentation | Vault path | Usage |
|---|---|---|---|---|
| `console` | Console (dev) | [console-email.service.ts](../src/infrastructure/notification/email/console-email.service.ts) | — | Dev uniquement. Log stdout, n'envoie jamais réellement. **Refusé en production** au boot. |
| `smtp` | SMTP (nodemailer) | [smtp-email.service.ts](../src/infrastructure/notification/email/smtp-email.service.ts) | `platform/email/smtp` | SMTP générique — OVH, Mailjet, Gmail relay, MTA interne. |
| `resend` | Resend | [resend-email.service.ts](../src/infrastructure/notification/email/resend-email.service.ts) | `platform/email/resend` | [resend.com](https://resend.com) — API REST moderne, recommandé. |
| `o365` | Microsoft 365 / Graph | [o365-email.service.ts](../src/infrastructure/notification/email/o365-email.service.ts) | `platform/email/o365` | Microsoft 365 / Azure AD app-only OAuth. |

**Un seul provider est actif à la fois**, choisi au boot par `EMAIL_PROVIDER`. Changer de provider = changer la variable + redéployer. Les 4 classes sont toutes instanciées (constructeurs légers) pour permettre le healthcheck individuel depuis l'UI admin plateforme.

---

## 3. Vault — format des secrets

### `platform/email/smtp`
```
HOST        = "smtp.ovh.fr"
PORT        = "587"
USER        = "noreply@votredomaine.com"
PASS        = "xxx"
FROM_EMAIL  = "noreply@votredomaine.com"
FROM_NAME   = "TransLog Pro"     # optionnel
SECURE      = "false"              # "true" pour port 465
```

### `platform/email/resend`
```
API_KEY     = "re_••••••••••••"
FROM_EMAIL  = "noreply@votredomaine.com"   # doit être vérifié côté Resend
FROM_NAME   = "TransLog Pro"                # optionnel
```

### `platform/email/o365`
```
TENANT_ID     = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
CLIENT_ID     = "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy"
CLIENT_SECRET = "app-client-secret"
SENDER_EMAIL  = "noreply@votredomaine.com"
SENDER_NAME   = "TransLog Pro"
```
Permission Graph requise : `Mail.Send` (Application, pas Déléguée).

---

## 4. Page admin plateforme `/admin/platform/email`

**Accès** : permission `control.platform.config.manage.global`. Visible dans le menu « Plateforme » à côté de « Paramètres plateforme ».

**Contenu** :
- Une carte « Provider actif » qui rappelle que le choix est piloté par env var + redéploiement (read-only).
- Une liste des 4 providers avec :
  - Nom + badge `Actif` si c'est le provider courant
  - Statut de santé (`UP` / `DOWN` / `DEGRADED` / `UNKNOWN`)
  - Chemin Vault attendu
  - Date du dernier healthcheck
  - Dernier message d'erreur si échec
  - Bouton **Tester** — lance `healthCheck()` sur le provider et persiste le résultat

**Ce que la page ne fait PAS** :
- Changer le provider actif (c'est env var + redéploiement)
- Afficher les secrets (ils restent dans Vault, invisibles)
- Envoyer un email de test vers une adresse arbitraire (risque de spam)

---

## 5. Identité d'envoi par tenant (`/admin/white-label`)

Depuis le 19/04/2026, chaque tenant peut personnaliser son identité d'envoi. Trois champs dans la section « Emails transactionnels » de la page branding :

- **Nom expéditeur** (`emailFromName`) : affiché avant l'adresse, ex. « TransExpress ».
- **Adresse expéditeur** (`emailFromAddress`) : l'adresse `from` dans les emails envoyés à vos clients, ex. `noreply@transexpress.cg`.
- **Adresse de réponse** (`emailReplyTo`) : optionnelle, ex. `support@transexpress.cg`. Fallback sur `emailFromAddress`.

**Résolution côté backend** (implémentée via [WhiteLabelService.resolveFromForTenant()](../src/modules/white-label/white-label.service.ts)) :

```
Priorité :
  1. dto.from explicite passé au send() (cas rare — override spécifique)
  2. TenantBrand.emailFromAddress + emailFromName
  3. Fallback plateforme : creds.FROM_EMAIL + creds.FROM_NAME depuis Vault
```

Aucun caller existant n'a besoin d'être modifié — les services SMTP/Resend/O365 lisent `dto.tenantId` (déjà présent dans `SendEmailDto`) et appellent le helper en interne.

### ⚠️ Avertissement DKIM/SPF

**Important** : personnaliser `emailFromAddress` ne suffit PAS à ce que les emails arrivent en inbox. Le domaine `@transexpress.cg` doit être **autorisé** par le provider email actif :
- **Resend** : vérification DNS DKIM/SPF requise ([docs](https://resend.com/docs/dashboard/domains/introduction)).
- **SMTP** : le MTA doit signer les messages avec DKIM pour ton domaine OU envoyer depuis un domaine autorisé.
- **O365** : le domaine doit être vérifié dans Entra (Azure AD) ET accepté comme « allowed sender » sur la boîte service.

Sans cette vérification, les messages **finiront en spam** (Gmail/Outlook rejettent les From non-authentifiés depuis 2024). La **vérification DKIM côté UI n'est pas implémentée** (roadmap §6) — aujourd'hui la plateforme écrit la valeur en DB sans valider. Responsabilité de l'admin plateforme d'orchestrer la configuration DNS avant que le tenant utilise son propre `emailFromAddress`.

---

## 6. Roadmap

- **Vérification DKIM/SPF automatisée** : bouton « Vérifier le domaine » sur la page white-label qui appelle l'API du provider (Resend `/domains/verify`, Graph Exchange Admin) et affiche le statut avant d'autoriser l'enregistrement.
- **Page monitoring tenant** read-only des 100 derniers emails transactionnels (destinataire masqué, statut SENT/FAILED, template, timestamp) — déjà faisable via la table `notifications` existante.
- **Test d'envoi depuis la page plateforme** — envoyer un email fictif à une adresse admin autorisée (whitelist) pour valider le pipeline sans toucher de vrais clients.
- **Rotation de credentials automatique** : intégration Vault auto-rotate pour les API keys des providers qui le supportent (Resend).

---

## 7. Dépannage

| Symptôme | Cause probable | Fix |
|---|---|---|
| L'API crashe au boot avec `EMAIL_PROVIDER=console interdit en production` | `NODE_ENV=production` sans vrai provider configuré | Setter `EMAIL_PROVIDER=smtp\|resend\|o365` et provisionner Vault. |
| Healthcheck retourne `DOWN` | Credentials absents/invalides | `vault kv get secret/platform/email/<provider>` → vérifier toutes les clés attendues ; sinon `vault kv put` pour corriger. |
| Emails partent mais finissent en spam | DKIM/SPF manquant sur le domaine du `from` | Configurer DKIM/SPF côté DNS (cf. §5 ⚠️). |
| Resend retourne `403 You can only send testing emails to your own email address` | API key en mode sandbox Resend ou domaine non vérifié | Vérifier le domaine dans [resend.com/domains](https://resend.com/domains) ou utiliser la clé de production. |
| O365 `AADSTS70011: The provided value for the input parameter 'scope' is not valid` | Permission Graph `Mail.Send` non accordée | Azure portal → App registrations → API permissions → Add `Mail.Send` (Application) → Grant admin consent. |
| Tenant change `emailFromAddress` mais les emails partent toujours depuis l'adresse plateforme | Cache Redis Branding 5min pas encore invalidé | Recharger la page branding → déclenche un upsert qui invalide le cache. Sinon attendre ≤5min. |

---

## 8. Chemins backend utiles

| Fichier | Rôle |
|---|---|
| [src/infrastructure/notification/interfaces/email.interface.ts](../src/infrastructure/notification/interfaces/email.interface.ts) | Interface `IEmailService` + `SendEmailDto` + `EMAIL_SERVICE` token DI. |
| [src/infrastructure/notification/email/email-provider.factory.ts](../src/infrastructure/notification/email/email-provider.factory.ts) | Factory qui choisit `EMAIL_SERVICE` selon `EMAIL_PROVIDER` env. |
| [src/infrastructure/notification/email/*.service.ts](../src/infrastructure/notification/email/) | Les 4 implémentations concrètes (console, smtp, resend, o365). |
| [src/modules/platform-email/platform-email.controller.ts](../src/modules/platform-email/platform-email.controller.ts) | Endpoints `/api/v1/platform/email/providers` (read-only + healthcheck). |
| [src/modules/platform-email/platform-email.service.ts](../src/modules/platform-email/platform-email.service.ts) | Service qui liste les providers + persiste les healthchecks. |
| [src/modules/white-label/white-label.service.ts](../src/modules/white-label/white-label.service.ts) | `resolveFromForTenant()` — helper d'identité d'envoi. |
| Table `email_provider_states` | Statut + healthcheck des 4 providers (plateforme-global, une ligne par provider). |
| Table `tenant_brands` | Colonnes `emailFromName`, `emailFromAddress`, `emailReplyTo` pour l'identité tenant. |
| [frontend/components/pages/PagePlatformEmail.tsx](../frontend/components/pages/PagePlatformEmail.tsx) | Page UI admin plateforme. |
| [frontend/components/pages/PageBranding.tsx](../frontend/components/pages/PageBranding.tsx) | Section « Emails transactionnels » côté tenant. |
