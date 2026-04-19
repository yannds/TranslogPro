import { Inject, Injectable } from '@nestjs/common';
import type { NormalizedOAuthProfile, OAuthProviderMetadata } from '../types';
import { OAuthError } from '../types';
import { BaseOAuthProvider } from './base-oauth.provider';
import { SECRET_SERVICE, type ISecretService } from '../../../infrastructure/secret/interfaces/secret.interface';

/**
 * Microsoft Identity Platform (Azure AD / Entra ID) — OAuth 2.0 + OIDC.
 *
 * Credentials Vault : `platform/auth/microsoft`
 *   {
 *     CLIENT_ID:     "azure-app-client-id",
 *     CLIENT_SECRET: "azure-app-client-secret",
 *     TENANT_SEGMENT: "common"  // optionnel ; "common" | "consumers" | "organizations" | GUID
 *   }
 *
 * Doc : https://learn.microsoft.com/en-us/azure/active-directory/develop/v2-oauth2-auth-code-flow
 */
interface MicrosoftCredentials {
  CLIENT_ID:      string;
  CLIENT_SECRET:  string;
  TENANT_SEGMENT?: string;
}

const DEFAULT_TENANT_SEGMENT = 'common';

@Injectable()
export class MicrosoftOAuthProvider extends BaseOAuthProvider<MicrosoftCredentials> {
  readonly meta: OAuthProviderMetadata = {
    key:         'microsoft',
    displayName: 'Microsoft',
    icon:        'microsoft',
    scopes:      ['openid', 'email', 'profile', 'User.Read'],
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
    const creds         = await this.getCredentials();
    const tenantSegment = creds.TENANT_SEGMENT ?? DEFAULT_TENANT_SEGMENT;
    const q = new URLSearchParams({
      client_id:     creds.CLIENT_ID,
      redirect_uri:  params.redirectUri,
      response_type: 'code',
      scope:         this.meta.scopes.join(' '),
      state:         params.state,
      response_mode: 'query',
      prompt:        'select_account',
    });
    return `https://login.microsoftonline.com/${tenantSegment}/oauth2/v2.0/authorize?${q}`;
  }

  async exchangeCodeForProfile(params: {
    code: string; state: string; redirectUri: string;
  }): Promise<NormalizedOAuthProfile> {
    const creds         = await this.getCredentials();
    const tenantSegment = creds.TENANT_SEGMENT ?? DEFAULT_TENANT_SEGMENT;

    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${tenantSegment}/oauth2/v2.0/token`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code:          params.code,
          client_id:     creds.CLIENT_ID,
          client_secret: creds.CLIENT_SECRET,
          redirect_uri:  params.redirectUri,
          grant_type:    'authorization_code',
          scope:         this.meta.scopes.join(' '),
        }).toString(),
      },
    );

    if (!tokenRes.ok) {
      throw new OAuthError('PROVIDER_ERROR',
        `Microsoft token exchange failed (${tokenRes.status})`,
      );
    }

    const tokenJson = await tokenRes.json() as {
      access_token?:  string;
      expires_in?:    number;
      refresh_token?: string;
      id_token?:      string;
    };

    if (!tokenJson.access_token) {
      throw new OAuthError('PROVIDER_ERROR', 'Microsoft n\'a pas retourné d\'access_token');
    }

    // Microsoft Graph /me
    const userRes = await fetch('https://graph.microsoft.com/oidc/userinfo', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    if (!userRes.ok) {
      throw new OAuthError('PROVIDER_ERROR',
        `Microsoft userinfo failed (${userRes.status})`,
      );
    }
    const info = await userRes.json() as {
      sub?:       string;
      email?:     string;
      name?:      string;
      picture?:   string;
      locale?:    string;
    };

    if (!info.sub) {
      throw new OAuthError('PROVIDER_ERROR', 'Microsoft userinfo sans sub');
    }

    // Microsoft ne retourne pas toujours email_verified explicitement ;
    // on le considère vérifié si l'email est présent (Azure AD garantit
    // la vérification à l'enrôlement).
    const expiresAt = tokenJson.expires_in
      ? new Date(Date.now() + tokenJson.expires_in * 1_000)
      : undefined;

    return {
      providerKey:        this.meta.key,
      providerAccountId:  info.sub,
      email:              info.email    ?? null,
      emailVerified:      !!info.email,
      name:               info.name     ?? null,
      avatarUrl:          info.picture  ?? null,
      locale:             info.locale   ?? null,
      accessToken:        tokenJson.access_token,
      refreshToken:       tokenJson.refresh_token,
      accessTokenExpires: expiresAt,
      raw:                { ...info },
    };
  }
}
