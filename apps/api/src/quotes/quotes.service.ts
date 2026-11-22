import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Prisma, Quote } from '@prisma/client';
import {
  bpsOf,
  CanonicalTermsV1,
  computeTermsHash,
  disclosureFor,
  TERMS_SCHEMA_VERSION,
  withinBps,
} from '@montuno/shared';
import { ENV, Env } from '../config/env';
import type { AuthUser } from '../common/auth/auth.types';
import { AuditService } from '../common/audit.service';
import { encryptText, randomToken, sha256 } from '../common/crypto';
import { QR_TOKEN_PURPOSE } from '../catalog/catalog.service';
import { TrustlessWorkConfig } from '../trustless-work/trustless-work.config';
import { conflict, DomainError, forbidden, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { toJson } from '../common/serialize';
import { ESCROW_GATEWAY, StellarEscrowGateway } from '../stellar/escrow-gateway';
import type { CreateQuoteDto, UpdateQuoteDto } from './quotes.dto';
import { assertSafeProductUrl } from './url-policy';

const MIN_FUNDING_WINDOW_MS = 5 * 60 * 1000;

@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
    @Inject(ESCROW_GATEWAY) private readonly gateway: StellarEscrowGateway,
    private readonly tw: TrustlessWorkConfig,
  ) {}

  private importerOf(user: AuthUser) {
    const m = user.memberships[0];
    if (!m) throw forbidden('Requiere pertenecer a una importadora');
    return m.importerId;
  }

  present(q: Quote) {
    return toJson({
      ...q,
      fiatPrice: q.fiatPrice.toString(),
      advanceBps: q.amountAtomic > 0n ? bpsOf(q.advanceAmountAtomic, q.amountAtomic) : 0,
      protectedAmountAtomic: q.amountAtomic - q.advanceAmountAtomic,
    });
  }

  private toData(dto: Partial<CreateQuoteDto>): Prisma.QuoteUncheckedUpdateInput {
    const d: Prisma.QuoteUncheckedUpdateInput = {};
    if (dto.productUrl !== undefined) d.productUrl = assertSafeProductUrl(dto.productUrl);
    for (const k of [
      'productName',
      'productVariant',
      'quantity',
      'destinationCity',
      'deliveryEstimateDays',
      'purchaseTerms',
      'fiatCurrency',
      'escrowMode',
      'escrowEngine',
    ] as const)
      if (dto[k] !== undefined) (d as Record<string, unknown>)[k] = dto[k];
    if (dto.fiatPrice !== undefined) d.fiatPrice = new Prisma.Decimal(dto.fiatPrice);
    if (dto.amountAtomic !== undefined) d.amountAtomic = BigInt(dto.amountAtomic);
    if (dto.serviceFeeAtomic !== undefined) d.serviceFeeAtomic = BigInt(dto.serviceFeeAtomic);
    if (dto.rampFeeAtomic !== undefined) d.rampFeeAtomic = BigInt(dto.rampFeeAtomic);
    if (dto.advanceAmountAtomic !== undefined)
      d.advanceAmountAtomic = BigInt(dto.advanceAmountAtomic);
    if (dto.expiresAt !== undefined) d.expiresAt = new Date(dto.expiresAt);
    if (dto.fulfillmentDeadline !== undefined)
      d.fulfillmentDeadline = new Date(dto.fulfillmentDeadline);
    if (dto.fx !== undefined) {
      d.fxRate = new Prisma.Decimal(dto.fx.rate);
      d.fxSpreadBps = dto.fx.spreadBps;
      d.fxSource = dto.fx.source;
      d.fxQuoteExpiresAt = new Date(dto.fx.expiresAt);
    }
    if (dto.escrowMode !== undefined)
      d.riskDisclosureVersion = disclosureFor(dto.escrowMode).version;
    return d;
  }

  async create(user: AuthUser, dto: CreateQuoteDto, cid?: string) {
    const importerId = this.importerOf(user);
    if (dto.quoteRequestId) {
      const r = await this.prisma.quoteRequest.findUnique({
        where: { id: dto.quoteRequestId },
        include: { quote: true },
      });
      if (!r || r.importerId !== importerId) throw notFound('Solicitud de cotización');
      if (r.status !== 'OPEN' || r.quote)
        throw conflict('REQUEST_NOT_OPEN', 'La solicitud ya tiene cotización o está cerrada');
    }
    const data = this.toData(dto) as Prisma.QuoteUncheckedCreateInput;
    const q = await this.prisma.quote.create({
      data: {
        ...data,
        importerId,
        createdBy: user.id,
        tokenContractId: this.gateway.tokenContractId,
        tokenDecimals: this.env.STELLAR_TOKEN_DECIMALS,
        advanceAmountAtomic: dto.advanceAmountAtomic ? BigInt(dto.advanceAmountAtomic) : 0n,
        riskDisclosureVersion: disclosureFor(dto.escrowMode).version,
        quoteRequestId: dto.quoteRequestId ?? null,
      },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'quote.created',
      resourceType: 'Quote',
      resourceId: q.id,
      after: q,
      correlationId: cid,
    });
    return this.present(q);
  }

  async getForImporter(user: AuthUser, id: string) {
    const q = await this.prisma.quote.findUnique({ where: { id } });
    if (!q || !user.memberships.some((m) => m.importerId === q.importerId))
      throw notFound('Cotización');
    return q;
  }

  async update(user: AuthUser, id: string, dto: UpdateQuoteDto, cid?: string) {
    const q = await this.getForImporter(user, id);
    if (q.status !== 'DRAFT')
      throw conflict('QUOTE_NOT_DRAFT', 'Solo se editan cotizaciones DRAFT; crea una nueva');
    const { expectedVersion, ...rest } = dto;
    const data = this.toData(rest);
    // control optimista de versión
    const res = await this.prisma.quote.updateMany({
      where: { id, version: expectedVersion, status: 'DRAFT' },
      data: { ...(data as Prisma.QuoteUpdateManyMutationInput), version: { increment: 1 } },
    });
    if (res.count !== 1)
      throw conflict('VERSION_CONFLICT', 'La cotización cambió; recarga y reintenta');
    const updated = await this.prisma.quote.findUniqueOrThrow({ where: { id } });
    await this.audit.record({
      actorId: user.id,
      action: 'quote.updated',
      resourceType: 'Quote',
      resourceId: id,
      before: q,
      after: updated,
      correlationId: cid,
    });
    return this.present(updated);
  }

  /** Deadline de funding = min(vencimiento de la cotización, vencimiento de la cotización FX). */
  static fundingDeadline(q: Pick<Quote, 'expiresAt' | 'fxQuoteExpiresAt'>) {
    return q.fxQuoteExpiresAt && q.fxQuoteExpiresAt < q.expiresAt
      ? q.fxQuoteExpiresAt
      : q.expiresAt;
  }

  canonicalTerms(q: Quote): CanonicalTermsV1 {
    return {
      schema: TERMS_SCHEMA_VERSION,
      quoteId: q.id,
      quoteVersion: q.version,
      importerId: q.importerId,
      product: {
        url: q.productUrl,
        name: q.productName,
        variant: q.productVariant,
        quantity: q.quantity,
      },
      destinationCity: q.destinationCity,
      deliveryEstimateDays: q.deliveryEstimateDays,
      purchaseTerms: q.purchaseTerms,
      fiat: { amount: q.fiatPrice.toFixed(2), currency: q.fiatCurrency },
      fx: {
        rate: q.fxRate?.toString() ?? null,
        spreadBps: q.fxSpreadBps,
        source: q.fxSource,
        expiresAt: q.fxQuoteExpiresAt?.toISOString() ?? null,
      },
      fees: {
        serviceFeeAtomic: q.serviceFeeAtomic.toString(),
        rampFeeAtomic: q.rampFeeAtomic.toString(),
      },
      token: { contractId: q.tokenContractId, decimals: q.tokenDecimals },
      amountTotalAtomic: q.amountAtomic.toString(),
      escrowMode: q.escrowMode,
      advanceAmountAtomic: q.advanceAmountAtomic.toString(),
      fundingDeadline: QuotesService.fundingDeadline(q).toISOString(),
      fulfillmentDeadline: q.fulfillmentDeadline.toISOString(),
      riskDisclosureVersion: q.riskDisclosureVersion,
      ...(q.escrowEngine !== 'MONTUNO' ? { escrowEngine: q.escrowEngine } : {}),
    };
  }

  /** Congela condiciones, calcula termsHash y crea el enlace privado (el token solo se muestra una vez). */
  async publish(user: AuthUser, id: string, cid?: string) {
    const q = await this.getForImporter(user, id);
    if (q.status !== 'DRAFT') throw conflict('QUOTE_NOT_DRAFT', 'La cotización ya fue publicada');
    const importer = await this.prisma.importer.findUniqueOrThrow({
      where: { id: q.importerId },
      include: { wallet: true },
    });
    const now = Date.now();
    const v = (code: string, msg: string) =>
      new DomainError(code, msg, HttpStatus.UNPROCESSABLE_ENTITY);
    if (importer.status !== 'VERIFIED')
      throw v('IMPORTER_NOT_VERIFIED', 'La importadora debe estar VERIFIED (revisión manual)');
    if (!importer.wallet?.verifiedAt)
      throw v('IMPORTER_WALLET_MISSING', 'Configura una wallet de cobro verificada');
    if (q.amountAtomic <= 0n) throw v('INVALID_AMOUNT', 'Monto debe ser > 0');
    if (q.amountAtomic > importer.maxOrderAmountAtomic)
      throw v('ORDER_LIMIT_EXCEEDED', 'Supera el límite de orden de la importadora');
    if (q.serviceFeeAtomic + q.rampFeeAtomic > q.amountAtomic)
      throw v('FEES_EXCEED_TOTAL', 'Las comisiones no pueden superar el total');
    if (!importer.allowedModes.includes(q.escrowMode))
      throw v('MODE_NOT_ALLOWED', `Modo ${q.escrowMode} no habilitado para esta importadora`);
    if (q.escrowMode === 'FULL_ESCROW' && q.advanceAmountAtomic !== 0n)
      throw v('MODE_MISMATCH', 'FULL_ESCROW no admite anticipo');
    if (q.escrowEngine === 'TRUSTLESS_WORK') {
      if (!this.tw.enabled)
        throw v('ENGINE_UNAVAILABLE', 'Trustless Work no está configurado en este servidor');
      if (q.escrowMode !== 'FULL_ESCROW')
        throw v(
          'ENGINE_MODE_UNSUPPORTED',
          'Con Trustless Work solo se admite escrow completo (FULL_ESCROW)',
        );
    }
    if (q.escrowMode === 'PARTIAL_ADVANCE') {
      if (q.advanceAmountAtomic <= 0n || q.advanceAmountAtomic >= q.amountAtomic)
        throw v('INVALID_ADVANCE', 'Anticipo debe ser > 0 y < total');
      if (!withinBps(q.advanceAmountAtomic, q.amountAtomic, importer.maxAdvanceBps))
        throw v(
          'ADVANCE_LIMIT_EXCEEDED',
          `Anticipo supera ${importer.maxAdvanceBps} bps autorizados`,
        );
      if (!withinBps(q.advanceAmountAtomic, q.amountAtomic, this.gateway.maxAdvanceBps))
        throw v('ADVANCE_ABOVE_CONTRACT_CAP', 'Anticipo supera el tope del contrato');
    }
    const deadline = QuotesService.fundingDeadline(q).getTime();
    if (deadline < now + MIN_FUNDING_WINDOW_MS)
      throw v('QUOTE_EXPIRES_TOO_SOON', 'La cotización (o su FX) vence en menos de 5 minutos');
    if (q.fulfillmentDeadline.getTime() <= deadline)
      throw v('INVALID_DEADLINE', 'fulfillmentDeadline debe ser posterior al vencimiento');
    if (q.fiatCurrency === 'BOB' && !q.fxRate)
      throw v(
        'FX_REQUIRED',
        'Cotización en BOB requiere tipo de cambio explícito y su vencimiento',
      );

    const canonical = this.canonicalTerms(q);
    const termsHash = computeTermsHash(canonical);
    const token = randomToken(32);
    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.quote.updateMany({
        where: { id, status: 'DRAFT', version: q.version },
        data: {
          status: 'SENT',
          termsHash,
          canonicalTerms: canonical as unknown as Prisma.InputJsonValue,
          publishedAt: new Date(),
        },
      });
      if (res.count !== 1)
        throw conflict('VERSION_CONFLICT', 'La cotización cambió durante la publicación');
      await tx.checkoutLink.create({
        data: { quoteId: id, opaqueTokenHash: sha256(token), expiresAt: new Date(deadline) },
      });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'quote.published',
          resourceType: 'Quote',
          resourceId: id,
          after: { termsHash },
          correlationId: cid,
        },
        tx,
      );
      return tx.quote.findUniqueOrThrow({ where: { id } });
    });
    if (updated.quoteRequestId) {
      // La solicitud del catálogo pasa a QUOTED y el comprador (y solo él) puede recuperar el enlace.
      await this.prisma.quoteRequest.update({
        where: { id: updated.quoteRequestId },
        data: {
          status: 'QUOTED',
          checkoutTokenEnc: encryptText(this.env.SESSION_SECRET, QR_TOKEN_PURPOSE, token),
        },
      });
    }
    return {
      quote: this.present(updated),
      checkout: {
        token,
        url: `${this.env.PUBLIC_CHECKOUT_BASE_URL}/${token}`,
        expiresAt: new Date(deadline).toISOString(),
        note: 'El token solo se muestra una vez; compártelo por WhatsApp.',
      },
    };
  }

  async cancel(user: AuthUser, id: string, cid?: string) {
    const q = await this.getForImporter(user, id);
    if (q.status !== 'DRAFT' && q.status !== 'SENT')
      throw conflict('QUOTE_NOT_CANCELLABLE', 'Solo DRAFT o SENT');
    const updated = await this.prisma.quote.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        checkoutLinks: {
          updateMany: { where: { revokedAt: null }, data: { revokedAt: new Date() } },
        },
      },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'quote.cancelled',
      resourceType: 'Quote',
      resourceId: id,
      correlationId: cid,
    });
    return this.present(updated);
  }

  /** Job: expira cotizaciones vencidas no aceptadas. */
  async expireStale() {
    const r = await this.prisma.quote.updateMany({
      where: { status: { in: ['DRAFT', 'SENT'] }, expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    });
    return r.count;
  }
}
