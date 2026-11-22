import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { DomainError } from '../errors';

/** Formato de error consistente: { error: { code, message, details?, correlationId } }. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { correlationId?: string }>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Error interno';
    let details: unknown;

    if (exception instanceof DomainError) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as string | { message?: unknown; error?: string };
      code = HttpStatus[status] ?? 'HTTP_ERROR';
      if (typeof body === 'string') message = body;
      else {
        message = Array.isArray(body.message)
          ? 'Validación fallida'
          : String(body.message ?? exception.message);
        if (Array.isArray(body.message)) details = { fields: body.message };
      }
      if (
        status === HttpStatus.BAD_REQUEST &&
        Array.isArray((body as { message?: unknown }).message)
      )
        code = 'VALIDATION_FAILED';
    } else if (
      exception instanceof Prisma.PrismaClientKnownRequestError &&
      exception.code === 'P2002'
    ) {
      status = HttpStatus.CONFLICT;
      code = 'UNIQUE_CONSTRAINT';
      message = 'Recurso duplicado';
    } else {
      this.logger.error(
        JSON.stringify({
          msg: 'unhandled_error',
          correlationId: req.correlationId,
          error: exception instanceof Error ? exception.message : String(exception),
          stack: exception instanceof Error ? exception.stack : undefined,
        }),
      );
    }
    res
      .status(status)
      .json({ error: { code, message, details, correlationId: req.correlationId } });
  }
}
