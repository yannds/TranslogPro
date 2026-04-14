import { SetMetadata } from '@nestjs/common';

export const MODULE_KEY = 'required_module';

/**
 * Declares the SaaS module key required for a route or controller.
 * Enforced by ModuleGuard (registered globally in app.module.ts).
 *
 * If the tenant has not installed and activated the module, the request
 * is rejected with 403 "Module not activated for this tenant".
 *
 * Usage:
 *   @RequireModule('GARAGE_PRO')
 *   @Controller('tenants/:tenantId/fleet-docs')
 *   export class FleetDocsController { ... }
 *
 * Known module keys (defined in InstalledModule.moduleKey):
 *   YIELD_ENGINE | GARAGE_PRO | SAV_MODULE | SCHEDULER | QUOTA_MANAGER
 *   FLEET_DOCS   | DRIVER_PROFILE | CREW_BRIEFING | QHSE
 */
export const RequireModule = (moduleKey: string) =>
  SetMetadata(MODULE_KEY, moduleKey);
