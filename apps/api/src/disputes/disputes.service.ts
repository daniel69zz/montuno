import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { AuthUser } from '../common/auth/auth.types';
import { AuditService } from '../common/audit.service';
import { conflict, forbidden, invalid, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { toJson } from '../common/serialize';
import { EscrowService } from '../escrow/escrow.service';
import { OrderAccessService } from '../orders/order-access.service';

@Injectable()
export class DisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrderAccessService,
    private readonly escrow: EscrowService,
    private readonly audit: AuditService,
  ) {}

  /** Crea la disputa off-chain (razón privada) y prepara `open_dispute` con el hash de la razón. */
  async open(user: AuthUser, orderId: string, reason: string, cid?: string) {
    const { order, isBuyer, isImporter } = await this.access.load(user, orderId);
    if (!isBuyer && !isImporter) throw forbidden('Solo comprador o importadora abren disputas');
    if (order.paymentState !== 'ESCROW_FUNDED')
      throw conflict('ORDER_NOT_FUNDED', 'Solo órdenes financiadas en el contrato');
    if (order.onchainStatus !== 'FUNDED' && order.onchainStatus !== 'ADVANCE_PAID')
      throw conflict('INVALID_STATE', `Estado on-chain ${order.onchainStatus}`);
    if (order.disputeState === 'OPEN' || order.disputeState === 'UNDER_REVIEW')
      throw conflict('DISPUTE_ACTIVE', 'Ya existe una disputa activa');
    const role = isBuyer ? 'BUYER' : 'IMPORTER';
    const id = randomUUID();
    const reasonHash = EscrowService.privateTextHash('dispute-reason', id, reason);
    await this.prisma.dispute.create({
      data: { id, orderId, openedBy: user.id, openedByRole: role, reason, reasonHash },
    });
    const prepared = await this.escrow.prepareOpenDispute(user, order, role, id, reasonHash);
    await this.audit.record({
      actorId: user.id,
      action: 'dispute.opened_offchain',
      resourceType: 'Dispute',
      resourceId: id,
      after: { orderId, reasonHash },
      correlationId: cid,
    });
    return { disputeId: id, reasonHash, prepared };
  }

  async list(user: AuthUser, orderId: string) {
    await this.access.load(user, orderId);
    const rows = await this.prisma.dispute.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
    return toJson(rows);
  }

  async markUnderReview(user: AuthUser, orderId: string, disputeId: string, cid?: string) {
    const { isArbiter } = await this.access.load(user, orderId);
    if (!isArbiter) throw forbidden('Solo el árbitro asignado');
    const r = await this.prisma.dispute.updateMany({
      where: { id: disputeId, orderId, status: 'OPEN', onchainConfirmedAt: { not: null } },
      data: { status: 'UNDER_REVIEW' },
    });
    if (r.count !== 1)
      throw conflict('INVALID_DISPUTE_STATE', 'La disputa no está OPEN y confirmada on-chain');
    await this.prisma.order.update({
      where: { id: orderId },
      data: { disputeState: 'UNDER_REVIEW' },
    });
    await this.prisma.orderEvent.create({
      data: { orderId, kind: 'dispute', from: 'OPEN', to: 'UNDER_REVIEW', actorId: user.id },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'dispute.under_review',
      resourceType: 'Dispute',
      resourceId: disputeId,
      correlationId: cid,
    });
    return { disputeId, status: 'UNDER_REVIEW' };
  }

  /** Árbitro: reparte SOLO el saldo retenido. La resolución en texto queda off-chain; on-chain solo su hash. */
  async prepareResolution(
    user: AuthUser,
    orderId: string,
    disputeId: string,
    dto: { refundToBuyerAtomic: string; releaseToImporterAtomic: string; resolution: string },
    cid?: string,
  ) {
    const { order, isArbiter } = await this.access.load(user, orderId);
    if (!isArbiter) throw forbidden('Solo el árbitro asignado a esta orden');
    const d = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!d || d.orderId !== orderId) throw notFound('Disputa');
    if (d.status === 'RESOLVED') throw conflict('DISPUTE_RESOLVED', 'Disputa ya resuelta');
    if (!d.onchainConfirmedAt)
      throw conflict('DISPUTE_NOT_ONCHAIN', 'La disputa aún no fue confirmada en el contrato');
    const refund = BigInt(dto.refundToBuyerAtomic);
    const release = BigInt(dto.releaseToImporterAtomic);
    if (refund < 0n || release < 0n) throw invalid('INVALID_RESOLUTION', 'Montos negativos');
    const resolutionHash = EscrowService.privateTextHash(
      'dispute-resolution',
      disputeId,
      `${refund}|${release}|${dto.resolution}`,
    );
    const prepared = await this.escrow.prepareResolution(
      user,
      order,
      disputeId,
      refund,
      release,
      resolutionHash,
    );
    await this.prisma.dispute.update({
      where: { id: disputeId },
      data: {
        resolution: dto.resolution,
        resolutionHash,
        refundToBuyerAtomic: refund,
        releaseToImporterAtomic: release,
        resolvedBy: user.id,
      },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'dispute.resolution_prepared',
      resourceType: 'Dispute',
      resourceId: disputeId,
      after: { refund, release, resolutionHash },
      correlationId: cid,
    });
    return {
      prepared,
      note:
        order.advanceReleasedAtomic > 0n
          ? 'El anticipo ya pagado no forma parte del reparto: el contrato no puede devolverlo.'
          : undefined,
    };
  }
}
