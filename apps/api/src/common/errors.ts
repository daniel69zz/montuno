import { HttpStatus } from '@nestjs/common';

/** Error de dominio con código estable para la UI. */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: HttpStatus = HttpStatus.UNPROCESSABLE_ENTITY,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const notFound = (what: string) =>
  new DomainError('NOT_FOUND', `${what} no encontrado`, HttpStatus.NOT_FOUND);
export const forbidden = (msg = 'Acceso denegado') =>
  new DomainError('FORBIDDEN', msg, HttpStatus.FORBIDDEN);
export const conflict = (code: string, msg: string, details?: Record<string, unknown>) =>
  new DomainError(code, msg, HttpStatus.CONFLICT, details);
export const invalid = (code: string, msg: string, details?: Record<string, unknown>) =>
  new DomainError(code, msg, HttpStatus.UNPROCESSABLE_ENTITY, details);
