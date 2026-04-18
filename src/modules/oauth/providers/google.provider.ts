import { Injectable } from '@nestjs/common';
import type {
  IOAuthProvider, NormalizedOAuthProfile, OAuthProviderMetadata,
} from '../types';
import { OAuthError } from '../types';

/**
 * Google OAuth 2.0 + OpenID Connect.
 *
 * Activation : setter GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET dans l'env.
 * Sans ces variables, `isEnabled` est false → le provider est ignoré par
 * le registry, aucun bouton n'apparaît côté UI, les routes répondent 404.
 *
 * Doc :
 *   https://developers.google.com/identity/protocols/oauth2/web-server
 *   https://developers.google.com/identity/openid-connect/openid-connect
 */
@Injectable()
export class GoogleOAuthProvider implements IOAuthProvider {
  readonly meta: OAuthProviderMetadata = {
    key:         'google',
    displayName: 'Google',
    icon:        'google',
    scopes:      ['openid', 'email', 'profile'],
  };

  get isEnabled(): boolean {
    return !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
  }

  buildAuthorizeUrl(params: {
    state: string; redirectUri: string; tenantSlug?: string;
  }): string {
    const q = new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      redirect_uri:  params.redirectUri,
      response_type: 'code',
      scope:         this.meta.scopes.join(' '),
      state:         params.state,
      access_type:   'offline',     // permet d'obtenir un refresh_token
      prompt:        'select_account',
      include_granted_scopes: 'true',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`;
  }

  async exchangeCodeForProfile(params: {
    code: string; state: string; redirectUri: string;
  }): Promise<NormalizedOAuthProfile> {
    // 1) Échanger le code contre des tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code:          params.code,
        client_id:     process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri:  params.redirectUri,
        grant_type:    'authorization_code',
      }).toString(),
    });

    if (!tokenRes.ok) {
      throw new OAuthError('PROVIDER_ERROR',
        `Google token exchange failed (${tokenRes.status})`,
      );
    }

    const tokenJson = await tokenRes.json() as {
      access_token?:  string;
      expires_in?:    number;
      refresh_token?: string;
      id_token?:      string;
      scope?:         string;
      token_type?:    string;
    };

    if (!tokenJson.access_token) {
      throw new OAuthError('PROVIDER_ERROR', 'Google n\'a pas retourné d\'access_token');
    }

    // 2) Appeler userinfo
    const userRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    if (!userRes.ok) {
      throw new OAuthError('PROVIDER_ERROR',
        `Google userinfo failed (${userRes.status})`,
      );
    }
    const info = await userRes.json() as {
      sub?:            string;
      email?:          string;
      email_verified?: boolean;
      name?:           string;
      picture?:        string;
      locale?:         string;
    };

    if (!info.sub) {
      throw new OAuthError('PROVIDER_ERROR', 'Google userinfo sans sub');
    }

    const expiresAt = tokenJson.expires_in
      ? new Date(Date.now() + tokenJson.expires_in * 1_000)
      : undefined;

    return {
      providerKey:        this.meta.key,
      providerAccountId:  info.sub,
      email:              info.email       ?? null,
      emailVerified:      info.email_verified === true,
      name:               info.name        ?? null,
      avatarUrl:          info.picture     ?? null,
      locale:             info.locale      ?? null,
      accessToken:        tokenJson.access_token,
      refreshToken:       tokenJson.refresh_token,
      accessTokenExpires: expiresAt,
      raw:                { ...info, scope: tokenJson.scope },
    };
  }
}
