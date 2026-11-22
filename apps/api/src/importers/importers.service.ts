import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ImporterStatus } from '@prisma/client';
import { ENV, Env } from '../config/env';
import type { AuthUser } from '../common/auth/auth.types';
import { AuditService } from '../common/audit.service';
import { conflict, DomainError, forbidden, invalid, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { toJson } from '../common/serialize';
import { ESCROW_GATEWAY, StellarEscrowGateway } from '../stellar/escrow-gateway';
import type { CreateImporterDto, ImporterLimitsDto, UpdateImporterDto } from './importers.dto';

@Injectable()
export class ImportersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
    @Inject(ESCROW_GATEWAY) private readonly gateway: StellarEscrowGateway,
  ) {}

  present(i: {
    id: string;
    publicName: string;
    nit: string | null;
    status: ImporterStatus;
    maxOrderAmountAtomic: bigint;
    maxAdvanceBps: number;
    allowedModes: string[];
    wallet?: { address: string } | null;
    createdAt: Date;
  }) {
    return toJson({
      id: i.id,
      publicName: i.publicName,
      nit: i.nit,
      status: i.status,
      walletAddress: i.wallet?.address ?? null,
      limits: {
        maxOrderAmountAtomic: i.maxOrderAmountAtomic,
        maxAdvanceBps: i.maxAdvanceBps,
        allowedModes: i.allowedModes,
      },
      createdAt: i.createdAt,
    });
  }

  async create(user: AuthUser, dto: CreateImporterDto, cid?: string) {
    if (user.memberships.length)
      throw conflict('ALREADY_MEMBER', 'El usuario ya pertenece a una importadora');
    const imp = await this.prisma.$transaction(async (tx) => {
      const i = await tx.importer.create({
        data: {
          ownerUserId: user.id,
          publicName: dto.publicName,
          nit: dto.nit,
          members: { create: { userId: user.id, role: 'OWNER' } },
        },
        include: { wallet: true },
      });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'importer.created',
          resourceType: 'Importer',
          resourceId: i.id,
          after: dto,
          correlationId: cid,
        },
        tx,
      );
      return i;
    });
    return this.present(imp);
  }

  /** Importadora del usuario y su rol. */
  async mine(user: AuthUser, requireOwner = false) {
    const m = user.memberships[0];
    if (!m) throw notFound('Importadora');
    if (requireOwner && m.role !== 'OWNER')
      throw forbidden('Solo el propietario de la importadora');
    const imp = await this.prisma.importer.findUniqueOrThrow({
      where: { id: m.importerId },
      include: { wallet: true },
    });
    return { importer: imp, role: m.role };
  }

  async update(user: AuthUser, dto: UpdateImporterDto, cid?: string) {
    const { importer } = await this.mine(user, true);
    const updated = await this.prisma.importer.update({
      where: { id: importer.id },
      data: dto,
      include: { wallet: true },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'importer.updated',
      resourceType: 'Importer',
      resourceId: importer.id,
      before: { publicName: importer.publicName, nit: importer.nit },
      after: dto,
      correlationId: cid,
    });
    return this.present(updated);
  }

  /** Configura la wallet de cobro: debe ser una wallet del propietario con posesión probada (SEP-53). */
  async setWallet(user: AuthUser, walletId: string, cid?: string) {
    const { importer } = await this.mine(user, true);
    const w = await this.prisma.userWallet.findUnique({ where: { id: walletId } });
    if (!w || w.userId !== user.id) throw notFound('Wallet');
    if (!w.verifiedAt) throw invalid('WALLET_UNVERIFIED', 'La wallet no tiene prueba de posesión');
    if (w.address === this.gateway.arbiterAddress)
      throw invalid('WALLET_IS_ARBITER', 'La wallet del árbitro no puede cobrar');
    // Cambiar wallet NO afecta órdenes existentes: su importer_wallet quedó fijada on-chain.
    const updated = await this.prisma.importer.update({
      where: { id: importer.id },
      data: { walletId: w.id },
      include: { wallet: true },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'importer.wallet_set',
      resourceType: 'Importer',
      resourceId: importer.id,
      before: { walletId: importer.walletId },
      after: { walletId: w.id, address: w.address },
      correlationId: cid,
    });
    return this.present(updated);
  }

  // --- admin ---------------------------------------------------------------
  async setStatus(adminId: string, id: string, status: ImporterStatus, cid?: string) {
    const imp = await this.prisma.importer.findUnique({ where: { id } });
    if (!imp) throw notFound('Importadora');
    const updated = await this.prisma.importer.update({
      where: { id },
      data: { status, reviewedBy: adminId, reviewedAt: new Date() },
      include: { wallet: true },
    });
    await this.audit.record({
      actorId: adminId,
      action: `importer.${status.toLowerCase()}`,
      resourceType: 'Importer',
      resourceId: id,
      before: { status: imp.status },
      after: { status },
      correlationId: cid,
    });
    return this.present(updated);
  }

  async setLimits(adminId: string, id: string, dto: ImporterLimitsDto, cid?: string) {
    const imp = await this.prisma.importer.findUnique({ where: { id } });
    if (!imp) throw notFound('Importadora');
    if (dto.maxAdvanceBps > this.gateway.maxAdvanceBps)
      throw new DomainError(
        'ADVANCE_ABOVE_CONTRACT_CAP',
        `El contrato limita el anticipo a ${this.gateway.maxAdvanceBps} bps`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    if (dto.allowedModes.includes('PARTIAL_ADVANCE') && dto.maxAdvanceBps === 0)
      throw invalid('ADVANCE_BPS_REQUIRED', 'PARTIAL_ADVANCE requiere maxAdvanceBps > 0');
    const data = {
      maxOrderAmountAtomic: BigInt(dto.maxOrderAmountAtomic),
      maxAdvanceBps: dto.maxAdvanceBps,
      allowedModes: dto.allowedModes,
    };
    const updated = await this.prisma.importer.update({
      where: { id },
      data,
      include: { wallet: true },
    });
    await this.audit.record({
      actorId: adminId,
      action: 'importer.limits_set',
      resourceType: 'Importer',
      resourceId: id,
      before: {
        maxOrderAmountAtomic: imp.maxOrderAmountAtomic,
        maxAdvanceBps: imp.maxAdvanceBps,
        allowedModes: imp.allowedModes,
      },
      after: data,
      correlationId: cid,
    });
    return this.present(updated);
  }

  async list(status?: ImporterStatus) {
    const rows = await this.prisma.importer.findMany({
      where: status ? { status } : {},
      include: { wallet: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.present(r));
  }
}
