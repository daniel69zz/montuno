import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Order, PaymentState, Prisma } from '@prisma/client';
import { atomicToDecimal, EscrowEventType } from '@montuno/shared';
import type { AuthUser } from '../common/auth/auth.types';
import { AuditService } from '../common/audit.service';
import { sha256 } from '../common/crypto';
import { conflict, DomainError, forbidden, invalid, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { toJson } from '../common/serialize';
import { OrderAccessService } from '../orders/order-access.service';
import {
  ESCROW_GATEWAY,
  EscrowCall,
  EscrowGatewayError,
  OnChainOrder,
  StellarEscrowGateway,
} from '../stellar/escrow-gateway';

type SignerRole = 'BUYER' | 'IMPORTER' | 'ARBITER';
const FUNDABLE: PaymentState[] = [
  'NOT_STARTED',
  'RAMP_PENDING',
  'WALLET_FUNDED',
  'ESCROW_PENDING',
  'FAILED',
];
const MIN_FUNDING_MARGIN_S = 60;

const EVENTS_BY_ACTION: Record<string, EscrowEventType[]> = {
  create_and_fund: ['escrow_created', 'funded'],
  claim_advance: ['advance_released'],
  confirm_delivery_and_release: ['delivery_confirmed'],
  open_dispute: ['dispute_opened'],
  resolve_dispute: ['dispute_resolved'],
};

@Injectable()
export class EscrowService {
  private readonly log = new Logger('EscrowService');
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrderAccessService,
    private readonly audit: AuditService,
    @Inject(ESCROW_GATEWAY) private readonly gateway: StellarEscrowGateway,
  ) {}

  private gatewayError(e: unknown): never {
    if (e instanceof EscrowGatewayError) {
      const status =
        e.code === 'TX_MISMATCH' || e.code === 'MISSING_SIGNATURE' || e.code === 'INVALID_ENVELOPE'
          ? HttpStatus.UNPROCESSABLE_ENTITY
          : HttpStatus.UNPROCESSABLE_ENTITY;
      throw new DomainError(
        e.code,
        e.message,
        status,
        e.contractError ? { contractError: e.contractError } : undefined,
      );
    }
    throw e;
  }

  private async chainOrder(order: Order) {
    try {
      return await this.gateway.getOrder(order.onchainOrderId);
    } catch (e) {
      this.gatewayError(e);
    }
  }

  // ------------------------------------------------------------------------
  // prepare-*: construyen la tx con argumentos validados; NO ejecutan nada.
  // ------------------------------------------------------------------------

  private async store(
    order: Order,
    user: AuthUser,
    role: SignerRole,
    signer: string,
    call: EscrowCall,
    extra: { disputeId?: string } = {},
  ) {
    let env;
    try {
      env = await this.gateway.prepare(call, signer);
    } catch (e) {
      this.gatewayError(e);
    }
    // invalida preparaciones previas de la misma acción (misma secuencia => solo una podría entrar)
    await this.prisma.preparedTransaction.updateMany({
      where: { orderId: order.id, action: call.fn, status: 'PREPARED' },
      data: { status: 'EXPIRED' },
    });
    const args = JSON.parse(
      JSON.stringify(call, (_, v) => (typeof v === 'bigint' ? v.toString() : v)),
    );
    const p = await this.prisma.preparedTransaction.create({
      data: {
        orderId: order.id,
        action: call.fn,
        signerRole: role,
        signerAddress: signer,
        signerUserId: user.id,
        txHash: env.txHash,
        unsignedXdr: env.unsignedXdr,
        args,
        format: env.format,
        expiresAt: env.expiresAt,
        disputeId: extra.disputeId,
      },
    });
    return {
      preparedId: p.id,
      action: call.fn,
      format: env.format,
      unsignedXdr: env.unsignedXdr,
      txHash: env.txHash,
      networkPassphrase: env.networkPassphrase,
      expiresAt: env.expiresAt.toISOString(),
      signer: { role, address: signer },
      fees: { payer: signer, maxFeeStroops: env.maxFeeStroops, sponsored: false },
      args,
      simulated: this.gateway.kind === 'simulated',
      instructions:
        `Firma esta transacción en el cliente con la wallet ${signer} (cuenta fuente). La autorización Soroban ` +
        `(source-account auth) cubre exactamente estos argumentos. El servidor solo acepta un sobre firmado cuyo hash ` +
        `sea ${env.txHash}. Nunca envíes claves privadas.`,
    };
  }

  async prepareFunding(user: AuthUser, orderId: string, cid?: string) {
    const { order, isBuyer } = await this.access.load(user, orderId);
    if (!isBuyer) throw forbidden('Solo el comprador financia');
    if (!FUNDABLE.includes(order.paymentState))
      throw conflict('NOT_FUNDABLE', `Estado de pago ${order.paymentState}`);
    const onchain = await this.chainOrder(order);
    if (onchain) {
      await this.syncFromChain(order.id, 'prepare-check');
      throw conflict('ALREADY_FUNDED', 'La orden ya existe en el contrato');
    }
    const nowS = Math.floor(Date.now() / 1000);
    const deadlineS = Math.floor(order.fundingDeadline.getTime() / 1000);
    if (deadlineS < nowS + MIN_FUNDING_MARGIN_S) {
      // Vence la cotización/FX antes del depósito => recalcular precio (nueva cotización).
      await this.prisma.quote.update({ where: { id: order.quoteId }, data: { status: 'EXPIRED' } });
      throw new DomainError(
        'QUOTE_RECALCULATION_REQUIRED',
        'La cotización o el tipo de cambio vencieron antes del depósito; la importadora debe emitir una nueva',
        HttpStatus.CONFLICT,
      );
    }
    let balance: bigint;
    try {
      balance = await this.gateway.tokenBalance(order.buyerWallet);
    } catch (e) {
      this.gatewayError(e);
    }
    if (balance < order.amountAtomic)
      throw new DomainError(
        'INSUFFICIENT_TOKEN_BALANCE',
        'La wallet no tiene suficientes tokens para financiar',
        HttpStatus.UNPROCESSABLE_ENTITY,
        {
          requiredAtomic: order.amountAtomic.toString(),
          balanceAtomic: balance.toString(),
        },
      );
    const call: EscrowCall = {
      fn: 'create_and_fund',
      orderIdHex: order.onchainOrderId,
      buyer: order.buyerWallet,
      terms: {
        importer: order.importerWallet,
        arbiter: order.arbiterWallet,
        token: order.tokenContractId,
        amountTotal: order.amountAtomic,
        advanceAmount: order.advanceAmountAtomic,
        mode: order.escrowMode,
        termsHashHex: order.termsHash,
        fundingDeadline: deadlineS,
        fulfillmentDeadline: Math.floor(order.fulfillmentDeadline.getTime() / 1000),
      },
    };
    const res = await this.store(order, user, 'BUYER', order.buyerWallet, call);
    await this.setPayment(order, 'ESCROW_PENDING', user.id, 'funding prepared');
    await this.audit.record({
      actorId: user.id,
      action: 'escrow.funding_prepared',
      resourceType: 'Order',
      resourceId: order.id,
      after: { txHash: res.txHash },
      correlationId: cid,
    });
    return res;
  }

  async prepareAdvance(user: AuthUser, orderId: string, cid?: string) {
    const { order, isImporter } = await this.access.load(user, orderId);
    if (!isImporter) throw forbidden('Solo la importadora reclama el anticipo');
    if (order.escrowMode !== 'PARTIAL_ADVANCE')
      throw invalid('ADVANCE_NOT_ALLOWED', 'La orden es FULL_ESCROW');
    const onchain = await this.chainOrder(order);
    if (!onchain) throw conflict('ORDER_NOT_FUNDED', 'La orden no está financiada en el contrato');
    if (onchain.status === 'DISPUTED') throw conflict('DISPUTE_ACTIVE', 'Disputa activa');
    if (onchain.status !== 'FUNDED')
      throw conflict('ADVANCE_UNAVAILABLE', `Estado on-chain ${onchain.status}`);
    // El anticipo NO exige comprobante de compra: existe para financiar la compra.
    const res = await this.store(order, user, 'IMPORTER', order.importerWallet, {
      fn: 'claim_advance',
      orderIdHex: order.onchainOrderId,
    });
    await this.audit.record({
      actorId: user.id,
      action: 'escrow.advance_prepared',
      resourceType: 'Order',
      resourceId: order.id,
      after: { txHash: res.txHash },
      correlationId: cid,
    });
    return res;
  }

  async prepareDeliveryConfirmation(user: AuthUser, orderId: string, cid?: string) {
    const { order, isBuyer } = await this.access.load(user, orderId);
    if (!isBuyer) throw forbidden('Solo el comprador confirma la entrega');
    if (order.logisticState !== 'READY_FOR_DELIVERY' && order.logisticState !== 'DELIVERED')
      throw conflict('NOT_DELIVERED', 'La importadora aún no marcó el pedido como listo/entregado');
    const onchain = await this.chainOrder(order);
    if (!onchain) throw conflict('ORDER_NOT_FUNDED', 'La orden no está financiada');
    if (onchain.status === 'DISPUTED') throw conflict('DISPUTE_ACTIVE', 'Disputa activa');
    if (onchain.status !== 'FUNDED' && onchain.status !== 'ADVANCE_PAID')
      throw conflict('INVALID_STATE', `Estado on-chain ${onchain.status}`);
    const res = await this.store(order, user, 'BUYER', order.buyerWallet, {
      fn: 'confirm_delivery_and_release',
      orderIdHex: order.onchainOrderId,
    });
    await this.audit.record({
      actorId: user.id,
      action: 'escrow.delivery_prepared',
      resourceType: 'Order',
      resourceId: order.id,
      after: { txHash: res.txHash, releasesAtomic: onchain.remainingEscrow },
      correlationId: cid,
    });
    return { ...res, releasesToImporterAtomic: onchain.remainingEscrow.toString() };
  }

  async prepareOpenDispute(
    user: AuthUser,
    order: Order,
    role: 'BUYER' | 'IMPORTER',
    disputeId: string,
    reasonHashHex: string,
  ) {
    const signer = role === 'BUYER' ? order.buyerWallet : order.importerWallet;
    return this.store(
      order,
      user,
      role,
      signer,
      { fn: 'open_dispute', orderIdHex: order.onchainOrderId, caller: signer, reasonHashHex },
      { disputeId },
    );
  }

  async prepareResolution(
    user: AuthUser,
    order: Order,
    disputeId: string,
    refund: bigint,
    release: bigint,
    resolutionHashHex: string,
  ) {
    const onchain = await this.chainOrder(order);
    if (!onchain || onchain.status !== 'DISPUTED')
      throw conflict('NOT_DISPUTED', 'La orden no está en disputa on-chain');
    if (refund < 0n || release < 0n || refund + release !== onchain.remainingEscrow)
      throw invalid('INVALID_RESOLUTION', 'El reparto debe sumar EXACTAMENTE el saldo retenido', {
        remainingEscrowAtomic: onchain.remainingEscrow.toString(),
      });
    return this.store(
      order,
      user,
      'ARBITER',
      order.arbiterWallet,
      {
        fn: 'resolve_dispute',
        orderIdHex: order.onchainOrderId,
        refundToBuyer: refund,
        releaseToImporter: release,
        resolutionHashHex,
      },
      { disputeId },
    );
  }

  // ------------------------------------------------------------------------
  // submit: recibe la tx FIRMADA (nunca claves), verifica que sea la preparada y la envía.
  // ------------------------------------------------------------------------
  async submit(
    user: AuthUser,
    orderId: string,
    preparedId: string,
    signedXdr: string,
    cid?: string,
  ) {
    const { order } = await this.access.load(user, orderId);
    const p = await this.prisma.preparedTransaction.findUnique({ where: { id: preparedId } });
    if (!p || p.orderId !== order.id) throw notFound('Transacción preparada');
    if (p.signerUserId !== user.id)
      throw forbidden('Esta transacción fue preparada para otro firmante');
    if (p.status === 'CONFIRMED') return this.submitResponse(p.id);
    if (p.status !== 'PREPARED')
      throw conflict('PREPARED_NOT_SUBMITTABLE', `Estado ${p.status}; prepara una nueva`);
    if (p.expiresAt < new Date()) {
      await this.prisma.preparedTransaction.update({
        where: { id: p.id },
        data: { status: 'EXPIRED' },
      });
      throw conflict('PREPARED_EXPIRED', 'La transacción preparada venció; prepara una nueva');
    }
    // Bloqueo optimista: un solo submit concurrente por preparación.
    const lock = await this.prisma.preparedTransaction.updateMany({
      where: { id: p.id, status: 'PREPARED' },
      data: { status: 'SUBMITTED', submittedAt: new Date() },
    });
    if (lock.count !== 1) throw conflict('SUBMIT_IN_PROGRESS', 'Envío en curso');

    let result;
    try {
      result = await this.gateway.submit(signedXdr, p.txHash);
    } catch (e) {
      await this.prisma.preparedTransaction.update({
        where: { id: p.id },
        data: { status: 'PREPARED', submittedAt: null },
      });
      this.gatewayError(e);
    }
    if (result.status === 'SUCCESS') {
      await this.prisma.preparedTransaction.update({
        where: { id: p.id },
        data: { status: 'CONFIRMED', confirmedAt: new Date(), ledger: result.ledger },
      });
      await this.syncFromChain(order.id, 'submit', {
        txHash: result.txHash,
        action: p.action,
        ledger: result.ledger,
      });
    } else if (result.status === 'FAILED') {
      await this.prisma.preparedTransaction.update({
        where: { id: p.id },
        data: { status: 'FAILED', error: result.error?.slice(0, 500) },
      });
      if (p.action === 'create_and_fund')
        await this.setPayment(order, 'FAILED', user.id, `funding failed: ${result.error}`);
    }
    // PENDING: queda SUBMITTED; la conciliación lo resolverá sin reenviar.
    await this.audit.record({
      actorId: user.id,
      action: `escrow.submitted.${p.action}`,
      resourceType: 'Order',
      resourceId: order.id,
      after: { txHash: result.txHash, status: result.status, error: result.error },
      correlationId: cid,
    });
    return this.submitResponse(p.id, result.error);
  }

  private async submitResponse(preparedId: string, error?: string) {
    const p = await this.prisma.preparedTransaction.findUniqueOrThrow({
      where: { id: preparedId },
      include: { order: true },
    });
    return toJson({
      preparedId: p.id,
      action: p.action,
      status: p.status,
      txHash: p.txHash,
      ledger: p.ledger,
      explorerUrl: this.gateway.explorerTxUrl(p.txHash),
      error: error ?? p.error,
      order: {
        paymentState: p.order.paymentState,
        onchainStatus: p.order.onchainStatus,
        remainingEscrowAtomic: p.order.remainingEscrowAtomic,
      },
    });
  }

  // ------------------------------------------------------------------------
  // Proyección desde la cadena (única ruta que deriva estados monetarios).
  // ------------------------------------------------------------------------
  private termsMatch(o: Order, c: OnChainOrder): string[] {
    const diffs: string[] = [];
    const cmp = (k: string, a: unknown, b: unknown) => a !== b && diffs.push(k);
    cmp('buyer', c.buyer, o.buyerWallet);
    cmp('importer', c.importer, o.importerWallet);
    cmp('arbiter', c.arbiter, o.arbiterWallet);
    cmp('asset', c.asset, o.tokenContractId);
    cmp('amount', c.amountTotal, o.amountAtomic);
    cmp('advance', c.advanceAmount, o.advanceAmountAtomic);
    cmp('mode', c.mode, o.escrowMode);
    cmp('termsHash', c.termsHashHex, o.termsHash);
    return diffs;
  }

  async recordTx(
    orderId: string,
    txHash: string,
    eventType: string,
    amount: bigint | null,
    ledger: number | undefined,
    source: string,
    network: string,
  ) {
    await this.prisma.escrowTransaction.createMany({
      data: [
        {
          orderId,
          txHash,
          eventType,
          amountAtomic: amount,
          ledger,
          network,
          status: 'CONFIRMED',
          confirmationAt: new Date(),
          uniqueEventKey: `${txHash}:${eventType}`,
          source,
        },
      ],
      skipDuplicates: true, // exactamente-una-vez lógico por (tx, evento)
    });
  }

  async syncFromChain(
    orderId: string,
    source: string,
    ctx?: { txHash: string; action: string; ledger?: number },
    attempt = 0,
  ): Promise<Order> {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const c = await this.gateway.getOrder(order.onchainOrderId);
    if (!c) return order;
    const diffs = this.termsMatch(order, c);
    if (diffs.length) {
      // Alguien financió con términos distintos: NUNCA marcar FUNDED.
      this.log.error(JSON.stringify({ msg: 'onchain_terms_mismatch', orderId, diffs }));
      if (order.paymentState !== 'FAILED')
        await this.setPayment(order, 'FAILED', null, `onchain terms mismatch: ${diffs.join(',')}`);
      return this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    }
    if (ctx) {
      const amounts: Record<string, bigint | null> = {
        escrow_created: c.amountTotal,
        funded: c.amountTotal,
        advance_released: c.advanceReleased,
        delivery_confirmed: null,
        dispute_opened: null,
        dispute_resolved: null,
      };
      for (const ev of EVENTS_BY_ACTION[ctx.action] ?? [])
        await this.recordTx(
          order.id,
          ctx.txHash,
          ev,
          amounts[ev] ?? null,
          ctx.ledger,
          source,
          order.network,
        );
    }

    let payment: PaymentState = order.paymentState;
    if (!['ESCROW_FUNDED', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(payment))
      payment = 'ESCROW_FUNDED';
    if (c.buyerRefunded > 0n)
      payment = c.buyerRefunded === c.amountTotal ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

    const data: Prisma.OrderUpdateInput = {
      onchainStatus: c.status,
      advanceReleasedAtomic: c.advanceReleased,
      sellerReleasedAtomic: c.sellerReleased,
      buyerRefundedAtomic: c.buyerRefunded,
      remainingEscrowAtomic: c.remainingEscrow,
      lastSyncedAt: new Date(),
      lastSyncedLedger: ctx?.ledger ?? order.lastSyncedLedger,
      paymentState: payment,
      paidAt: order.paidAt ?? new Date(c.fundedAt * 1000),
    };
    const events: { kind: string; from: string; to: string; note?: string }[] = [];
    if (payment !== order.paymentState)
      events.push({ kind: 'payment', from: order.paymentState, to: payment });
    if (c.status !== order.onchainStatus)
      events.push({ kind: 'onchain', from: order.onchainStatus, to: c.status });
    if (c.status === 'SETTLED' && !c.resolutionHashHex && order.logisticState !== 'ACCEPTED') {
      data.logisticState = 'ACCEPTED';
      events.push({
        kind: 'logistic',
        from: order.logisticState,
        to: 'ACCEPTED',
        note: 'delivery confirmed on-chain',
      });
    }
    let disputeUpdate: Prisma.DisputeUpdateManyMutationInput | null = null;
    if (c.status === 'DISPUTED' && order.disputeState === 'NONE') {
      data.disputeState = 'OPEN';
      events.push({ kind: 'dispute', from: 'NONE', to: 'OPEN' });
      disputeUpdate = { onchainConfirmedAt: new Date() };
    }
    if (c.status === 'SETTLED' && c.resolutionHashHex && order.disputeState !== 'RESOLVED') {
      data.disputeState = 'RESOLVED';
      events.push({ kind: 'dispute', from: order.disputeState, to: 'RESOLVED' });
      disputeUpdate = { status: 'RESOLVED', resolvedAt: new Date() };
    }

    return this.prisma
      .$transaction(async (tx) => {
        // update condicional por updatedAt: evita que dos sincronizaciones concurrentes dupliquen eventos
        const res = await tx.order.updateMany({
          where: { id: order.id, updatedAt: order.updatedAt },
          data: data as Prisma.OrderUpdateManyMutationInput,
        });
        if (res.count === 1) {
          for (const e of events)
            await tx.orderEvent.create({
              data: { orderId: order.id, ...e, note: e.note ?? `source=${source}` },
            });
          if (disputeUpdate) {
            const where =
              disputeUpdate.status === 'RESOLVED'
                ? {
                    orderId: order.id,
                    status: { in: ['OPEN', 'UNDER_REVIEW'] as ('OPEN' | 'UNDER_REVIEW')[] },
                    resolutionHash: c.resolutionHashHex,
                  }
                : {
                    orderId: order.id,
                    reasonHash: c.disputeReasonHashHex ?? '',
                    onchainConfirmedAt: null,
                  };
            await tx.dispute.updateMany({ where, data: disputeUpdate });
          }
        }
        return res.count === 1 ? tx.order.findUniqueOrThrow({ where: { id: order.id } }) : null;
      })
      .then((o) =>
        o
          ? o
          : attempt < 3
            ? this.syncFromChain(orderId, source, undefined, attempt + 1)
            : this.prisma.order.findUniqueOrThrow({ where: { id: orderId } }),
      );
  }

  /**
   * Transacciones SUBMITTED sin resultado (timeout del RPC): se resuelven consultando su hash en la red.
   * Nunca se reenvían ni se re-firman.
   */
  async resolveSubmitted() {
    const rows = await this.prisma.preparedTransaction.findMany({
      where: { status: 'SUBMITTED' },
      take: 100,
    });
    let resolved = 0;
    for (const p of rows) {
      const st = await this.gateway
        .getTransactionStatus(p.txHash)
        .catch(() => ({ status: 'NOT_FOUND' as const, ledger: undefined }));
      if (st.status === 'SUCCESS') {
        await this.prisma.preparedTransaction.update({
          where: { id: p.id },
          data: { status: 'CONFIRMED', confirmedAt: new Date(), ledger: st.ledger },
        });
        await this.syncFromChain(p.orderId, 'reconciliation', {
          txHash: p.txHash,
          action: p.action,
          ledger: st.ledger,
        });
        resolved++;
      } else if (
        st.status === 'FAILED' ||
        (st.status === 'NOT_FOUND' && p.expiresAt < new Date(Date.now() - 60_000))
      ) {
        // vencida por time bounds y nunca vista en la red: ya no puede entrar
        await this.prisma.preparedTransaction.update({
          where: { id: p.id },
          data: {
            status: 'FAILED',
            error:
              st.status === 'FAILED' ? 'fallida on-chain' : 'no llegó a la red antes de vencer',
          },
        });
        if (p.action === 'create_and_fund') {
          const order = await this.prisma.order.findUniqueOrThrow({ where: { id: p.orderId } });
          if (order.paymentState === 'ESCROW_PENDING')
            await this.setPayment(order, 'FAILED', null, 'funding tx not applied');
        }
        resolved++;
      }
    }
    return { checked: rows.length, resolved };
  }

  private async setPayment(order: Order, to: PaymentState, actorId: string | null, note: string) {
    if (order.paymentState === to) return;
    await this.prisma.order.update({ where: { id: order.id }, data: { paymentState: to } });
    await this.prisma.orderEvent.create({
      data: { orderId: order.id, kind: 'payment', from: order.paymentState, to, actorId, note },
    });
  }

  async view(user: AuthUser, orderId: string) {
    const { order } = await this.access.load(user, orderId);
    const onchain = await this.chainOrder(order);
    const txs = await this.prisma.escrowTransaction.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
    });
    const pending = await this.prisma.preparedTransaction.findMany({
      where: { orderId: order.id, status: { in: ['PREPARED', 'SUBMITTED'] } },
      select: {
        id: true,
        action: true,
        status: true,
        txHash: true,
        expiresAt: true,
        signerRole: true,
      },
    });
    const dec = (v: bigint) => atomicToDecimal(v, 7);
    return toJson({
      orderId: order.id,
      network: order.network,
      contractId: order.escrowContractId,
      simulated: order.simulated,
      onchain: onchain
        ? {
            ...onchain,
            display: {
              total: dec(onchain.amountTotal),
              advanceReleased: dec(onchain.advanceReleased),
              remaining: dec(onchain.remainingEscrow),
            },
          }
        : null,
      projection: {
        paymentState: order.paymentState,
        onchainStatus: order.onchainStatus,
        remainingEscrowAtomic: order.remainingEscrowAtomic,
        lastSyncedAt: order.lastSyncedAt,
      },
      protection: {
        // Mensaje honesto: lo ya liberado (anticipo) no está en escrow.
        retainedInContractAtomic: onchain?.remainingEscrow ?? 0n,
        alreadyReleasedToImporterAtomic: onchain?.sellerReleased ?? 0n,
        note:
          onchain && onchain.advanceReleased > 0n
            ? `El anticipo de ${dec(onchain.advanceReleased)} ya fue pagado a la importadora y NO está en el contrato; solo ${dec(onchain.remainingEscrow)} sigue protegido.`
            : undefined,
      },
      transactions: txs.map((t) => ({ ...t, explorerUrl: this.gateway.explorerTxUrl(t.txHash) })),
      pendingPrepared: pending,
    });
  }

  /** Para hashes de texto privado que van on-chain (razón/resolución). */
  static privateTextHash(kind: string, id: string, text: string) {
    return sha256(`import-escrow/${kind}/v1:${id}\n${text}`);
  }
}
