import { SetMetadata } from '@nestjs/common';
import { Permission } from '../constants/permissions';

export const PERMISSION_KEY = 'required_permission';

/**
 * Declares the permission(s) required to access a route.
 * Enforced by PermissionGuard (registered globally in app.module.ts).
 *
 * Accepte :
 *   - `Permission` unique           : l'acteur doit avoir cette permission
 *   - `Permission[]`                : l'acteur doit avoir AU MOINS une des
 *                                      permissions listées. Le scope est dérivé
 *                                      de la 1ère permission effectivement
 *                                      détenue — mettre les plus larges (.tenant)
 *                                      en premier pour laisser le max d'accès.
 *
 * Usage :
 *   @RequirePermission(Permission.TRIP_START)
 *   @RequirePermission([Permission.STAFF_READ_TENANT, Permission.STAFF_READ])
 */
export const RequirePermission = (permission: Permission | Permission[]) =>
  SetMetadata(PERMISSION_KEY, permission);
