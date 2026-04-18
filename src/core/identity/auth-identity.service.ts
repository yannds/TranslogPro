/**
 * AuthIdentityService — Abstraction unique pour toute opération Account/User
 * tenant-scoped (credential lookup, création, password reset, OAuth link).
 *
 * POURQUOI ?
 * Depuis la migration "multi-tenant isolation Phase 1" :
 *   - User.email    n'est plus globalement unique (devient (tenantId, email))
 *   - Account       a une colonne tenantId et la clé unique devient
 *                   (tenantId, providerId, accountId)
 *
 * Les appelants (auth.service, oauth.service, password-reset, tenant-iam…)
 * ne doivent PAS connaître ces détails Prisma. Ils appellent cette classe
 * avec `tenantId + email` et obtiennent le bon comportement.
 *
 * EN PHASE 4 (multi-tenant humain via TenantMembership) :
 *   - `findUserByEmail` pourra être étendu pour résoudre via Membership
 *   - L'API publique reste identique — zéro refactor des callers
 *
 * C'est le verrou anti-drift : plus jamais de lookup direct par email.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { Account, Prisma, Role, RolePermission, User } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';

// ─── Types de retour ─────────────────────────────────────────────────────────

export type CredentialAccountWithUser = Account & {
  user: User & {
    role: (Role & { permissions: RolePermission[] }) | null;
  };
};

export type UserWithRoleAndPermissions = User & {
  role: (Role & { permissions: RolePermission[] }) | null;
};

@Injectable()
export class AuthIdentityService {
  private readonly logger = new Logger(AuthIdentityService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // LOOKUPS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Recherche un compte credential (email+password) dans un tenant donné.
   * Inclut l'utilisateur + rôle + permissions — profil complet pour la session.
   *
   * @returns null si aucun compte trouvé (email jamais inscrit dans ce tenant).
   */
  async findCredentialAccount(
    tenantId: string,
    email:    string,
  ): Promise<CredentialAccountWithUser | null> {
    return this.prisma.account.findUnique({
      where: {
        tenantId_providerId_accountId: {
          tenantId,
          providerId: 'credential',
          accountId:  email,
        },
      },
      include: {
        user: { include: { role: { include: { permissions: true } } } },
      },
    });
  }

  /**
   * Recherche un compte OAuth externe (Google, etc.) dans un tenant.
   * accountId = identifiant OAuth du provider (subject, pas email).
   */
  async findOAuthAccount(
    tenantId:   string,
    providerId: string,
    accountId:  string,
  ): Promise<CredentialAccountWithUser | null> {
    return this.prisma.account.findUnique({
      where: {
        tenantId_providerId_accountId: { tenantId, providerId, accountId },
      },
      include: {
        user: { include: { role: { include: { permissions: true } } } },
      },
    });
  }

  /**
   * Recherche un User par email dans un tenant.
   * En Phase 1, User.email est unique par (tenantId, email), donc findUnique
   * suffit. En Phase 4, pourra être étendu pour chercher via TenantMembership.
   */
  async findUserByEmail(
    tenantId: string,
    email:    string,
  ): Promise<UserWithRoleAndPermissions | null> {
    return this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email } },
      include: { role: { include: { permissions: true } } },
    });
  }

  /**
   * Recherche un Account par son password-reset token hash (one-shot).
   * tokenHash est globalement unique (@unique), pas besoin de tenantId.
   */
  async findAccountByPasswordResetHash(
    tokenHash: string,
  ): Promise<(Account & { user: User }) | null> {
    return this.prisma.account.findUnique({
      where:   { passwordResetTokenHash: tokenHash },
      include: { user: true },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WRITES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Crée (ou met à jour) un compte credential pour un user donné.
   * Idempotent : si un compte credential existe déjà pour (tenant, email),
   * son password est remplacé.
   *
   * Utilisé par :
   *   - seeds dev (bootstrap users)
   *   - endpoints admin (réinitialisation par un admin)
   *   - auto-provisioning après claim magic link (CRM)
   */
  async upsertCredentialAccount(params: {
    tenantId:           string;
    userId:             string;
    email:              string;
    passwordHash:       string;
    forcePasswordChange?: boolean;
  }): Promise<Account> {
    const { tenantId, userId, email, passwordHash, forcePasswordChange = false } = params;

    return this.prisma.account.upsert({
      where: {
        tenantId_providerId_accountId: {
          tenantId,
          providerId: 'credential',
          accountId:  email,
        },
      },
      update: { password: passwordHash, forcePasswordChange },
      create: {
        tenantId,
        userId,
        providerId: 'credential',
        accountId:  email,
        password:   passwordHash,
        forcePasswordChange,
      },
    });
  }

  /**
   * Crée un compte OAuth lié à un User. Utilisé par oauth.service au link.
   * Tenant requis — le User.tenantId doit matcher (checked in caller).
   */
  async upsertOAuthAccount(params: {
    tenantId:     string;
    userId:       string;
    providerId:   string;
    accountId:    string;
    accessToken?: string | null;
    refreshToken?: string | null;
    expiresAt?:   Date | null;
  }): Promise<Account> {
    const { tenantId, userId, providerId, accountId } = params;

    return this.prisma.account.upsert({
      where: {
        tenantId_providerId_accountId: { tenantId, providerId, accountId },
      },
      update: {
        accessToken:  params.accessToken  ?? null,
        refreshToken: params.refreshToken ?? null,
        expiresAt:    params.expiresAt    ?? null,
      },
      create: {
        tenantId,
        userId,
        providerId,
        accountId,
        accessToken:  params.accessToken  ?? null,
        refreshToken: params.refreshToken ?? null,
        expiresAt:    params.expiresAt    ?? null,
      },
    });
  }

  /**
   * Met à jour le password hash d'un compte credential existant.
   * Utilisé après validation d'un reset token (password-reset.service).
   * Efface aussi le token hash + expiresAt (one-shot consumé).
   */
  async resetCredentialPassword(
    accountId:    string,
    passwordHash: string,
  ): Promise<Account> {
    return this.prisma.account.update({
      where: { id: accountId },
      data: {
        password:               passwordHash,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        forcePasswordChange:    false,
      },
    });
  }

  /**
   * Stocke un token de reset password (hash SHA-256 uniquement, one-shot).
   * TTL = expiresAt, typiquement 30 min.
   */
  async storePasswordResetToken(params: {
    tenantId:   string;
    email:      string;
    tokenHash:  string;
    expiresAt:  Date;
  }): Promise<Account | null> {
    const { tenantId, email, tokenHash, expiresAt } = params;

    const account = await this.findCredentialAccount(tenantId, email);
    if (!account) return null;

    return this.prisma.account.update({
      where: { id: account.id },
      data:  { passwordResetTokenHash: tokenHash, passwordResetExpiresAt: expiresAt },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // USER CREATION (admin flows)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Crée un User + son Account credential en transaction.
   * Retourne le User + Account. Idempotent seulement sur Account (upsert) —
   * si le User existe déjà (même tenantId+email), throw via la contrainte unique.
   *
   * Utilisé par tenant-iam.service (admin invite user), seeds.
   */
  async createUserWithCredential(params: {
    tenantId:     string;
    email:        string;
    name?:        string | null;
    agencyId?:    string | null;
    roleId?:      string | null;
    userType?:    string;
    passwordHash: string;
    forcePasswordChange?: boolean;
  }): Promise<{ user: User; account: Account }> {
    const { tenantId, email, name, agencyId, roleId, userType, passwordHash,
            forcePasswordChange = false } = params;

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          tenantId,
          email,
          name:     name ?? null,
          agencyId: agencyId ?? null,
          roleId:   roleId ?? null,
          userType: userType ?? 'STAFF',
        },
      });
      const account = await tx.account.create({
        data: {
          tenantId,
          userId:     user.id,
          providerId: 'credential',
          accountId:  email,
          password:   passwordHash,
          forcePasswordChange,
        },
      });
      return { user, account };
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROJECTION / SHAPE HELPERS (protégés contre future refacto de colonne)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Retourne juste les colonnes minimales pour une session — évite de leaker passwordHash. */
  async findMinimalUser(tenantId: string, email: string): Promise<
    Pick<User, 'id' | 'tenantId' | 'email' | 'isActive' | 'userType'> | null
  > {
    return this.prisma.user.findUnique({
      where:  { tenantId_email: { tenantId, email } },
      select: {
        id: true, tenantId: true, email: true, isActive: true, userType: true,
      },
    });
  }
}
