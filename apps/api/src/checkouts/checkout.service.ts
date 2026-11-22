import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Quote } from '@prisma/client';
import {
  atomicToDecimal,
  bpsOf,
  disclosureFor,
  disclosureHash,
  onchainOrderId,
  renderDisclosure,
} from '@montuno/shared';
import { randomUUID } from 'crypto';
import { ENV, Env } from '../config/env';
import type { AuthUser } from '../common/auth/auth.types';
import { AuditService } from '../common/audit.service';
import { sha256 } from '../common/crypto';
import { conflict, DomainError, forbidden, invalid, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { toJson } from '../common/serialize';
import { QuotesService } from '../quotes/quotes.service';
import { ESCROW_GATEWAY, StellarEscrowGateway } from '../stellar/escrow-gateway';

export interface AcceptInput {
  termsHash: string;
  buyerWallet: string;
  acceptTerms: boolean;
  disclosureVersion: string;
  disclosureHash: string;
}

@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
    @Inject(ESCROW_GATEWAY) private readonly gateway: StellarEscrowGateway,
  ) {}

  private async linkByToken(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw notFound('Checkout');
    const link = await this.prisma.checkoutLink.findUnique({
      where: { opaqueTokenHash: sha256(token) },
      include: { quote: { include: { importer: true, order: true } } },
    });
    if (!link || link.revokedAt) throw notFound('Checkout');
    return link;
  }

  disclosure(q: Quote) {
    const d = disclosureFor(q.escrowMode);
    const fmt = (v: bigint) => `${atomicToDecimal(v, q.tokenDecimals)} USDC (prueba)`;
    const text = renderDisclosure(d, {
      advance: fmt(q.advanceAmountAtomic),
      advancePct: `${(bpsOf(q.advanceAmountAtomic, q.amountAtomic) / 100).toFixed(2)}%`,
      protected: fmt(q.amountAtomic - q.advanceAmountAtomic),
    });
    return { version: d.version, text, hash: disclosureHash(text, d.version) };
  }

  /** Vista pública SANITIZADA: sin wallets, teléfonos, emails ni evidencias. */
  async view(token: string) {
    const link = await this.linkByToken(token);
    const q = link.quote;
    const expired = link.expiresAt < new Date() || q.status === 'EXPIRED';
    const status = expired && q.status !== 'ACCEPTED' ? 'EXPIRED' : q.status;
    return toJson({
      status,
      redeemed: !!link.redeemedAt,
      importer: { publicName: q.importer.publicName, verified: q.importer.status === 'VERIFIED' },
      product: {
        name: q.productName,
        variant: q.productVariant,
        url: q.productUrl,
        quantity: q.quantity,
      },
      destinationCity: q.destinationCity,
      deliveryEstimateDays: q.deliveryEstimateDays,
      purchaseTerms: q.purchaseTerms,
      price: {
        fiat: { amount: q.fiatPrice.toFixed(2), currency: q.fiatCurrency },
        fx: q.fxRate
          ? {
              rate: q.fxRate.toString(),
              spreadBps: q.fxSpreadBps,
              source: q.fxSource,
              expiresAt: q.fxQuoteExpiresAt,
            }
          : null,
        token: {
          amountAtomic: q.amountAtomic,
          display: atomicToDecimal(q.amountAtomic, q.tokenDecimals),
          decimals: q.tokenDecimals,
          symbol: 'USDC (Testnet)',
        },
        fees: {
          serviceFeeAtomic: q.serviceFeeAtomic,
          rampFeeAtomic: q.rampFeeAtomic,
          includedInTotal: true,
        },
      },
      escrow: {
        mode: q.escrowMode,
        advanceAmountAtomic: q.advanceAmountAtomic,
        advanceBps: bpsOf(q.advanceAmountAtomic, q.amountAtomic),
        protectedAmountAtomic: q.amountAtomic - q.advanceAmountAtomic,
        fulfillmentDeadline: q.fulfillmentDeadline,
        network: this.env.STELLAR_NETWORK,
        simulated: this.gateway.kind === 'simulated',
      },
      riskDisclosure: this.disclosure(q),
      termsHash: q.termsHash,
      expiresAt: link.expiresAt,
    });
  }

  async accept(
    user: AuthUser,
    token: string,
    input: AcceptInput,
    meta: { ip?: string; userAgent?: string; cid?: string },
  ) {
    const link = await this.linkByToken(token);
    const q = link.quote;
    if (q.order) {
      if (q.order.buyerId === user.id) return { orderId: q.order.id, alreadyAccepted: true };
      throw conflict('CHECKOUT_ALREADY_USED', 'Esta cotización ya fue aceptada');
    }
    if (link.redeemedAt) throw conflict('CHECKOUT_ALREADY_USED', 'Enlace ya utilizado');
    if (q.status !== 'SENT')
      throw conflict('QUOTE_NOT_AVAILABLE', `Cotización en estado ${q.status}`);
    const now = new Date();
    if (link.expiresAt <= now || QuotesService.fundingDeadline(q) <= now)
      throw new DomainError('QUOTE_EXPIRED', 'Cotización vencida: pide una nueva', HttpStatus.GONE);
    if (!input.acceptTerms) throw invalid('CONSENT_REQUIRED', 'Debes aceptar los términos');
    if (input.termsHash !== q.termsHash)
      throw conflict(
        'TERMS_CHANGED',
        'Los términos aceptados no coinciden con la cotización vigente',
      );
    const d = this.disclosure(q);
    if (input.disclosureVersion !== d.version || input.disclosureHash !== d.hash)
      throw invalid('DISCLOSURE_MISMATCH', 'Debes aceptar la versión vigente del aviso de riesgo');
    if (user.memberships.some((m) => m.importerId === q.importerId))
      throw forbidden('La importadora no puede comprar su propia cotización');
    if (!user.verifiedWallets.includes(input.buyerWallet))
      throw invalid('WALLET_UNVERIFIED', 'La wallet del comprador debe tener prueba de posesión');
    const importer = await this.prisma.importer.findUniqueOrThrow({
      where: { id: q.importerId },
      include: { wallet: true },
    });
    if (importer.status !== 'VERIFIED' || !importer.wallet)
      throw conflict('IMPORTER_UNAVAILABLE', 'La importadora no está habilitada');
    if (
      input.buyerWallet === importer.wallet.address ||
      input.buyerWallet === this.gateway.arbiterAddress
    )
      throw invalid('INVALID_PARTICIPANTS', 'Wallet del comprador inválida para esta orden');

    const orderId = randomUUID();
    const order = await this.prisma.$transaction(async (tx) => {
      const redeemed = await tx.checkoutLink.updateMany({
        where: { id: link.id, redeemedAt: null, revokedAt: null },
        data: { redeemedAt: now },
      });
      if (redeemed.count !== 1) throw conflict('CHECKOUT_ALREADY_USED', 'Enlace ya utilizado');
      const qs = await tx.quote.updateMany({
        where: { id: q.id, status: 'SENT' },
        data: { status: 'ACCEPTED' },
      });
      if (qs.count !== 1) throw conflict('QUOTE_NOT_AVAILABLE', 'Cotización no disponible');
      const o = await tx.order.create({
        data: {
          id: orderId,
          quoteId: q.id,
          buyerId: user.id,
          importerId: q.importerId,
          buyerWallet: input.buyerWallet,
          importerWallet: importer.wallet!.address,
          arbiterWallet: this.gateway.arbiterAddress,
          network: this.env.STELLAR_NETWORK,
          escrowContractId: this.gateway.contractId,
          tokenContractId: q.tokenContractId,
          onchainOrderId: onchainOrderId(orderId),
          termsHash: q.termsHash!,
          escrowMode: q.escrowMode,
          amountAtomic: q.amountAtomic,
          advanceAmountAtomic: q.advanceAmountAtomic,
          fundingDeadline: QuotesService.fundingDeadline(q),
          fulfillmentDeadline: q.fulfillmentDeadline,
          simulated: this.gateway.kind === 'simulated',
        },
      });
      // Evidencia auditable de aceptación del riesgo (texto exacto + hash + timestamp).
      await tx.consentRecord.create({
        data: {
          orderId: o.id,
          userId: user.id,
          termsHash: q.termsHash!,
          disclosureVersion: d.version,
          disclosureText: d.text,
          disclosureHash: d.hash,
          advanceAmountAtomic: q.advanceAmountAtomic,
          protectedAmountAtomic: q.amountAtomic - q.advanceAmountAtomic,
          ipHash: meta.ip ? sha256(`${this.env.SESSION_SECRET}:${meta.ip}`) : null,
          userAgent: meta.userAgent?.slice(0, 300),
        },
      });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'checkout.accepted',
          resourceType: 'Order',
          resourceId: o.id,
          after: { quoteId: q.id, termsHash: q.termsHash, disclosureHash: d.hash },
          correlationId: meta.cid,
        },
        tx,
      );
      return o;
    });
    return {
      orderId: order.id,
      alreadyAccepted: false,
      onchainOrderId: order.onchainOrderId,
      paymentState: order.paymentState,
    };
  }
}
