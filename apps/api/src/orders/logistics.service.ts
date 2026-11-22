import { Injectable } from '@nestjs/common';
import { LogisticState } from '@prisma/client';
import { canImporterSetLogistic } from '@montuno/shared';
import type { AuthUser } from '../common/auth/auth.types';
import { AuditService } from '../common/audit.service';
import { conflict, forbidden, invalid } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { OrderAccessService } from './order-access.service';

@Injectable()
export class LogisticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrderAccessService,
    private readonly audit: AuditService,
  ) {}

  async update(
    user: AuthUser,
    orderId: string,
    dto: { state: LogisticState; trackingNumber?: string; carrier?: string; note?: string },
    cid?: string,
  ) {
    const { order, isImporter } = await this.access.load(user, orderId);
    if (!isImporter) throw forbidden('Solo la importadora actualiza la logística');
    if (order.paymentState !== 'ESCROW_FUNDED')
      throw conflict('ORDER_NOT_FUNDED', 'La orden aún no está financiada en el contrato');
    if (order.onchainStatus === 'SETTLED' || order.onchainStatus === 'CANCELLED')
      throw conflict('ORDER_CLOSED', 'Orden cerrada');
    if (!canImporterSetLogistic(order.logisticState, dto.state))
      throw invalid(
        'INVALID_TRANSITION',
        `Transición logística inválida ${order.logisticState} -> ${dto.state}`,
      );
    // update condicional: evita carreras entre dos operadores
    const res = await this.prisma.order.updateMany({
      where: { id: order.id, logisticState: order.logisticState },
      data: {
        logisticState: dto.state,
        ...(dto.trackingNumber
          ? { trackingNumber: dto.trackingNumber, carrier: dto.carrier ?? null }
          : {}),
      },
    });
    if (res.count !== 1) throw conflict('CONCURRENT_UPDATE', 'La orden cambió; reintenta');
    await this.prisma.orderEvent.create({
      data: {
        orderId: order.id,
        kind: 'logistic',
        from: order.logisticState,
        to: dto.state,
        actorId: user.id,
        note: dto.note,
      },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'order.logistics_updated',
      resourceType: 'Order',
      resourceId: order.id,
      before: { logisticState: order.logisticState },
      after: dto,
      correlationId: cid,
    });
    return this.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  }
}
