export const IDENTITY_SERVICE = 'IIdentityManager';

export interface CreateUserInput {
  email:     string;
  password:  string;
  name:      string;
  tenantId:  string;
  roleId?:   string;   // DB Role.id — optionnel à la création, seedé par onboarding
  agencyId?: string;
  userType?: string;   // STAFF | CUSTOMER | ANONYMOUS
}

export interface UserIdentity {
  id:        string;
  email:     string;
  name:      string | null;
  tenantId:  string;
  roleId:    string | null;
  agencyId?: string;
  userType:  string;
}

export interface SessionInfo {
  userId:    string;
  tenantId:  string;
  roleId:    string;   // requis par PermissionGuard
  roleName:  string;   // Role.name — logs uniquement
  agencyId?: string;
  userType:  string;
  expiresAt: Date;
}

export interface IIdentityManager {
  createUser(input: CreateUserInput): Promise<UserIdentity>;
  verifySession(token: string): Promise<SessionInfo | null>;
  revokeSession(token: string): Promise<void>;
  changePassword(userId: string, newPassword: string): Promise<void>;
}
