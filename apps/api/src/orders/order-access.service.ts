import { Injectable } from '@nestjs/common';
import { Order } from '@prisma/client';
import type { AuthUser } from '../common/auth/auth.types';
import { notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';

export interface OrderAccess {
  order: Order;
  isBuyer: boolean;
  isImporter: boolean;
  isArbiter: boolean;
  isAdmin: boolean;
}

/**
 * Anti-IDOR: una orden solo es visible para su comprador, miembros de su importadora,
 * el árbitro asignado (rol ARBITER + wallet verificada igual a arbiter on-chain) o ADMIN.
 * Para cualquier otro usuario responde 404 (no revela existencia).
 */
@Injectable()
export class OrderAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async load(user: AuthUser, orderId: string): Promise<OrderAccess> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw notFound('Orden');
    const a: OrderAccess = {
      order,
      isBuyer: order.buyerId === user.id,
      isImporter: user.memberships.some((m) => m.importerId === order.importerId),
      isArbiter: user.roles.has('ARBITER') && user.verifiedWallets.includes(order.arbiterWallet),
      isAdmin: user.roles.has('ADMIN'),
    };
    if (!a.isBuyer && !a.isImporter && !a.isArbiter && !a.isAdmin) throw notFound('Orden');
    return a;
  }
}
