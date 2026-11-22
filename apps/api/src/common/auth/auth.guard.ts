import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@montuno/shared';
import { forbidden } from '../errors';
import { PrismaService } from '../prisma.service';
import type { AuthUser } from './auth.types';
import { IS_PUBLIC, ROLES } from './decorators';
import { SessionService } from './session.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    if (!header?.startsWith('Bearer ')) {
      if (isPublic) return true;
      throw new UnauthorizedException('Sesión requerida');
    }
    let sub: string;
    try {
      sub = this.sessions.verify(header.slice(7)).sub;
    } catch {
      if (isPublic) return true;
      throw new UnauthorizedException('Sesión inválida o expirada');
    }
    req.user = await this.loadUser(sub);
    if (!req.user) throw new UnauthorizedException('Usuario inexistente');

    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (required?.length && !required.some((r) => (req.user as AuthUser).roles.has(r))) {
      throw forbidden(`Requiere rol: ${required.join(' | ')}`);
    }
    return true;
  }

  private async loadUser(id: string): Promise<AuthUser | undefined> {
    const u = await this.prisma.user.findUnique({
      where: { id },
      include: {
        platformRoles: true,
        memberships: { include: { importer: { select: { status: true } } } },
        wallets: { where: { verifiedAt: { not: null } } },
      },
    });
    if (!u) return undefined;
    const roles = new Set<Role>([Role.BUYER]);
    for (const r of u.platformRoles) roles.add(r.role as Role);
    for (const m of u.memberships)
      roles.add(m.role === 'OWNER' ? Role.IMPORTER_OWNER : Role.IMPORTER_OPERATOR);
    return {
      id: u.id,
      email: u.email,
      roles,
      memberships: u.memberships.map((m) => ({ importerId: m.importerId, role: m.role })),
      verifiedWallets: u.wallets.map((w) => w.address),
    };
  }
}
