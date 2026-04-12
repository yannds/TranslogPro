import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request } from 'express';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req       = context.switchToHttp().getRequest<Request>();
    const requestId = req.headers['x-request-id'] as string;
    const start     = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const ms = Date.now() - start;
          this.logger.log(
            `[${requestId}] ${req.method} ${req.path} → 2xx (${ms}ms)`,
          );
        },
        error: () => {
          // Errors are logged by HttpExceptionFilter; skip double-logging here
        },
      }),
    );
  }
}
