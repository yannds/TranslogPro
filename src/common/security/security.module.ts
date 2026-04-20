/**
 * SecurityModule — Providers partagés anti-abus pour endpoints publics.
 *
 * Exporte :
 *   - TurnstileService + TurnstileGuard (CAPTCHA Cloudflare)
 *   - IdempotencyGuard + IdempotencyInterceptor (anti-replay POST)
 *
 * Le rate limit (`RedisRateLimitGuard`) reste dans `common/guards` — il est
 * déjà utilisé partout et ne fait pas partie de ce nouveau module pour
 * éviter d'avoir à l'importer dans tous les modules existants.
 *
 * Ce module est @Global() pour que les endpoints publics puissent importer
 * les Guards sans avoir à réimporter le module dans chaque feature module.
 */
import { Global, Module } from '@nestjs/common';
import { TurnstileService } from '../captcha/turnstile.service';
import { TurnstileGuard }   from '../captcha/turnstile.guard';
import {
  IdempotencyGuard, IdempotencyInterceptor,
} from '../idempotency/idempotency.guard';
import { SecretModule } from '../../infrastructure/secret/secret.module';

@Global()
@Module({
  imports:   [SecretModule],
  providers: [TurnstileService, TurnstileGuard, IdempotencyGuard, IdempotencyInterceptor],
  exports:   [TurnstileService, TurnstileGuard, IdempotencyGuard, IdempotencyInterceptor],
})
export class SecurityModule {}
