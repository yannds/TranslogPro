export const IDENTITY_SERVICE = 'IIdentityManager';

export interface CreateUserInput {
  email:    string;
  password: string;
  name:     string;
  tenantId: string;
  role:     string;
  agencyId?: string;
}

export interface UserIdentity {
  id:       string;
  email:    string;
  name:     string;
  tenantId: string;
  role:     string;
  agencyId?: string;
}

export interface SessionInfo {
  userId:   string;
  tenantId: string;
  role:     string;
  agencyId?: string;
  expiresAt: Date;
}

export interface IIdentityManager {
  /** Create a user in Better Auth + seed the Prisma User record */
  createUser(input: CreateUserInput): Promise<UserIdentity>;

  /** Validate a Bearer token / session token and return session info */
  verifySession(token: string): Promise<SessionInfo | null>;

  /** Revoke a session (logout) */
  revokeSession(token: string): Promise<void>;

  /** Change password */
  changePassword(userId: string, newPassword: string): Promise<void>;
}
