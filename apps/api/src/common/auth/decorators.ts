import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@montuno/shared';
import type { AuthUser } from './auth.types';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES = 'roles';
/** Al menos uno de los roles indicados. */
export const RequireRoles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

export const CorrelationId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string | undefined => {
    return ctx.switchToHttp().getRequest().correlationId;
  },
);
