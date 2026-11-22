import { Inject, Injectable } from '@nestjs/common';
import { Order, Prisma } from '@prisma/client';
import { atomicToDecimal } from '@montuno/shared';
import type { AuthUser } from '../common/auth/auth.types';
import { PrismaService } from '../common/prisma.service';
import { toJson } from '../common/serialize';
import { ESCROW_GATEWAY, StellarEscrowGateway } from '../stellar/escrow-gateway';

/** Estado resumido para la futura UI, sin mezclar logística con movimientos de dinero. */
export function summarize(o: Order): { code: string; label: string } {
  if (o.disputeState === 'OPEN' || o.disputeState === 'UNDER_REVIEW')
    return { code: 'IN_DISPUTE', label: 'En disputa: los fondos retenidos están congelados' };
  if (o.onchainStatus === 'CANCELLED')
    return { code: 'CANCELLED', label: 'Cancelado; saldo retenido devuelto' };
  if (o.onchainStatus === 'SETTLED')
    return o.disputeState === 'RESOLVED'
      ? { code: 'RESOLVED', label: 'Disputa resuelta por el árbitro' }
      : { code: 'COMPLETED', label: 'Entrega confirmada y pago liberado' };
  if (o.paymentState === 'ESCROW_FUNDED') {
    if (o.logisticState === 'NOT_PURCHASED')
      return {
        code:
          o.onchainStatus === 'ADVANCE_PAID'
            ? 'ADVANCE_PAID_AWAITING_PURCHASE'
            : 'FUNDED_AWAITING_PURCHASE',
        label: 'Pago protegido; la importadora debe comprar',
      };
    return { code: `LOGISTICS_${o.logisticState}`, label: 'Pago protegido; pedido en curso' };
  }
  if (o.paymentState === 'ESCROW_PENDING')
    return {
      code: 'AWAITING_ESCROW_FUNDING',
      label: 'Falta financiar el contrato (firma del comprador)',
    };
  if (o.paymentState === 'WALLET_FUNDED')
    return {
      code: 'WALLET_FUNDED',
      label: 'Fondos en tu wallet; falta depositarlos en el contrato',
    };
  if (o.paymentState === 'RAMP_PENDING')
    return { code: 'RAMP_PENDING', label: 'Esperando conversión BOB -> USDC' };
  if (o.paymentState === 'FAILED')
    return { code: 'PAYMENT_FAILED', label: 'El pago falló; puedes reintentar' };
  return { code: 'AWAITING_PAYMENT', label: 'Pendiente de pago' };
}

@Injectable()
export class OrdersQueryService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ESCROW_GATEWAY) private readonly gateway: StellarEscrowGateway,
  ) {}

  static readonly include = {
    quote: {
      select: {
        productName: true,
        productVariant: true,
        productUrl: true,
        quantity: true,
        destinationCity: true,
        deliveryEstimateDays: true,
        fiatPrice: true,
        fiatCurrency: true,
      },
    },
    importer: { select: { id: true, publicName: true } },
  } satisfies Prisma.OrderInclude;

  present(
    o: Order & Partial<Prisma.OrderGetPayload<{ include: typeof OrdersQueryService.include }>>,
    opts: { includeWallets?: boolean } = {},
  ) {
    const dec = (v: bigint) => atomicToDecimal(v, 7);
    return toJson({
      id: o.id,
      quoteId: o.quoteId,
      importerId: o.importerId,
      summary: summarize(o),
      engine: o.escrowEngine,
      product: o.quote
        ? {
            name: o.quote.productName,
            variant: o.quote.productVariant,
            url: o.quote.productUrl,
            quantity: o.quote.quantity,
            destinationCity: o.quote.destinationCity,
            deliveryEstimateDays: o.quote.deliveryEstimateDays,
            fiat: { amount: o.quote.fiatPrice.toFixed(2), currency: o.quote.fiatCurrency },
          }
        : undefined,
      provider: o.importer ? { id: o.importer.id, publicName: o.importer.publicName } : undefined,
      states: {
        payment: o.paymentState,
        logistic: o.logisticState,
        dispute: o.disputeState,
        onchain: o.onchainStatus,
      },
      escrow: {
        mode: o.escrowMode,
        network: o.network,
        contractId: o.escrowContractId,
        tokenContractId: o.tokenContractId,
        onchainOrderId: o.onchainOrderId,
        termsHash: o.termsHash,
        simulated: o.simulated,
        amountAtomic: o.amountAtomic,
        advanceAmountAtomic: o.advanceAmountAtomic,
        projection: {
          advanceReleasedAtomic: o.advanceReleasedAtomic,
          sellerReleasedAtomic: o.sellerReleasedAtomic,
          buyerRefundedAtomic: o.buyerRefundedAtomic,
          remainingEscrowAtomic: o.remainingEscrowAtomic,
          lastSyncedAt: o.lastSyncedAt,
          lastSyncedLedger: o.lastSyncedLedger,
        },
        /** Lo máximo que el comprador podría recuperar on-chain HOY (nunca el anticipo ya pagado). */
        maxRecoverableByBuyerAtomic: o.remainingEscrowAtomic,
        display: {
          total: dec(o.amountAtomic),
          advance: dec(o.advanceAmountAtomic),
          remaining: dec(o.remainingEscrowAtomic),
        },
      },
      ...(opts.includeWallets
        ? {
            wallets: { buyer: o.buyerWallet, importer: o.importerWallet, arbiter: o.arbiterWallet },
          }
        : {}),
      fundingDeadline: o.fundingDeadline,
      fulfillmentDeadline: o.fulfillmentDeadline,
      tracking: o.trackingNumber
        ? {
            carrier: o.carrier,
            number: o.trackingNumber,
            note: 'El tracking no es prueba definitiva de entrega',
          }
        : null,
      paidAt: o.paidAt,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    });
  }

  async listForBuyer(user: AuthUser) {
    const rows = await this.prisma.order.findMany({
      where: { buyerId: user.id },
      include: OrdersQueryService.include,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((o) => this.present(o));
  }

  async listForImporter(importerId: string) {
    const rows = await this.prisma.order.findMany({
      where: { importerId },
      include: OrdersQueryService.include,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((o) => this.present(o));
  }

  explorer(txHash: string) {
    return this.gateway.explorerTxUrl(txHash);
  }
}
