import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { from, Observable, of, switchMap, tap, catchError, throwError } from 'rxjs';
import { canonicalJson } from '@montuno/shared';
import { sha256 } from '../crypto';
import { DomainError } from '../errors';
import { PrismaService } from '../prisma.service';
import { toJson } from '../serialize';

export const IDEMPOTENT = 'idempotent';
/** Marca un endpoint mutador: requiere cabecera Idempotency-Key y repite la respuesta original en reintentos. */
export const Idempotent = () => SetMetadata(IDEMPOTENT, true);
const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;
const TTL_MS = 24 * 3600 * 1000;

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.reflector.get<boolean>(IDEMPOTENT, ctx.getHandler())) return next.handle();
    const req = ctx.switchToHttp().getRequest();
    const res = ctx.switchToHttp().getResponse();
    const key: string | undefined = req.headers['idempotency-key'];
    if (!key || !KEY_RE.test(key)) {
      throw new DomainError(
        'IDEMPOTENCY_KEY_REQUIRED',
        'Cabecera Idempotency-Key requerida (8-128 caracteres [A-Za-z0-9_-])',
        HttpStatus.BAD_REQUEST,
      );
    }
    const scope = `${req.user?.id ?? 'anon'}:${req.method}:${req.route?.path ?? req.path}:${JSON.stringify(req.params ?? {})}`;
    const requestHash = sha256(canonicalJson(req.body ?? {}));

    return from(this.begin(scope, key, requestHash)).pipe(
      switchMap((existing) => {
        if (existing) {
          res.status(existing.responseCode ?? 200);
          res.setHeader('Idempotent-Replayed', 'true');
          return of(existing.responseBody);
        }
        return next.handle().pipe(
          switchMap((body) =>
            from(
              this.prisma.idempotencyKey.update({
                where: { scope_key: { scope, key } },
                data: {
                  status: 'COMPLETED',
                  responseCode: res.statusCode,
                  responseBody: toJson(body) as Prisma.InputJsonValue,
                },
              }),
            ).pipe(switchMap(() => of(body))),
          ),
          catchError((err) =>
            from(
              this.prisma.idempotencyKey
                .delete({ where: { scope_key: { scope, key } } })
                .catch(() => undefined),
            ).pipe(switchMap(() => throwError(() => err))),
          ),
          tap(() => undefined),
        );
      }),
    );
  }

  private async begin(scope: string, key: string, requestHash: string) {
    try {
      await this.prisma.idempotencyKey.create({
        data: {
          scope,
          key,
          requestHash,
          status: 'IN_PROGRESS',
          expiresAt: new Date(Date.now() + TTL_MS),
        },
      });
      return null;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      const row = await this.prisma.idempotencyKey.findUniqueOrThrow({
        where: { scope_key: { scope, key } },
      });
      if (row.requestHash !== requestHash)
        throw new DomainError(
          'IDEMPOTENCY_KEY_REUSED',
          'Idempotency-Key reutilizada con otro cuerpo',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      if (row.status !== 'COMPLETED')
        throw new DomainError(
          'IDEMPOTENCY_IN_PROGRESS',
          'Solicitud idéntica en curso',
          HttpStatus.CONFLICT,
        );
      return row;
    }
  }
}
