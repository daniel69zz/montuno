import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Order, PaymentState, Prisma } from '@prisma/client';
import { Keypair, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import { atomicToDecimal, decimalToAtomic } from '@montuno/shared';
import { ENV, Env } from '../config/env';
import type { AuthUser } from '../common/auth/auth.types';
import { conflict, DomainError, forbidden, invalid, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { toJson } from '../common/serialize';
import {
  TrustlessWorkClient,
  TrustlessWorkError,
  TwEscrow,
  TwUnsigned,
} from './trustless-work.client';
import { TrustlessWorkConfig } from './trustless-work.config';

type TwAction = 'tw_deploy' | 'tw_fund' | 'tw_approve' | 'tw_release' | 'tw_dispute' | 'tw_resolve';
const DECIMALS = 7;

/** Monto atómico -> número legible exacto (TW usa números). Rechaza cualquier pérdida de precisión. */
export function atomicToTwNumber(v: bigint): number {
  const n = Number(atomicToDecimal(v, DECIMALS));
  if (decimalToAtomic(n.toFixed(DECIMALS), DECIMALS) !== v)
    throw new Error('El monto no se puede representar exactamente');
  return n;
}
/** Número o string decimal de TW -> atómico. */
export function twToAtomic(v: number | string | undefined | null): bigint {
  if (v === undefined || v === null || v === '') return 0n;
  const s = typeof v === 'number' ? v.toFixed(DECIMALS) : v;
  const [i, f = ''] = s.split('.');
  return decimalToAtomic(
    `${i}${f ? '.' + f.slice(0, DECIMALS).replace(/0+$/, '') : ''}`.replace(/\.$/, ''),
    DECIMALS,
  );
}

/**
 * Motor de escrow Trustless Work (beta) para órdenes FULL_ESCROW.
 * Igual que con el contrato propio: el servidor prepara la tx (aquí la arma la API de TW), la wallet firma en el
 * cliente, el servidor verifica que la firma corresponde EXACTAMENTE a lo preparado y la envía; el estado del
 * dinero se deriva SIEMPRE de leer el escrow (GET), nunca de lo que diga el cliente.
 */
@Injectable()
export class TrustlessWorkEscrowService {
  private readonly log = new Logger('TrustlessWork');
  constructor(
    private readonly prisma: PrismaService,
    private readonly tw: TrustlessWorkClient,
    private readonly cfg: TrustlessWorkConfig,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private assertEnabled() {
    if (!this.cfg.enabled)
      throw new DomainError(
        'ENGINE_UNAVAILABLE',
        'Trustless Work no está configurado en este servidor',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
  }

  private twError(e: unknown): never {
    if (e instanceof TrustlessWorkError)
      throw new DomainError(
        e.code,
        e.message,
        e.status >= 500 ? HttpStatus.BAD_GATEWAY : HttpStatus.UNPROCESSABLE_ENTITY,
      );
    throw e;
  }

  private async read(order: Order): Promise<TwEscrow | null> {
    if (!order.twContractId) return null;
    try {
      return await this.tw.getEscrow(order.twContractId);
    } catch (e) {
      if (e instanceof TrustlessWorkError && e.status === 404) return null;
      this.twError(e);
    }
  }

  private async store(
    order: Order,
    user: AuthUser,
    role: 'BUYER' | 'IMPORTER' | 'ARBITER',
    signer: string,
    action: TwAction,
    args: Record<string, unknown>,
    u: TwUnsigned,
    extra: { disputeId?: string } = {},
  ) {
    await this.prisma.preparedTransaction.updateMany({
      where: { orderId: order.id, action, status: 'PREPARED' },
      data: { status: 'EXPIRED' },
    });
    let expiresAt = new Date(Date.now() + 5 * 60_000);
    try {
      const tx = TransactionBuilder.fromXDR(
        u.unsignedXdr,
        this.env.STELLAR_NETWORK_PASSPHRASE,
      ) as Transaction;
      if (tx.timeBounds?.maxTime && Number(tx.timeBounds.maxTime) > 0)
        expiresAt = new Date(Number(tx.timeBounds.maxTime) * 1000);
    } catch {
      throw new DomainError(
        'TW_BAD_XDR',
        'Trustless Work devolvió un XDR que no es de esta red',
        HttpStatus.BAD_GATEWAY,
      );
    }
    const p = await this.prisma.preparedTransaction.create({
      data: {
        orderId: order.id,
        action,
        signerRole: role,
        signerAddress: signer,
        signerUserId: user.id,
        txHash: u.txHash.toLowerCase(),
        unsignedXdr: u.unsignedXdr,
        args: {
          ...args,
          contractId: u.contractId ?? (args.contractId as string | undefined) ?? null,
        } as Prisma.InputJsonValue,
        format: 'stellar-xdr',
        expiresAt,
        disputeId: extra.disputeId,
      },
    });
    return {
      preparedId: p.id,
      engine: 'TRUSTLESS_WORK',
      action,
      format: 'stellar-xdr' as const,
      unsignedXdr: u.unsignedXdr,
      txHash: p.txHash,
      networkPassphrase: this.env.STELLAR_NETWORK_PASSPHRASE,
      expiresAt: expiresAt.toISOString(),
      signer: { role, address: signer },
      fees: { payer: signer, sponsored: false },
      args,
      simulated: false,
      instructions: `Firma con la wallet ${signer}. La transacción la armó Trustless Work; Montuno verifica que lo firmado sea exactamente esto (hash ${p.txHash}).`,
    };
  }

  private roles(order: Order) {
    return {
      approvers: [order.buyerWallet],
      serviceProviders: [order.importerWallet],
      platform: this.cfg.platform,
      releaseSigners: [order.buyerWallet],
      disputeResolvers: [order.arbiterWallet],
      receiver: order.importerWallet,
      admin: this.cfg.admin,
    };
  }

  // ------------------------------------------------------------------------------------------
  async prepareFunding(user: AuthUser, order: Order) {
    this.assertEnabled();
    if (order.escrowMode !== 'FULL_ESCROW')
      throw invalid('ENGINE_MODE_UNSUPPORTED', 'Trustless Work solo admite FULL_ESCROW');
    const deadline = order.fundingDeadline.getTime();
    if (deadline < Date.now() + 60_000) {
      await this.prisma.quote.update({ where: { id: order.quoteId }, data: { status: 'EXPIRED' } });
      throw new DomainError(
        'QUOTE_RECALCULATION_REQUIRED',
        'La cotización venció antes del depósito; la importadora debe emitir una nueva',
        HttpStatus.CONFLICT,
      );
    }
    const amount = atomicToTwNumber(order.amountAtomic);
    let res;
    if (!order.twContractId) {
      const args = {
        signer: order.buyerWallet,
        engagementId: order.onchainOrderId,
        title: `Pedido Montuno ${order.id.slice(0, 8)}`,
        // sin PII: solo el hash canónico de los términos
        description: `termsHash:${order.termsHash}`,
        roles: this.roles(order),
        amount,
        platformFee: 0,
        milestones: [{ description: 'Entrega confirmada por el comprador' }],
        trustline: { contractId: order.tokenContractId },
      };
      try {
        res = await this.store(
          order,
          user,
          'BUYER',
          order.buyerWallet,
          'tw_deploy',
          args,
          await this.tw.deploySingle(args),
        );
      } catch (e) {
        this.twError(e);
      }
      return { ...res, step: 'deploy', stepsRemaining: ['deploy', 'fund'] };
    }
    const escrow = await this.read(order);
    if (escrow && twToAtomic(escrow.balance) >= order.amountAtomic) {
      await this.sync(order.id);
      throw conflict('ALREADY_FUNDED', 'El escrow ya está financiado');
    }
    const args = { contractId: order.twContractId, signer: order.buyerWallet, amount };
    try {
      res = await this.store(
        order,
        user,
        'BUYER',
        order.buyerWallet,
        'tw_fund',
        args,
        await this.tw.fund(args),
      );
    } catch (e) {
      this.twError(e);
    }
    return { ...res, step: 'fund', stepsRemaining: ['fund'] };
  }

  async prepareDelivery(user: AuthUser, order: Order) {
    this.assertEnabled();
    const escrow = await this.read(order);
    if (!escrow || order.onchainStatus === 'NONE')
      throw conflict('ORDER_NOT_FUNDED', 'El escrow no está financiado');
    if (escrow.dispute?.isDisputed && !escrow.dispute.resolved)
      throw conflict('DISPUTE_ACTIVE', 'Disputa activa');
    if (escrow.released) throw conflict('INVALID_STATE', 'Los fondos ya fueron liberados');
    const m = escrow.milestones?.[0];
    const approved = !!m && (m.approvals?.approvalCount ?? 0) >= (m.approvals?.target ?? 1);
    let res;
    try {
      if (!approved) {
        const args = {
          contractId: order.twContractId!,
          approver: order.buyerWallet,
          milestoneIndexes: [0],
        };
        res = await this.store(
          order,
          user,
          'BUYER',
          order.buyerWallet,
          'tw_approve',
          args,
          await this.tw.approveMilestones(args),
        );
        return {
          ...res,
          step: 'approve',
          stepsRemaining: ['approve', 'release'],
          releasesToImporterAtomic: order.amountAtomic.toString(),
        };
      }
      const args = { contractId: order.twContractId!, releaseSigner: order.buyerWallet };
      res = await this.store(
        order,
        user,
        'BUYER',
        order.buyerWallet,
        'tw_release',
        args,
        await this.tw.releaseFunds(args),
      );
    } catch (e) {
      this.twError(e);
    }
    return {
      ...res,
      step: 'release',
      stepsRemaining: ['release'],
      releasesToImporterAtomic: twToAtomic(escrow.balance).toString(),
    };
  }

  async prepareOpenDispute(
    user: AuthUser,
    order: Order,
    role: 'BUYER' | 'IMPORTER',
    disputeId: string,
    reasonHashHex: string,
  ) {
    this.assertEnabled();
    if (!order.twContractId) throw conflict('ORDER_NOT_FUNDED', 'El escrow no está financiado');
    const signer = role === 'BUYER' ? order.buyerWallet : order.importerWallet;
    // La razón es privada: on-chain solo su hash (TW guarda `reason` en la red).
    const args = {
      contractId: order.twContractId,
      signer,
      reason: `montuno-reason-sha256:${reasonHashHex}`,
    };
    try {
      return await this.store(
        order,
        user,
        role,
        signer,
        'tw_dispute',
        args,
        await this.tw.dispute(args),
        { disputeId },
      );
    } catch (e) {
      this.twError(e);
    }
  }

  async prepareResolution(
    user: AuthUser,
    order: Order,
    disputeId: string,
    refund: bigint,
    release: bigint,
  ) {
    this.assertEnabled();
    const escrow = await this.read(order);
    if (!escrow?.dispute?.isDisputed || escrow.dispute.resolved)
      throw conflict('NOT_DISPUTED', 'El escrow no está en disputa');
    const balance = twToAtomic(escrow.balance);
    if (refund < 0n || release < 0n || refund + release !== balance)
      throw invalid('INVALID_RESOLUTION', 'El reparto debe sumar EXACTAMENTE el saldo del escrow', {
        remainingEscrowAtomic: balance.toString(),
      });
    const distributions = [
      ...(refund > 0n ? [{ address: order.buyerWallet, amount: atomicToTwNumber(refund) }] : []),
      ...(release > 0n
        ? [{ address: order.importerWallet, amount: atomicToTwNumber(release) }]
        : []),
    ];
    const args = {
      contractId: order.twContractId!,
      disputeResolver: order.arbiterWallet,
      distributions,
    };
    try {
      return await this.store(
        order,
        user,
        'ARBITER',
        order.arbiterWallet,
        'tw_resolve',
        args,
        await this.tw.resolveDispute(args),
        { disputeId },
      );
    } catch (e) {
      this.twError(e);
    }
  }

  /** Verifica la firma contra lo preparado y envía vía Trustless Work. Devuelve el resultado para EscrowService. */
  async submit(preparedId: string, signedXdr: string) {
    const p = await this.prisma.preparedTransaction.findUniqueOrThrow({
      where: { id: preparedId },
    });
    let tx: Transaction;
    try {
      tx = TransactionBuilder.fromXDR(
        signedXdr,
        this.env.STELLAR_NETWORK_PASSPHRASE,
      ) as Transaction;
    } catch {
      throw new DomainError('INVALID_ENVELOPE', 'XDR inválido', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const hash = Buffer.from(tx.hash()).toString('hex');
    if (hash !== p.txHash)
      throw new DomainError(
        'TX_MISMATCH',
        'La transacción firmada no corresponde a la preparada',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    const kp = Keypair.fromPublicKey(p.signerAddress);
    if (
      !tx.signatures.some((s) => {
        try {
          return kp.verify(tx.hash(), s.signature);
        } catch {
          return false;
        }
      })
    )
      throw new DomainError(
        'MISSING_SIGNATURE',
        'Falta la firma de la cuenta esperada',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    let sent;
    try {
      sent = await this.tw.sendTransaction(signedXdr);
    } catch (e) {
      if (e instanceof TrustlessWorkError && e.status >= 500)
        return { status: 'PENDING' as const, txHash: hash };
      return { status: 'FAILED' as const, txHash: hash, error: (e as Error).message.slice(0, 300) };
    }
    if (p.action === 'tw_deploy') {
      const contractId =
        sent.contractId ?? ((p.args as Record<string, unknown>).contractId as string | null);
      if (!contractId)
        return {
          status: 'FAILED' as const,
          txHash: hash,
          error: 'Trustless Work no informó el contractId del escrow desplegado',
        };
      await this.prisma.order.update({
        where: { id: p.orderId },
        data: { twContractId: contractId },
      });
    }
    return {
      status: 'SUCCESS' as const,
      txHash: (sent.txHash ?? hash).toLowerCase(),
      ledger: sent.ledger,
    };
  }

  /** Proyección desde el escrow de TW (fuente de verdad). Verifica roles, monto y token antes de marcar FUNDED. */
  async sync(orderId: string): Promise<Order> {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const e = await this.read(order);
    if (!e) return order;
    const diffs: string[] = [];
    const r = e.roles ?? {};
    if (r.receiver && r.receiver !== order.importerWallet) diffs.push('receiver');
    if (r.approvers && !r.approvers.includes(order.buyerWallet)) diffs.push('approvers');
    if (r.releaseSigners && !r.releaseSigners.includes(order.buyerWallet))
      diffs.push('releaseSigners');
    if (r.disputeResolvers && !r.disputeResolvers.includes(order.arbiterWallet))
      diffs.push('disputeResolvers');
    if (twToAtomic(e.amount) !== order.amountAtomic) diffs.push('amount');
    if (e.trustline?.contractId && e.trustline.contractId !== order.tokenContractId)
      diffs.push('token');
    if (diffs.length) {
      this.log.error(JSON.stringify({ msg: 'tw_escrow_mismatch', orderId, diffs }));
      if (order.paymentState !== 'FAILED')
        await this.setPayment(order, 'FAILED', `trustless work mismatch: ${diffs.join(',')}`);
      return this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    }
    const balance = twToAtomic(e.balance);
    const disputed = !!e.dispute?.isDisputed && !e.dispute?.resolved;
    const resolved = !!e.dispute?.resolved;
    const data: Prisma.OrderUpdateInput = { lastSyncedAt: new Date() };
    const events: { kind: string; from: string; to: string }[] = [];
    let payment: PaymentState = order.paymentState;
    let onchain = order.onchainStatus;

    if (e.released) {
      onchain = 'SETTLED';
      data.sellerReleasedAtomic = order.amountAtomic;
      data.remainingEscrowAtomic = 0n;
      if (order.logisticState !== 'ACCEPTED') {
        data.logisticState = 'ACCEPTED';
        events.push({ kind: 'logistic', from: order.logisticState, to: 'ACCEPTED' });
      }
      if (!['ESCROW_FUNDED', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(payment))
        payment = 'ESCROW_FUNDED';
    } else if (resolved) {
      onchain = 'SETTLED';
      const d = await this.prisma.dispute.findFirst({
        where: { orderId, resolutionHash: { not: null } },
        orderBy: { createdAt: 'desc' },
      });
      const refund = d?.refundToBuyerAtomic ?? 0n;
      data.buyerRefundedAtomic = refund;
      data.sellerReleasedAtomic = d?.releaseToImporterAtomic ?? 0n;
      data.remainingEscrowAtomic = 0n;
      payment =
        refund === order.amountAtomic
          ? 'REFUNDED'
          : refund > 0n
            ? 'PARTIALLY_REFUNDED'
            : 'ESCROW_FUNDED';
      if (order.disputeState !== 'RESOLVED') {
        data.disputeState = 'RESOLVED';
        events.push({ kind: 'dispute', from: order.disputeState, to: 'RESOLVED' });
        await this.prisma.dispute.updateMany({
          where: { orderId, status: { in: ['OPEN', 'UNDER_REVIEW'] } },
          data: { status: 'RESOLVED', resolvedAt: new Date() },
        });
      }
    } else if (balance >= order.amountAtomic) {
      onchain = disputed ? 'DISPUTED' : 'FUNDED';
      data.remainingEscrowAtomic = balance;
      if (!['ESCROW_FUNDED', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(payment)) {
        payment = 'ESCROW_FUNDED';
        data.paidAt = order.paidAt ?? new Date();
      }
      if (disputed && order.disputeState === 'NONE') {
        data.disputeState = 'OPEN';
        events.push({ kind: 'dispute', from: 'NONE', to: 'OPEN' });
        await this.prisma.dispute.updateMany({
          where: { orderId, onchainConfirmedAt: null },
          data: { onchainConfirmedAt: new Date() },
        });
      }
    } else {
      data.remainingEscrowAtomic = balance; // desplegado pero aún sin el 100%
    }
    data.onchainStatus = onchain;
    data.paymentState = payment;
    if (payment !== order.paymentState)
      events.push({ kind: 'payment', from: order.paymentState, to: payment });
    if (onchain !== order.onchainStatus)
      events.push({ kind: 'onchain', from: order.onchainStatus, to: onchain });
    return this.prisma.$transaction(async (tx) => {
      const u = await tx.order.updateMany({
        where: { id: orderId, updatedAt: order.updatedAt },
        data: data as Prisma.OrderUpdateManyMutationInput,
      });
      if (u.count === 1)
        for (const ev of events)
          await tx.orderEvent.create({ data: { orderId, ...ev, note: 'source=trustless-work' } });
      return tx.order.findUniqueOrThrow({ where: { id: orderId } });
    });
  }

  private async setPayment(order: Order, to: PaymentState, note: string) {
    await this.prisma.order.update({ where: { id: order.id }, data: { paymentState: to } });
    await this.prisma.orderEvent.create({
      data: { orderId: order.id, kind: 'payment', from: order.paymentState, to, note },
    });
  }

  async view(order: Order) {
    const e = await this.read(order);
    return toJson({
      engine: 'TRUSTLESS_WORK',
      contractId: order.twContractId,
      escrow: e,
      explorerUrl: order.twContractId
        ? `${this.env.STELLAR_EXPLORER_BASE_URL}/contract/${order.twContractId}`
        : null,
    });
  }

  assertOrder(order: Order | null): asserts order is Order {
    if (!order) throw notFound('Orden');
  }
  forbidAdvance(): never {
    throw invalid(
      'ADVANCE_NOT_ALLOWED',
      'Con Trustless Work la orden es FULL_ESCROW: no hay anticipo',
    );
  }
  forbid(msg: string): never {
    throw forbidden(msg);
  }
}
