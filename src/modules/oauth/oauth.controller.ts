import {
  Controller, Get, Param, Query, Req, Res,
  NotFoundException, BadRequestException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { OAuthProviderRegistry } from './providers/oauth-provider.registry';
import { OAuthStateService } from './oauth-state.service';
import { OAuthService } from './oauth.service';
import { OAuthError } from './types';
import type { OAuthProviderMetadata } from './types';

const COOKIE_NAME = 'translog_session';
const COOKIE_OPTS = {
  httpOnly:  true,
  sameSite:  'lax' as const,   // OAuth callback vient d'un domain externe → lax requis
  secure:    process.env.NODE_ENV === 'production',
  maxAge:    30 * 24 * 3600 * 1_000,
  path:      '/',
};

function extractIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (process.env.NODE_ENV === 'production' && typeof forwarded === 'string') {
    return forwarded.split(',')[0]?.trim() ?? req.ip ?? '';
  }
  return req.ip ?? req.socket?.remoteAddress ?? '';
}

/**
 * Routes OAuth GÉNÉRIQUES — traitent tous les providers identiquement via
 * le registry. Aucune hypothèse sur Google/Microsoft/Facebook/Apple/etc.
 *
 *   GET /api/auth/oauth/providers                  — liste des providers actifs
 *   GET /api/auth/oauth/:provider/start            — redirige vers le provider
 *   GET /api/auth/oauth/:provider/callback         — callback du provider
 *
 * Pour ajouter un nouveau provider : aucune modification ici.
 * Pour retirer un provider : unset ses env vars, le registry l'ignore.
 */
@Controller('auth/oauth')
export class OAuthController {
  constructor(
    private readonly registry: OAuthProviderRegistry,
    private readonly state:    OAuthStateService,
    private readonly oauth:    OAuthService,
  ) {}

  /**
   * Liste publique des providers actifs. Consommée par le frontend pour
   * afficher dynamiquement les boutons de connexion sociale.
   */
  @Get('providers')
  listProviders(): OAuthProviderMetadata[] {
    return this.registry.list();
  }

  /**
   * Étape 1 — redirection vers l'authorize URL du provider.
   * Query params optionnels :
   *   - tenant : slug tenant (multi-tenant)
   *   - returnTo : URL de retour post-auth (whitelist côté serveur en prod)
   */
  @Get(':providerKey/start')
  async start(
    @Param('providerKey') providerKey: string,
    @Query('tenant')      tenant:      string | undefined,
    @Query('returnTo')    returnTo:    string | undefined,
    @Res()                res:         Response,
  ): Promise<void> {
    const provider = this.registry.get(providerKey);
    if (!provider) throw new NotFoundException(`Provider "${providerKey}" indisponible`);

    const state = await this.state.issue({
      providerKey,
      tenantSlug: tenant,
      returnTo:   this.sanitizeReturnTo(returnTo),
    });

    const url = provider.buildAuthorizeUrl({
      state,
      redirectUri: this.oauth.callbackUrl(providerKey),
      tenantSlug:  tenant,
    });

    res.redirect(url);
  }

  /**
   * Étape 2 — le provider redirige ici avec ?code=&state=.
   * On vérifie le state, échange le code → profile, puis délègue à
   * OAuthService.authenticateOrLink pour login/link/error.
   */
  @Get(':providerKey/callback')
  async callback(
    @Param('providerKey') providerKey: string,
    @Query('code')        code:        string | undefined,
    @Query('state')       stateNonce:  string | undefined,
    @Query('error')       providerErr: string | undefined,
    @Req()                req:         Request,
    @Res()                res:         Response,
  ): Promise<void> {
    const provider = this.registry.get(providerKey);
    if (!provider) throw new NotFoundException(`Provider "${providerKey}" indisponible`);

    // Le provider peut renvoyer ?error=access_denied (user a refusé) ;
    // on redirige vers /login avec un message court plutôt qu'un 400.
    if (providerErr) {
      return res.redirect(`/login?oauth_error=${encodeURIComponent(providerErr)}`);
    }
    if (!code || !stateNonce) {
      throw new BadRequestException('Callback OAuth invalide (code ou state manquant)');
    }

    let statePayload;
    try {
      statePayload = await this.state.consume(stateNonce, providerKey);
    } catch {
      return res.redirect('/login?oauth_error=invalid_state');
    }

    try {
      // Multi-tenant : on DOIT connaître le tenant cible pour le lookup Account.
      // Le state transporte le tenantSlug (étape 1 — posé par le frontend).
      const tenantId = await this.oauth.resolveTenantId(statePayload.tenantSlug);
      if (!tenantId) {
        return res.redirect('/login?oauth_error=unknown_tenant');
      }

      const profile = await provider.exchangeCodeForProfile({
        code,
        state: stateNonce,
        redirectUri: this.oauth.callbackUrl(providerKey),
      });

      const result = await this.oauth.authenticateOrLink(
        tenantId,
        profile,
        extractIp(req),
        req.headers['user-agent'] ?? '',
      );

      res.cookie(COOKIE_NAME, result.sessionToken, COOKIE_OPTS);
      const returnTo = statePayload.returnTo ?? '/';
      res.redirect(returnTo);
    } catch (err) {
      if (err instanceof OAuthError) {
        // Codes métier → redirection avec paramètre pour feedback UI.
        // Le détail est loggé côté serveur, jamais dans l'URL.
        const safeCode = err.code.toLowerCase();
        return res.redirect(`/login?oauth_error=${safeCode}`);
      }
      // Réseau / provider down / erreur inattendue
      return res.redirect('/login?oauth_error=provider_error');
    }
  }

  /**
   * Whitelist simple : on n'autorise que les URLs internes (commencent par /).
   * Empêche l'open redirect via returnTo=https://malicieux.com.
   */
  private sanitizeReturnTo(v?: string): string | undefined {
    if (!v) return undefined;
    if (!v.startsWith('/')) return undefined;
    if (v.startsWith('//')) return undefined; // protocol-relative
    return v.slice(0, 512); // cap
  }
}
