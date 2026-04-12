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
        : 'An unexpected error occurred';

    const requestId = (request.headers['x-request-id'] as string) ?? 'unknown';

    if (status >= 500) {
      this.logger.error(
        `[${requestId}] ${request.method} ${request.path} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ProblemDetails = {
      type:      `https://translogpro.io/errors/${status}`,
      title:     HttpStatus[status] ?? 'Error',
      status,
      detail,
      instance:  request.path,
      requestId,
    };

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
