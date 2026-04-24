# DESIGN — Custom Domain (domaine personnalisé par tenant)

**Statut :** En attente d'implémentation
**Auteur :** Session 2026-04-17
**Dépend de :** Portail voyageur existant (`/p/:tenantSlug`), WhiteLabelMiddleware, PublicPortalService

---

## 1. Contexte et objectif

Les tenants TranslogPro veulent proposer leur portail voyageur sous leur propre nom de domaine (ex: `odn.cg`, `transport-brazza.com`) au lieu de `translogpro.cg/p/odn`.

**Objectif** : un voyageur qui tape `odn.cg` dans son navigateur voit le portail voyageur white-labellé du tenant ODN, sans jamais voir "translogpro" dans l'URL. Le portail via `/p/:slug` continue de fonctionner en parallèle (backward compatible).

### Ce que cette feature n'est PAS

- Ce n'est PAS un hébergement séparé par tenant — un seul serveur, une seule app.
- Ce n'est PAS une redirection — le voyageur reste sur `odn.cg` tout le long.
- Ce n'est PAS du DNS magic — le DNS (CNAME) amène le trafic sur notre serveur, le middleware fait le reste.

---

## 2. Comment ça marche (vue d'ensemble)

```
Voyageur tape : odn.cg
         │
         ▼
    DNS résolution
    odn.cg CNAME translogpro.cg → résout vers notre IP (ex: 145.23.x.x)
         │
         ▼
    TLS termination (Cloudflare ou Caddy)
    Cert pour odn.cg généré automatiquement
         │
         ▼
    Notre serveur NestJS reçoit :
      Host: odn.cg
      Path: /
         │
         ▼
    CustomDomainMiddleware (NOUVEAU)
      → Redis lookup "domain:odn.cg" → slug "odn"
      → Réécriture interne des URLs API
      → Flag req.customDomainSlug = "odn"
         │
         ▼
    Pipeline existant inchangé :
      SessionMiddleware → RlsMiddleware → WhiteLabelMiddleware
         │
         ▼
    Frontend SPA détecte custom domain
      → Appelle GET /api/portal/resolve → { slug: "odn" }
      → Utilise ce slug pour tous les appels API existants
         │
         ▼
    Le voyageur voit odn.cg dans sa barre d'URL
    avec le portail white-labellé du tenant ODN
```

---

## 3. Plan d'implémentation détaillé

### Phase 1 — Schema Prisma

**Fichier** : `prisma/schema.prisma`

**Modification** : Ajouter un champ `customDomain` au modèle `Tenant` :

```prisma
model Tenant {
  // ... champs existants ...
  slug            String  @unique
  customDomain    String? @unique   // ex: "odn.cg", "transport-brazza.com"
  // ... reste inchangé ...
}
```

**Migration** :

```bash
npx prisma migrate dev --name add-tenant-custom-domain
```

**Points d'attention** :
- Le champ est `String?` (nullable) — la majorité des tenants n'auront pas de custom domain.
- L'index `@unique` garantit qu'un domaine ne peut être attribué qu'à un seul tenant.
- Pas de valeur par défaut (null par défaut).

---

### Phase 2 — CustomDomainMiddleware (backend)

**Fichier à créer** : `src/modules/custom-domain/custom-domain.middleware.ts`

**Rôle** : Intercepter les requêtes entrantes, vérifier si le `Host` header correspond à un custom domain enregistré, et préparer le contexte pour le reste du pipeline.

#### 2.1 — Le middleware

```typescript
import { Injectable, NestMiddleware, Inject } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { Redis } from 'ioredis';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { REDIS_CLIENT } from '../../infrastructure/eventbus/redis-publisher.service';

/** Extension du type Request pour le slug résolu via custom domain. */
declare global {
  namespace Express {
    interface Request {
      /** Slug du tenant résolu via custom domain (undefined si accès classique). */
      customDomainSlug?: string;
    }
  }
}

const CACHE_TTL = 300; // 5 min — aligné sur PORTAL_CACHE_TTL du PublicPortalService
const CACHE_NULL_TTL = 60; // 1 min — cache négatif pour éviter les lookups DB répétés

@Injectable()
export class CustomDomainMiddleware implements NestMiddleware {
  /**
   * Set des domaines "maison" — les requêtes pour ces hosts passent sans résolution.
   *
   * IMPORTANT : mettre à jour cette liste quand on change de domaine principal.
   * En production, préférer lire depuis une variable d'environnement :
   *   MAIN_DOMAINS=translogpro.cg,www.translogpro.cg
   */
  private readonly mainDomains: Set<string>;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {
    // Lire depuis env ou utiliser les défauts
    const envDomains = process.env.MAIN_DOMAINS;
    if (envDomains) {
      this.mainDomains = new Set(envDomains.split(',').map(d => d.trim().toLowerCase()));
    } else {
      this.mainDomains = new Set([
        'translogpro.cg',
        'www.translogpro.cg',
        'localhost',
        '127.0.0.1',
      ]);
    }
  }

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const host = this.extractHost(req);

    // Domaine principal → comportement classique, on ne touche à rien
    if (this.mainDomains.has(host)) {
      return next();
    }

    // Tenter de résoudre le custom domain → slug
    const slug = await this.resolveCustomDomain(host);

    if (!slug) {
      // Domaine inconnu → on laisse passer (sera 404 naturellement)
      return next();
    }

    // Attacher le slug résolu à la requête pour :
    //   1. L'endpoint /api/portal/resolve (le frontend le lira)
    //   2. Potentiellement le RlsMiddleware / WhiteLabelMiddleware si besoin
    req.customDomainSlug = slug;

    next();
  }

  /**
   * Extrait le hostname pur (sans port) du header Host.
   * En production derrière un reverse proxy, respecter X-Forwarded-Host si présent.
   */
  private extractHost(req: Request): string {
    const forwarded = req.headers['x-forwarded-host'];
    const raw = typeof forwarded === 'string' ? forwarded : (req.headers.host ?? '');
    // Retirer le port (ex: "odn.cg:443" → "odn.cg")
    return raw.split(':')[0].toLowerCase().trim();
  }

  /**
   * Résout un custom domain en slug tenant via Redis (cache) puis Prisma (fallback).
   *
   * Stratégie de cache :
   *   - Hit positif : retourne le slug (TTL 5 min)
   *   - Hit négatif ("__NULL__") : retourne null sans toucher la DB (TTL 1 min)
   *   - Miss : query DB, cache le résultat (positif ou négatif)
   */
  private async resolveCustomDomain(host: string): Promise<string | null> {
    const cacheKey = `domain:${host}`;

    // 1. Vérifier le cache Redis
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached === '__NULL__') return null;    // cache négatif
      if (cached) return cached;                  // cache positif → slug
    } catch {
      // Redis down → fallback DB directement (non-bloquant)
    }

    // 2. Lookup en base
    const tenant = await this.prisma.tenant.findUnique({
      where: { customDomain: host },
      select: { slug: true, isActive: true, provisionStatus: true },
    });

    // Tenant inexistant, inactif, ou pas encore provisionné
    if (!tenant || !tenant.isActive || tenant.provisionStatus !== 'ACTIVE') {
      try {
        await this.redis.setex(cacheKey, CACHE_NULL_TTL, '__NULL__');
      } catch { /* Redis down — pas grave */ }
      return null;
    }

    // 3. Cacher le résultat positif
    try {
      await this.redis.setex(cacheKey, CACHE_TTL, tenant.slug);
    } catch { /* Redis down — pas grave */ }

    return tenant.slug;
  }
}
```

#### 2.2 — Invalidation du cache

Quand un admin modifie le `customDomain` d'un tenant, il faut invalider le cache Redis.

**Où** : dans le service qui gère la mise à jour du tenant (probablement `TenantService` ou un futur `CustomDomainService`).

```typescript
// Lors de la mise à jour du customDomain d'un tenant :
async updateCustomDomain(tenantId: string, newDomain: string | null): Promise<void> {
  // 1. Lire l'ancien domaine pour invalider son cache
  const tenant = await this.prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { customDomain: true },
  });

  // 2. Mettre à jour en base
  await this.prisma.tenant.update({
    where: { id: tenantId },
    data: { customDomain: newDomain?.toLowerCase().trim() || null },
  });

  // 3. Invalider l'ancien cache ET le nouveau
  if (tenant?.customDomain) {
    await this.redis.del(`domain:${tenant.customDomain}`);
  }
  if (newDomain) {
    await this.redis.del(`domain:${newDomain.toLowerCase().trim()}`);
  }
}
```

#### 2.3 — Enregistrement dans AppModule

**Fichier** : `src/app.module.ts`

Le `CustomDomainMiddleware` doit tourner **en tout premier**, avant `SessionMiddleware` :

```typescript
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // 0. CustomDomainMiddleware — résout Host → slug (custom domains)
    consumer
      .apply(CustomDomainMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });

    // 1. SessionMiddleware — hydrate req.user (inchangé)
    consumer
      .apply(SessionMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });

    // 2. TenantMiddleware (RLS) — (inchangé)
    consumer
      .apply(TenantMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });

    // 3. WhiteLabelMiddleware — (inchangé)
    consumer
      .apply(WhiteLabelMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
```

**Import à ajouter** dans `AppModule` : le `CustomDomainModule` (voir §2.5).

#### 2.4 — Variable d'environnement

**Fichier** : `.env` / `.env.example`

```env
# Domaines principaux TranslogPro (séparés par des virgules).
# Le CustomDomainMiddleware ignore ces hosts et laisse le comportement classique.
# En dev, localhost est inclus automatiquement.
MAIN_DOMAINS=translogpro.cg,www.translogpro.cg
```

#### 2.5 — Module NestJS

**Fichier à créer** : `src/modules/custom-domain/custom-domain.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { CustomDomainMiddleware } from './custom-domain.middleware';

@Module({
  providers: [CustomDomainMiddleware],
  exports: [CustomDomainMiddleware],
})
export class CustomDomainModule {}
```

Ajouter `CustomDomainModule` dans les `imports` de `AppModule`.

---

### Phase 3 — Endpoint /api/portal/resolve (backend)

**Problème** : quand le frontend est chargé sur `odn.cg`, il n'a pas le slug dans l'URL (`/p/:tenantSlug`). Il doit le demander au serveur.

**Fichier** : `src/modules/public-portal/public-portal.controller.ts`

**Ajouter** un endpoint dans le `PublicPortalController` existant — ou mieux, un controller dédié car cet endpoint n'a pas de `:tenantSlug` dans le path.

**Fichier à créer** : `src/modules/custom-domain/custom-domain.controller.ts`

```typescript
import { Controller, Get, Req, NotFoundException } from '@nestjs/common';
import { Request } from 'express';

/**
 * Endpoint de résolution custom domain.
 *
 * Appelé par le frontend SPA quand il détecte qu'il n'est pas
 * sur le path classique /p/:tenantSlug (= il est sur un custom domain).
 *
 * Le CustomDomainMiddleware a déjà résolu Host → slug et l'a attaché
 * à req.customDomainSlug. Cet endpoint ne fait que le relayer.
 *
 * Path final : GET /api/portal/resolve
 */
@Controller('portal')
export class CustomDomainController {
  @Get('resolve')
  resolve(@Req() req: Request) {
    const slug = req.customDomainSlug;
    if (!slug) {
      throw new NotFoundException(
        'No custom domain resolved. '
        + 'This endpoint is only available when accessing via a custom domain.',
      );
    }
    return { slug };
  }
}
```

**Enregistrer** dans `CustomDomainModule` :

```typescript
@Module({
  controllers: [CustomDomainController],  // ← ajouter
  providers: [CustomDomainMiddleware],
  exports: [CustomDomainMiddleware],
})
export class CustomDomainModule {}
```

**Points d'attention** :
- Cet endpoint n'a PAS besoin d'auth (pas de `@RequirePermission`).
- Pas besoin de rate limit agressif — c'est un appel unique au boot du SPA, et le middleware fait juste un lookup Redis.
- Le `setGlobalPrefix('api')` dans `main.ts` fait que le path réel est `/api/portal/resolve`.

---

### Phase 4 — Adaptation frontend

**Principe** : le frontend doit détecter s'il tourne sur un custom domain et, si oui, récupérer le slug via `/api/portal/resolve` au lieu de l'extraire de l'URL.

#### 4.1 — Modification du routing (main.tsx)

**Fichier** : `frontend/src/main.tsx`

**Avant** (ligne 122) :

```tsx
<Route path="/p/:tenantSlug/*" element={<PortailVoyageur />} />
```

**Après** :

```tsx
{/* Portail public voyageur — accès classique par slug */}
<Route path="/p/:tenantSlug/*" element={<PortailVoyageur />} />

{/* Portail public voyageur — accès via custom domain (slug résolu dynamiquement) */}
<Route path="/*" element={<CustomDomainPortalGuard />} />
```

**Attention** : la route `/*` doit rester en dernier (après toutes les autres routes : `/admin/*`, `/login`, `/p/:tenantSlug/*`, etc.), exactement là où se trouve actuellement `<HomeRedirect />`.

#### 4.2 — Composant CustomDomainPortalGuard

**Fichier à créer** : `frontend/components/portail-voyageur/CustomDomainPortalGuard.tsx`

Ce composant détecte si on est sur un custom domain et, si oui, résout le slug et affiche le portail.

```tsx
import { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';
import { PortailVoyageur } from './PortailVoyageur';

/**
 * Guard qui tente de résoudre un custom domain via /api/portal/resolve.
 *
 * - Si la résolution réussit → affiche le PortailVoyageur avec le slug
 * - Si 404 (pas un custom domain) → affiche HomeRedirect classique
 * - Pendant le chargement → écran de chargement minimal
 */
export function CustomDomainPortalGuard() {
  const [slug, setSlug] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    apiFetch<{ slug: string }>('/api/portal/resolve', { skipRedirectOn401: true })
      .then(res => {
        if (!cancelled) {
          setSlug(res.slug);
          setChecked(true);
        }
      })
      .catch(() => {
        if (!cancelled) setChecked(true); // 404 → pas un custom domain
      });

    return () => { cancelled = true; };
  }, []);

  // Pas encore vérifié → loader minimal
  if (!checked) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
      </div>
    );
  }

  // Custom domain résolu → afficher le portail
  if (slug) {
    return <PortailVoyageur overrideSlug={slug} />;
  }

  // Pas un custom domain → comportement classique (HomeRedirect)
  // Importer HomeRedirect depuis main.tsx ou le déplacer dans un fichier partagé
  return <HomeRedirect />;
}
```

#### 4.3 — Modification de PortailVoyageur

**Fichier** : `frontend/components/portail-voyageur/PortailVoyageur.tsx`

**Modification minimale** : accepter un `overrideSlug` en prop, en plus du `useParams`.

**Avant** (ligne 1130-1131) :

```tsx
export function PortailVoyageur() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
```

**Après** :

```tsx
export function PortailVoyageur({ overrideSlug }: { overrideSlug?: string } = {}) {
  const { tenantSlug: paramSlug } = useParams<{ tenantSlug: string }>();
  const tenantSlug = overrideSlug || paramSlug;
```

**C'est tout.** Le reste du composant utilise `tenantSlug` sans savoir d'où il vient. Les appels API (`/api/public/${tenantSlug}/portal/...`) fonctionnent identiquement.

#### 4.4 — Adaptation du proxy Vite (dev uniquement)

**Fichier** : `frontend/vite.config.ts`

Pour tester en dev, il faut que le proxy transmette aussi les appels du custom domain.

**Modification** : aucune côté Vite. Le proxy `/api` → `localhost:3000` fonctionne déjà. Le frontend sur `localhost:5173` appellera `/api/portal/resolve`, qui retournera 404 car `Host: localhost` n'est pas un custom domain. C'est le comportement attendu en dev.

**Pour tester le custom domain en dev** : ajouter une entrée dans `/etc/hosts` :

```
127.0.0.1   odn.local
```

Puis accéder à `http://odn.local:5173`. Le `Host` header sera `odn.local`, et :
- Il faut l'exclure de `MAIN_DOMAINS` (ne PAS l'ajouter à la liste)
- Il faut un tenant avec `customDomain = 'odn.local'` dans le seed

**Modifier le seed** (`prisma/seeds/dev.seed.ts`) pour ajouter un customDomain au tenant de test :

```typescript
await prisma.tenant.update({
  where: { slug: 'trans-express' },
  data: { customDomain: 'odn.local' },
});
```

---

### Phase 5 — CORS (critique en production)

**Problème** : en production, les appels API depuis `odn.cg` vers `translogpro.cg/api/...` sont des requêtes cross-origin. Le navigateur bloque si CORS n'autorise pas `odn.cg`.

**Mais** : si le custom domain pointe vers le même serveur (via CNAME), et que le frontend et l'API sont sur le même host (`odn.cg`), alors les appels API sont same-origin. Pas de problème CORS.

**Explication** :
- Le voyageur est sur `odn.cg`
- Le SPA fait `fetch('/api/portal/resolve')` → URL relative → requête vers `odn.cg/api/portal/resolve`
- Le CNAME fait que `odn.cg` résout vers notre serveur
- Notre serveur reçoit `Host: odn.cg`, le middleware résout le tenant
- **C'est same-origin** → pas de CORS

**Point d'attention** : ça ne marche QUE si le frontend est servi depuis le même host que l'API. C'est le cas dans notre architecture (Vite build → `dist/frontend/` servi par NestJS ou Nginx devant les deux).

**En production avec Cloudflare** : Cloudflare proxifie `odn.cg` → notre serveur. Le navigateur voit `odn.cg` pour tout (frontend + API). Pas de CORS.

**En dev avec Vite** : le proxy Vite rend tout same-origin (`localhost:5173`). Pas de CORS.

**Action** : aucune modification CORS nécessaire. Le `main.ts` actuel convient tel quel.

---

### Phase 6 — SSL / TLS

C'est le seul sujet infrastructure. Trois options, du plus simple au plus autonome.

#### Option A — Cloudflare for SaaS (RECOMMANDEE)

**Pourquoi** : zéro code serveur pour le SSL, gratuit jusqu'à 100 custom domains, renew automatique.

**Setup** (one-time, ~30 min) :

1. **Pré-requis** : `translogpro.cg` est déjà sur Cloudflare (plan gratuit suffit).

2. **Activer Cloudflare for SaaS** :
   - Dashboard Cloudflare → SSL/TLS → Custom Hostnames
   - Activer "Cloudflare for SaaS"
   - Choisir le "fallback origin" : `translogpro.cg` (ou l'IP de ton serveur)

3. **Pour chaque custom domain** (automatisable via API Cloudflare) :
   - API call : `POST /zones/{zone_id}/custom_hostnames`
   - Body : `{ "hostname": "odn.cg", "ssl": { "method": "http", "type": "dv" } }`
   - Cloudflare génère un cert DV (Domain Validation) automatiquement

4. **Côté client** (le tenant) :
   - Il configure : `odn.cg CNAME translogpro.cg` dans son registrar DNS
   - C'est tout. Cloudflare détecte le CNAME, valide le domaine, émet le cert.

5. **Vérification** :
   - Cloudflare vérifie automatiquement que le CNAME est en place
   - Si le CNAME est supprimé, Cloudflare retire le cert (pas de risque d'abus)

**Automatisation** (quand un admin ajoute un custom domain) :

```typescript
// Dans CustomDomainService, après la sauvegarde en DB :
async registerDomainOnCloudflare(domain: string): Promise<void> {
  // Appeler l'API Cloudflare pour enregistrer le custom hostname
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/custom_hostnames`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        hostname: domain,
        ssl: { method: 'http', type: 'dv' },
      }),
    },
  );
  // Stocker le custom_hostname_id pour pouvoir le supprimer plus tard
}
```

**Variables d'environnement à ajouter** :

```env
CLOUDFLARE_ZONE_ID=xxx          # Zone ID de translogpro.cg
CLOUDFLARE_API_TOKEN=xxx        # API Token avec permission "SSL and Certificates: Edit"
```

#### Option B — Caddy (self-hosted, auto-ACME)

**Pourquoi** : si tu veux tout contrôler, sans dépendre de Cloudflare.

**Caddyfile** :

```caddyfile
{
  # Endpoint interne que Caddy appelle pour vérifier si un domaine est légitime
  # avant de générer un cert Let's Encrypt (évite l'abus)
  on_demand_tls {
    ask http://localhost:3000/api/internal/domain-check
  }
}

# Toutes les requêtes HTTPS → reverse proxy vers NestJS
:443 {
  tls {
    on_demand
  }
  reverse_proxy localhost:3000
}
```

**Endpoint de vérification** à ajouter côté NestJS :

```typescript
// GET /api/internal/domain-check?domain=odn.cg
// Retourne 200 si le domaine est un custom domain valide, 404 sinon.
// Caddy appelle cet endpoint AVANT de demander un cert à Let's Encrypt.
@Controller('internal')
export class InternalController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('domain-check')
  async checkDomain(@Query('domain') domain: string) {
    if (!domain) throw new NotFoundException();
    const tenant = await this.prisma.tenant.findUnique({
      where: { customDomain: domain.toLowerCase() },
      select: { isActive: true, provisionStatus: true },
    });
    if (!tenant || !tenant.isActive || tenant.provisionStatus !== 'ACTIVE') {
      throw new NotFoundException();
    }
    return { ok: true };
  }
}
```

**Points d'attention Caddy** :
- Let's Encrypt a un rate limit de 50 certs/semaine par domaine parent. Pour des `.cg`, `.com` divers, c'est pas un problème (chaque TLD est indépendant).
- Le premier accès à un nouveau domaine est lent (~2-5s) car Caddy doit obtenir le cert. Les accès suivants sont instantanés.
- Caddy stocke les certs dans `~/.local/share/caddy/` — il faut persister ce volume en prod.

#### Option C — Nginx + Certbot (manuel, non recommandé)

Pour info seulement — il faudrait un script qui ajoute un server block Nginx + lance `certbot` pour chaque nouveau domaine. Fragile, pas scalable. À éviter.

---

### Phase 7 — Écran admin "Domaine personnalisé"

**Où** : dans l'admin tenant, section Paramètres.

**Flux UX** :

```
┌─────────────────────────────────────────────────────┐
│  Paramètres > Domaine personnalisé                  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  Domaine actuel : aucun                       │  │
│  │                                               │  │
│  │  [____________________________] .com/.cg/etc  │  │
│  │   ex: billetterie.odn.cg                      │  │
│  │                                               │  │
│  │  [Vérifier et activer]                        │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ── Instructions ──────────────────────────────────  │
│                                                     │
│  1. Connectez-vous à votre registrar DNS            │
│     (OVH, Gandi, Namecheap, etc.)                   │
│  2. Ajoutez un enregistrement CNAME :               │
│                                                     │
│     Nom :    billetterie.odn.cg                     │
│     Type :   CNAME                                  │
│     Valeur : translogpro.cg                         │
│                                                     │
│  3. Attendez la propagation DNS (jusqu'à 24h)       │
│  4. Revenez ici et cliquez "Vérifier"               │
│                                                     │
│  ── Statut ────────────────────────────────────────  │
│                                                     │
│  ● DNS non vérifié / ● DNS vérifié / ● SSL actif   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Endpoint de vérification DNS** à créer côté backend :

```typescript
// GET /api/tenant/custom-domain/verify?domain=odn.cg
async verifyDns(domain: string): Promise<{ resolved: boolean; target?: string }> {
  // Utiliser le module DNS natif de Node.js
  const dns = await import('node:dns/promises');
  try {
    const records = await dns.resolveCname(domain);
    // Vérifier qu'au moins un CNAME pointe vers translogpro.cg
    const mainDomain = process.env.MAIN_DOMAINS?.split(',')[0] ?? 'translogpro.cg';
    const resolved = records.some(r => r.toLowerCase().includes(mainDomain));
    return { resolved, target: records[0] ?? null };
  } catch {
    return { resolved: false };
  }
}
```

**i18n** : toutes les chaînes de cet écran doivent être dans les 8 locales (fr, en, ar, es, pt, ktu, ln, wo), conformément à la convention du projet.

---

## 4. Récapitulatif des fichiers à créer/modifier

### Fichiers à CREER

| Fichier | Contenu |
|---|---|
| `src/modules/custom-domain/custom-domain.module.ts` | Module NestJS |
| `src/modules/custom-domain/custom-domain.middleware.ts` | Middleware résolution Host → slug |
| `src/modules/custom-domain/custom-domain.controller.ts` | Endpoint `/api/portal/resolve` |
| `src/modules/custom-domain/custom-domain.service.ts` | CRUD customDomain + invalidation cache + appel Cloudflare |
| `frontend/components/portail-voyageur/CustomDomainPortalGuard.tsx` | Guard frontend qui résout le slug via API |

### Fichiers à MODIFIER

| Fichier | Modification |
|---|---|
| `prisma/schema.prisma` | Ajouter `customDomain String? @unique` au modèle Tenant |
| `src/app.module.ts` | Importer `CustomDomainModule`, ajouter le middleware en premier |
| `frontend/src/main.tsx` | Modifier la route catch-all `/*` pour utiliser `CustomDomainPortalGuard` |
| `frontend/components/portail-voyageur/PortailVoyageur.tsx` | Accepter `overrideSlug` prop (2 lignes) |
| `prisma/seeds/dev.seed.ts` | Ajouter `customDomain: 'odn.local'` au tenant de test |
| `.env.example` | Ajouter `MAIN_DOMAINS`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_API_TOKEN` |

### Fichiers INCHANGES (vérification explicite)

| Fichier | Pourquoi inchangé |
|---|---|
| `src/modules/public-portal/public-portal.controller.ts` | Les routes `/public/:tenantSlug/portal/*` fonctionnent identiquement |
| `src/modules/public-portal/public-portal.service.ts` | `resolveTenant(slug)` ne change pas |
| `src/infrastructure/database/rls.middleware.ts` | Résolution par session ou path param, inchangée |
| `src/modules/white-label/white-label.middleware.ts` | Lit `req.user.tenantId` ou path param, inchangé |
| `src/core/iam/middleware/session.middleware.ts` | Inchangé |
| `frontend/lib/api.ts` | Chemins relatifs, fonctionne sur tout domaine |
| `frontend/vite.config.ts` | Le proxy `/api` fonctionne tel quel |

---

## 5. Scénarios de test

### 5.1 — Accès classique (non-régression)

```
GET translogpro.cg/p/trans-express
  → CustomDomainMiddleware : Host = translogpro.cg → skip (main domain)
  → SessionMiddleware : pas de session → req.user = undefined
  → Frontend : useParams → tenantSlug = "trans-express"
  → API : /api/public/trans-express/portal/config → 200
  ✅ Comportement identique à aujourd'hui
```

### 5.2 — Accès custom domain

```
GET odn.cg
  → CustomDomainMiddleware : Host = odn.cg → Redis → slug "odn" → req.customDomainSlug = "odn"
  → Frontend : pas de /p/:slug → CustomDomainPortalGuard
  → Appel /api/portal/resolve → { slug: "odn" }
  → PortailVoyageur({ overrideSlug: "odn" })
  → API : /api/public/odn/portal/config → 200
  ✅ Portail affiché sous odn.cg
```

### 5.3 — Custom domain inexistant

```
GET inconnu.cg
  → CustomDomainMiddleware : Host = inconnu.cg → Redis miss → DB miss → null
  → req.customDomainSlug = undefined
  → Frontend : CustomDomainPortalGuard → /api/portal/resolve → 404
  → Fallback vers HomeRedirect
  ✅ Pas d'erreur, comportement gracieux
```

### 5.4 — Tenant désactivé

```
GET odn.cg (mais tenant isActive = false)
  → CustomDomainMiddleware : DB lookup → tenant inactif → null → cache négatif 1min
  → req.customDomainSlug = undefined
  → /api/portal/resolve → 404
  ✅ Domaine custom inopérant si tenant désactivé
```

### 5.5 — Changement de domaine custom

```
Admin change customDomain de "odn.cg" à "billetterie.odn.cg"
  → CustomDomainService.updateCustomDomain()
  → redis.del("domain:odn.cg")        // ancien cache invalidé
  → redis.del("domain:billetterie.odn.cg") // nouveau cache invalidé
  → Prochaine requête sur odn.cg → miss → DB → null → 404
  → Prochaine requête sur billetterie.odn.cg → miss → DB → slug "odn" → 200
  ✅ Transition propre
```

### 5.6 — Redis down

```
GET odn.cg (Redis indisponible)
  → CustomDomainMiddleware : Redis get → catch → fallback DB → slug "odn"
  → Fonctionne, juste plus lent (~5ms au lieu de ~0.3ms)
  ✅ Dégradation gracieuse
```

---

## 6. Considérations sécurité

### 6.1 — Abus de certificats SSL

**Risque** : quelqu'un pointe son domaine vers notre serveur et Caddy/Cloudflare génère un cert pour lui, consommant notre quota Let's Encrypt.

**Mitigation** :
- **Cloudflare** : les custom hostnames sont explicitement enregistrés via API. Pas d'auto-discovery.
- **Caddy** : l'endpoint `/api/internal/domain-check` vérifie que le domaine est enregistré en base avant d'autoriser la génération de cert.

### 6.2 — Host header injection

**Risque** : un attaquant envoie un `Host: malicious.com` pour manipuler le comportement.

**Mitigation** :
- Le middleware ne fait qu'un lookup DB `findUnique({ where: { customDomain: host } })`. Si le domaine n'est pas enregistré, rien ne se passe.
- Pas de concaténation du Host dans des URLs, templates, ou réponses HTML.
- Le host est normalisé en lowercase et trimé.

### 6.3 — Cookie scope

**Point d'attention** : le cookie `translog_session` est émis pour le domaine d'origine (ex: `translogpro.cg`). Sur un custom domain (`odn.cg`), le cookie n'est PAS transmis (domaine différent).

**Impact** : aucun — le portail voyageur est **sans authentification**. Pas de session, pas de cookie. Les requêtes sont publiques.

**Si un jour on ajoute un espace client authentifié sur le custom domain** : il faudra émettre un cookie séparé scoped au custom domain, ou utiliser un token en paramètre.

### 6.4 — Rate limiting par domaine

Le rate limit actuel est par IP (`keyBy: 'ip'`). Un custom domain ne change pas l'IP du voyageur → le rate limit fonctionne identiquement.

---

## 7. Estimation d'effort

| Phase | Tâche | Effort estimé |
|---|---|---|
| 1 | Schema Prisma + migration | 10 min |
| 2 | CustomDomainMiddleware + module | 1h |
| 3 | Endpoint /api/portal/resolve | 15 min |
| 4 | Frontend (guard + prop overrideSlug) | 1h |
| 5 | Vérification CORS (rien à faire) | 5 min |
| 6 | SSL — Cloudflare for SaaS setup | 30 min |
| 7 | Écran admin "Domaine personnalisé" | 2-3h |
| — | **Total** | **~5-6h** |

L'écran admin (Phase 7) est le plus long mais le moins critique — on peut le faire en dernier et configurer les custom domains manuellement en base au début.

---

## 8. Ordre d'implémentation recommandé

```
Phase 1 → 2 → 3 → 4 → test local avec /etc/hosts → Phase 6 (SSL) → Phase 7 (admin UI)
```

Les phases 1 à 4 peuvent être livrées et testées en local sans aucune infrastructure. La Phase 6 (SSL) est nécessaire uniquement pour la mise en production. La Phase 7 (admin UI) est un nice-to-have — les premiers custom domains peuvent être configurés directement en base.
