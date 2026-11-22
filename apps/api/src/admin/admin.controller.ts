import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ImporterStatus } from '@prisma/client';
import { Role } from '@montuno/shared';
import type { AuthUser } from '../common/auth/auth.types';
import { CorrelationId, CurrentUser, RequireRoles } from '../common/auth/decorators';
import { AuditService } from '../common/audit.service';
import { notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { GrantRoleDto, ImporterLimitsDto } from '../importers/importers.dto';
import { ImportersService } from '../importers/importers.service';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@RequireRoles(Role.ADMIN)
export class AdminController {
  constructor(
    private readonly importers: ImportersService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('importers')
  list(@Query('status') status?: ImporterStatus) {
    return this.importers.list(status);
  }

  /** Revisión manual (KYB) aprobada. */
  @Post('importers/:id/verify')
  verify(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @CorrelationId() cid?: string,
  ) {
    return this.importers.setStatus(u.id, id, 'VERIFIED', cid);
  }

  /** Suspende nuevas cotizaciones. NO bloquea fondos ya financiados (el contrato no lo permite). */
  @Post('importers/:id/suspend')
  suspend(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @CorrelationId() cid?: string,
  ) {
    return this.importers.setStatus(u.id, id, 'SUSPENDED', cid);
  }

  @Patch('importers/:id/limits')
  limits(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ImporterLimitsDto,
    @CorrelationId() cid?: string,
  ) {
    return this.importers.setLimits(u.id, id, dto, cid);
  }

  @Post('users/:id/roles')
  async grant(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GrantRoleDto,
    @CorrelationId() cid?: string,
  ) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw notFound('Usuario');
    await this.prisma.userPlatformRole.upsert({
      where: { userId_role: { userId: id, role: dto.role } },
      create: { userId: id, role: dto.role, grantedBy: u.id },
      update: {},
    });
    await this.audit.record({
      actorId: u.id,
      action: 'user.role_granted',
      resourceType: 'User',
      resourceId: id,
      after: { role: dto.role },
      correlationId: cid,
    });
    return { userId: id, role: dto.role, granted: true };
  }

  @Get('audit')
  auditLog(@Query('resourceId') resourceId?: string) {
    return this.prisma.auditLog.findMany({
      where: resourceId ? { resourceId } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
