import { SetMetadata } from '@nestjs/common';
import { Permission } from '../constants/permissions';

export const PERMISSION_KEY = 'required_permission';

/**
 * Declares the permission required to access a route.
 * Enforced by PermissionGuard (registered globally in app.module.ts).
 *
 * Usage: `@RequirePermission(Permission.TRIP_START)`
 */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(PERMISSION_KEY, permission);
