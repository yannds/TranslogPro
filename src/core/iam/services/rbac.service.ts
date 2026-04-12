import { Injectable } from '@nestjs/common';
import { Permission, ROLE_PERMISSIONS } from '../../../common/constants/permissions';

@Injectable()
export class RbacService {
  hasPermission(role: string, permission: Permission): boolean {
    return (ROLE_PERMISSIONS[role] ?? []).includes(permission);
  }

  getPermissions(role: string): Permission[] {
    return ROLE_PERMISSIONS[role] ?? [];
  }

  /**
   * Check if a user can act on a resource within their agency scope.
   * Callers that need finer-grained checks (e.g. same-agency enforcement)
   * should inject this service directly rather than relying solely on
   * PermissionGuard.
   */
  canActInAgency(
    userAgencyId: string | undefined,
    resourceAgencyId: string | undefined,
    role: string,
  ): boolean {
    // Tenant admin and agency manager can act cross-agency
    if (['TENANT_ADMIN', 'AGENCY_MANAGER'].includes(role)) return true;
    if (!userAgencyId || !resourceAgencyId) return false;
    return userAgencyId === resourceAgencyId;
  }
}
