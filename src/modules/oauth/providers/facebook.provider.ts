import { Inject, Injectable } from '@nestjs/common';
import type { NormalizedOAuthProfile, OAuthProviderMetadata } from '../types';
import { OAuthError } from '../types';
import { BaseOAuthProvider } from './base-oauth.provider';
import { SECRET_SERVICE, type ISecretService } from '../../../infrastructure/secret/interfaces/secret.interface';

/**
 * Facebook Login — OAuth 2.0 (non OIDC).
 *
 * Credentials Vault : `platform/auth/facebook`
 *   {
 *     CLIENT_ID:     "facebook-app-id",
 *     CLIENT_SECRET: "facebook-app-secret",
 *   }
 *
 * ATTENTION : Facebook ne retourne un email QUE si l'utilisateur a une
 * adresse vérifiée associée à son compte Facebook ET accepte le scope
 * `email` au consent. Prévoir un parcours de secours si `profile.email`
 * est null (le flow standard remontera alors OAuthError('NO_EMAIL')).
 *
 * Doc : https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow/
 */
interface FacebookCredentials {
  CLIENT_ID:     string;
  CLIENT_SECRET: string;
}

@Injectable()
export class FacebookOAuthProvider extends BaseOAuthProvider<FacebookCredentials> {
  readonly meta: OAuthProviderMetadata = {
    key:         'facebook',
    displayName: 'Facebook',
    icon:        'facebook',
    scopes:      ['email', 'public_profile'],
  };

  constructor(@Inject(SECRET_SERVICE) secretService: ISecretService) {
    super(secretService);
  }

  protected requiredKeys(): readonly string[] {
    return ['CLIENT_ID', 'CLIENT_SECRET'] as const;
  }

  async buildAuthorizeUrl(params: {
    state: string; redirectUri: string; tenantSlug?: string;
  }): Promise<string> {
    const creds = await this.getCredentials();
    const q = new URLSearchParams({
      client_id:     creds.CLIENT_ID,
      redirect_uri:  params.redirectUri,
      response_type: 'code',
      scope:         this.meta.scopes.join(','),
      state:         params.state,
      auth_type:     'rerequest', // re-demande l'email si l'utilisateur l'a refusé la première fois
    });
    return `https://www.facebook.com/v18.0/dialog/oauth?${q.toString()}`;
  }

  async exchangeCodeForProfile(params: {
    code: string; state: string; redirectUri: string;
  }): Promise<NormalizedOAuthProfile> {
    const creds = await this.getCredentials();

    // 1) Token exchange
    const tokenUrl = `https://graph.facebook.com/v18.0/oauth/access_token?${new URLSearchParams({
      client_id:     creds.CLIENT_ID,
      client_secret: creds.CLIENT_SECRET,
      redirect_uri:  params.redirectUri,
      code:          params.code,
    })}`;

    const tokenRes = await fetch(tokenUrl);
    if (!tokenRes.ok) {
      throw new OAuthError('PROVIDER_ERROR',
        `Facebook token exchange failed (${tokenRes.status})`,
      );
    }
    const tokenJson = await tokenRes.json() as {
      access_token?: string;
      expires_in?:   number;
      token_type?:   string;
    };
    if (!tokenJson.access_token) {
      throw new OAuthError('PROVIDER_ERROR', 'Facebook n\'a pas retourné d\'access_token');
    }

    // 2) /me avec fields explicites
    const userRes = await fetch(
      `https://graph.facebook.com/v18.0/me?${new URLSearchParams({
        fields:       'id,name,email,picture',
        access_token: tokenJson.access_token,
      })}`,
    );
    if (!userRes.ok) {
      throw new OAuthError('PROVIDER_ERROR', `Facebook /me failed (${userRes.status})`);
    }
    const info = await userRes.json() as {
      id?:      string;
      name?:    string;
      email?:   string;
      picture?: { data?: { url?: string } };
    };

    if (!info.id) {
      throw new OAuthError('PROVIDER_ERROR', 'Facebook /me sans id');
    }

    const expiresAt = tokenJson.expires_in
      ? new Date(Date.now() + tokenJson.expires_in * 1_000)
      : undefined;

    return {
      providerKey:        this.meta.key,
      providerAccountId:  info.id,
      email:              info.email ?? null,
      // Facebook ne garantit pas explicitement la vérification — prudence,
      // on refuse le AUTO_LINK_VERIFIED pour ce provider.
      emailVerified:      false,
      name:               info.name  ?? null,
      avatarUrl:          info.picture?.data?.url ?? null,
      locale:             null,
      accessToken:        tokenJson.access_token,
      accessTokenExpires: expiresAt,
      raw:                { ...info },
    };
  }
}
