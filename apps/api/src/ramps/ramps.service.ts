import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../common/auth/auth.types';
import { AuditService } from '../common/audit.service';
import { conflict, DomainError, forbidden, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { toJson } from '../common/serialize';
import { isDelivering } from '../integrations/caja-ramp.provider';
import { KYC_PROVIDER, KycProvider, RAMP_PROVIDER, RampProvider } from '../integrations/ports';
import { OrderAccessService } from '../orders/order-access.service';
import { ESCROW_GATEWAY, StellarEscrowGateway } from '../stellar/escrow-gateway';
import { SimulatedEscrowGateway } from '../stellar/simulated.gateway';

/**
 * La rampa (fiat -> token a la WALLET del comprador) es un paso SEPARADO del funding del contrato.
 * Un éxito de rampa lleva a WALLET_FUNDED; nunca a ESCROW_FUNDED.
 */
@Injectable()
export class RampsService {
  private readonly log = new Logger('Ramps');
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrderAccessService,
    private readonly audit: AuditService,
    @Inject(RAMP_PROVIDER) private readonly ramp: RampProvider,
    @Inject(KYC_PROVIDER) private readonly kyc: KycProvider,
    @Inject(ESCROW_GATEWAY) private readonly gateway: StellarEscrowGateway,
  ) {}

  private async buyerOrder(user: AuthUser, orderId: string) {
    const a = await this.access.load(user, orderId);
    if (!a.isBuyer) throw forbidden('Solo el comprador');
    return a.order;
  }

  async quote(user: AuthUser, orderId: string) {
    const order = await this.buyerOrder(user, orderId);
    const routes = await this.ramp.listAvailableRoutes({
      country: 'BO',
      fiatCurrency: 'BOB',
      network: order.network,
      tokenContractId: order.tokenContractId,
    });
    const route = routes.find((r) => r.available);
    if (!route)
      throw new DomainError(
        'NO_RAMP_ROUTE',
        'No hay ruta de rampa disponible; consigue tokens de prueba por otro medio documentado',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    await this.preflight(order.buyerWallet, order.amountAtomic);
    const q = await this.ramp.getQuote({
      routeId: route.id,
      targetAtomic: order.amountAtomic,
      tokenDecimals: 7,
      destinationWallet: order.buyerWallet,
    });
    const kycReq = await this.kyc.getRequirements(user.id, route.id);
    const kycStatus = await this.kyc.getStatus(user.id, route.id);
    const row = await this.prisma.rampTransaction.create({
      data: {
        orderId,
        provider: q.provider,
        corridor: route.id,
        amountFiat: new Prisma.Decimal(q.fiatAmount),
        fiatCurrency: q.fiatCurrency,
        asset: order.tokenContractId,
        expectedAtomic: q.deliversAtomic,
        destinationWallet: order.buyerWallet,
        status: 'QUOTED',
        simulated: q.simulated,
        quoteExpiresAt: q.expiresAt,
        rawSafeMetadata: { rate: q.rate, spreadBps: q.spreadBps, feeFiat: q.feeFiat },
      },
    });
    return toJson({
      rampQuoteId: row.id,
      route,
      quote: q,
      kyc: { required: kycReq.required, status: kycStatus },
      simulated: q.simulated,
      SIMULATED: q.simulated,
    });
  }

  async start(user: AuthUser, orderId: string, rampQuoteId: string, cid?: string) {
    const order = await this.buyerOrder(user, orderId);
    const r = await this.prisma.rampTransaction.findUnique({ where: { id: rampQuoteId } });
    if (!r || r.orderId !== orderId) throw notFound('Cotización de rampa');
    if (r.status !== 'QUOTED') throw conflict('RAMP_ALREADY_STARTED', `Estado ${r.status}`);
    if (!r.quoteExpiresAt || r.quoteExpiresAt < new Date()) {
      await this.prisma.rampTransaction.update({
        where: { id: r.id },
        data: { status: 'EXPIRED' },
      });
      throw conflict('RAMP_QUOTE_EXPIRED', 'La cotización de la rampa venció; pide otra');
    }
    if (!['NOT_STARTED', 'FAILED', 'RAMP_PENDING'].includes(order.paymentState))
      throw conflict('INVALID_PAYMENT_STATE', `Estado ${order.paymentState}`);
    const kycReq = await this.kyc.getRequirements(user.id, r.corridor);
    if (kycReq.required && (await this.kyc.getStatus(user.id, r.corridor)) !== 'approved')
      throw new DomainError(
        'KYC_REQUIRED',
        'Esta ruta exige KYC aprobado para el corredor',
        HttpStatus.FORBIDDEN,
        { corridorId: r.corridor },
      );
    const meta = (r.rawSafeMetadata ?? {}) as Record<string, string>;
    await this.preflight(r.destinationWallet, r.expectedAtomic);
    const session = await this.ramp.start({
      quote: {
        routeId: r.corridor,
        provider: r.provider,
        fiatAmount: r.amountFiat.toString(),
        fiatCurrency: r.fiatCurrency,
        rate: meta.rate,
        spreadBps: Number(meta.spreadBps),
        feeFiat: meta.feeFiat,
        deliversAtomic: r.expectedAtomic,
        expiresAt: r.quoteExpiresAt,
        simulated: r.simulated,
      },
      orderId,
      destinationWallet: r.destinationWallet,
    });
    const updated = await this.prisma.rampTransaction.update({
      where: { id: r.id },
      data: { status: 'PENDING', providerReference: session.externalId },
    });
    if (order.paymentState !== 'RAMP_PENDING') {
      await this.prisma.order.update({
        where: { id: orderId },
        data: { paymentState: 'RAMP_PENDING' },
      });
      await this.prisma.orderEvent.create({
        data: {
          orderId,
          kind: 'payment',
          from: order.paymentState,
          to: 'RAMP_PENDING',
          actorId: user.id,
          note: `ramp ${r.provider}${r.simulated ? ' SIMULATED' : ''}`,
        },
      });
    }
    await this.audit.record({
      actorId: user.id,
      action: 'ramp.started',
      resourceType: 'RampTransaction',
      resourceId: r.id,
      after: { provider: r.provider, simulated: r.simulated },
      correlationId: cid,
    });
    return toJson({
      ramp: updated,
      paymentInstructions: session.paymentInstructions,
      simulated: session.simulated,
    });
  }

  async status(user: AuthUser, orderId: string) {
    await this.buyerOrder(user, orderId);
    const rows = await this.prisma.rampTransaction.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    return toJson({
      paymentState: order.paymentState,
      ramps: rows,
      note:
        order.paymentState === 'WALLET_FUNDED'
          ? 'Los fondos están en tu wallet; aún debes firmar el depósito al contrato (prepare-funding).'
          : undefined,
    });
  }

  private async preflight(destination: string, amount: bigint) {
    if (!isDelivering(this.ramp)) return;
    const pf = await this.ramp.preflight(destination, amount);
    if (!pf.ok) throw new DomainError(pf.code, pf.message, HttpStatus.UNPROCESSABLE_ENTITY);
  }

  private async moveOrder(orderId: string, to: 'WALLET_FUNDED' | 'FAILED', note: string) {
    const res = await this.prisma.order.updateMany({
      where: { id: orderId, paymentState: 'RAMP_PENDING' },
      data: { paymentState: to },
    });
    if (res.count === 1)
      await this.prisma.orderEvent.create({
        data: { orderId, kind: 'payment', from: 'RAMP_PENDING', to, note },
      });
  }

  /**
   * Finalización de una rampa (idempotente). Reclamo atómico PENDING -> PROCESSING: un segundo webhook o una
   * carrera no puede provocar una segunda entrega. Solo mueve la orden a WALLET_FUNDED (nunca ESCROW_FUNDED).
   */
  async applyCompletion(providerReference: string, outcome: 'COMPLETED' | 'FAILED') {
    const r = await this.prisma.rampTransaction.findUnique({ where: { providerReference } });
    if (!r) throw notFound('Rampa');
    const claimed = await this.prisma.rampTransaction.updateMany({
      where: { id: r.id, status: 'PENDING' },
      data: { status: outcome === 'FAILED' ? 'FAILED' : 'PROCESSING' },
    });
    if (claimed.count !== 1)
      return { applied: false, status: r.status, deliveryTxHash: r.deliveryTxHash };
    if (outcome === 'FAILED') {
      await this.moveOrder(r.orderId, 'FAILED', 'ramp failed (provider)');
      return { applied: true, status: 'FAILED' };
    }

    if (isDelivering(this.ramp)) {
      let res;
      try {
        res = await this.ramp.deliver(r.destinationWallet, r.expectedAtomic);
      } catch (e) {
        await this.prisma.rampTransaction.update({
          where: { id: r.id },
          data: { status: 'FAILED', deliveryError: (e as Error).message.slice(0, 500) },
        });
        await this.moveOrder(r.orderId, 'FAILED', 'ramp delivery rejected');
        return { applied: true, status: 'FAILED', error: (e as Error).message };
      }
      await this.prisma.rampTransaction.update({
        where: { id: r.id },
        data: { deliveryTxHash: res.txHash },
      });
      return this.finishDelivery(r.id, r.orderId, res.status, res.txHash, res.error);
    }

    if (r.simulated && this.gateway instanceof SimulatedEscrowGateway) {
      // Modo totalmente simulado: tokens simulados a la WALLET (no al contrato).
      this.gateway.mint(r.destinationWallet, r.expectedAtomic);
    }
    await this.prisma.rampTransaction.update({
      where: { id: r.id },
      data: { status: 'COMPLETED' },
    });
    await this.moveOrder(
      r.orderId,
      'WALLET_FUNDED',
      `ramp completed${r.simulated ? ' SIMULATED' : ''}`,
    );
    return { applied: true, status: 'COMPLETED' };
  }

  private async finishDelivery(
    rampId: string,
    orderId: string,
    status: 'SUCCESS' | 'FAILED' | 'PENDING',
    txHash: string,
    error?: string,
  ) {
    if (status === 'PENDING')
      return { applied: true, status: 'PROCESSING', deliveryTxHash: txHash };
    if (status === 'FAILED') {
      await this.prisma.rampTransaction.update({
        where: { id: rampId },
        data: { status: 'FAILED', deliveryError: error ?? 'fallida on-chain' },
      });
      await this.moveOrder(orderId, 'FAILED', `ramp delivery failed tx=${txHash}`);
      return { applied: true, status: 'FAILED', deliveryTxHash: txHash };
    }
    await this.prisma.rampTransaction.update({
      where: { id: rampId },
      data: { status: 'COMPLETED' },
    });
    await this.moveOrder(orderId, 'WALLET_FUNDED', `ramp delivered on-chain tx=${txHash}`);
    return {
      applied: true,
      status: 'COMPLETED',
      deliveryTxHash: txHash,
      explorerUrl: this.gateway.explorerTxUrl(txHash),
    };
  }

  /** Conciliación de entregas en PROCESSING: se resuelven por el hash, nunca volviendo a pagar. */
  async reconcileDeliveries() {
    const stuck = await this.prisma.rampTransaction.findMany({
      where: { status: 'PROCESSING' },
      take: 100,
    });
    let resolved = 0;
    for (const r of stuck) {
      if (!r.deliveryTxHash) {
        // Caída entre el reclamo y el envío: requiere revisión manual (no se re-paga automáticamente).
        this.log.warn(
          JSON.stringify({ msg: 'ramp_processing_without_tx_needs_manual_review', rampId: r.id }),
        );
        continue;
      }
      const st = await this.gateway
        .getTransactionStatus(r.deliveryTxHash)
        .catch(() => ({ status: 'NOT_FOUND' as const }));
      if (st.status === 'NOT_FOUND') continue;
      await this.finishDelivery(r.id, r.orderId, st.status, r.deliveryTxHash);
      resolved++;
    }
    return { checked: stuck.length, resolved };
  }

  /** SOLO desarrollo: simula que el comprador pagó el QR en bolivianos (dispara la entrega de la rampa). */
  async simulatePayment(user: AuthUser, orderId: string) {
    await this.buyerOrder(user, orderId);
    const r = await this.prisma.rampTransaction.findFirst({
      where: { orderId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    if (!r?.providerReference) throw conflict('NO_PENDING_RAMP', 'No hay una rampa pendiente');
    if (!r.simulated) throw forbidden('Solo para rampas simuladas');
    return toJson(await this.applyCompletion(r.providerReference, 'COMPLETED'));
  }
}
