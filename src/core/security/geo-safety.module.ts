/**
 * GeoSafetyModule
 *
 * Module @Global — instancié une seule fois dans tout le process.
 * Garantit qu'il n'existe qu'une instance de TenantConfigService (cache partagé)
 * et de GeoSafetyProvider quelque soit le nombre de modules consommateurs.
 *
 * Enregistrement : AppModule.imports (une seule fois).
 * Consommation   : aucun import nécessaire dans les modules consommateurs
 *                  (SafetyModule, PublicReporterModule, DisplayModule) — les
 *                  providers sont visibles grâce au flag @Global().
 */

import { Global, Module } from '@nestjs/common';
import { TenantConfigService } from './tenant-config.service';
import { GeoSafetyProvider } from './geo-safety.provider';

@Global()
@Module({
  providers: [TenantConfigService, GeoSafetyProvider],
  exports:   [TenantConfigService, GeoSafetyProvider],
})
export class GeoSafetyModule {}
