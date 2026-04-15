import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { TenantModule } from '../tenant/tenant.module';

/**
 * AuthModule — credential sign-in / sign-out / me.
 *
 * NE PAS importer EventBusModule ici : REDIS_CLIENT est fourni par
 * EventBusModule au niveau de AppModule (root). Re-importer EventBusModule
 * créerait une 2e instance de RedisRateLimitGuard avec un REDIS_CLIENT capturé
 * avant onModuleInit → undefined → crash pipeline().
 *
 * RedisRateLimitGuard est résolu via le DI root (AppModule.providers) quand
 * @UseGuards(RedisRateLimitGuard) est utilisé dans AuthController.
 */
@Module({
  imports:     [TenantModule],
  controllers: [AuthController],
  providers:   [AuthService],
  exports:     [AuthService],
})
export class AuthModule {}
