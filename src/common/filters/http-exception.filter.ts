import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ProblemDetails } from '../types/api-response.type';

const IS_DEV = process.env.NODE_ENV !== 'production';

const ERROR_DOCS_BASE_URL = (
  process.env.ERROR_DOCS_BASE_URL
  ?? `https://${process.env.PUBLIC_BASE_DOMAIN ?? process.env.PLATFORM_BASE_DOMAIN ?? 'translogpro.io'}/errors`
).replace(/\/$/, '');

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx      = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request  = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const detail =
      exception instanceof HttpException
        ? this.extractDetail(exception)
        : exception instanceof Error
          ? exception.message
          : 'An unexpected error occurred';

    const requestId = (request.headers['x-request-id'] as string) ?? 'unknown';

    if (status >= 500) {
      this.logger.error(
        `[${requestId}] ${request.method} ${request.path} → ${status} — ${detail}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ProblemDetails & { stack?: string } = {
      type:      `${ERROR_DOCS_BASE_URL}/${status}`,
      title:     HttpStatus[status] ?? 'Error',
      status,
      detail,
      instance:  request.path,
      requestId,
    };

    // En dev, inclure le stack trace pour le debugging
    if (IS_DEV && status >= 500 && exception instanceof Error) {
      body.stack = exception.stack;
    }

    response
      .status(status)
      .header('Content-Type', 'application/problem+json')
      .json(body);
  }

  private extractDetail(exception: HttpException): string {
    const response = exception.getResponse();
    if (typeof response === 'string') return response;
    if (typeof response === 'object' && response !== null) {
      const r = response as Record<string, unknown>;
      if (Array.isArray(r['message'])) return (r['message'] as string[]).join('; ');
      if (typeof r['message'] === 'string') return r['message'];
    }
    return exception.message;
  }
}
