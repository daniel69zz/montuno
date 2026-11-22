import { Inject, Injectable } from '@nestjs/common';
import { CatalogItem, Importer, Prisma, QuoteRequest } from '@prisma/client';
import { ENV, Env } from '../config/env';
import type { AuthUser } from '../common/auth/auth.types';
import { AuditService } from '../common/audit.service';
import { decryptText } from '../common/crypto';
import { conflict, forbidden, invalid, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { toJson } from '../common/serialize';
import { assertSafeProductUrl } from '../quotes/url-policy';
import type { CatalogItemDto, CreateQuoteRequestDto, UpdateCatalogItemDto } from './catalog.dto';

export const QR_TOKEN_PURPOSE = 'quote-request-checkout-token';

/**
 * Catálogo de referencia y directorio de proveedores (importadoras VERIFICADAS).
 * Un ítem no es stock ni precio cerrado: el precio final siempre sale de una cotización con escrow.
 * Solo se exponen datos públicos de la importadora (nombre y estado); nunca wallets, emails ni teléfonos.
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private publicItem(i: CatalogItem & { importer?: Pick<Importer, 'id' | 'publicName'> }) {
    return toJson({
      id: i.id,
      title: i.title,
      category: i.category,
      description: i.description,
      referencePrice: { amount: i.referencePriceFiat.toFixed(2), currency: i.fiatCurrency },
      referenceUrl: i.referenceUrl,
      deliveryEstimateDays: i.deliveryEstimateDays,
      active: i.active,
      provider: i.importer ? { id: i.importer.id, publicName: i.importer.publicName } : undefined,
      updatedAt: i.updatedAt,
    });
  }

  // --- público --------------------------------------------------------------
  async list(q?: { search?: string; category?: string; providerId?: string }) {
    const where: Prisma.CatalogItemWhereInput = { active: true, importer: { status: 'VERIFIED' } };
    if (q?.category) where.category = q.category;
    if (q?.providerId) where.importerId = q.providerId;
    if (q?.search)
      where.OR = [
        { title: { contains: q.search, mode: 'insensitive' } },
        { description: { contains: q.search, mode: 'insensitive' } },
      ];
    const rows = await this.prisma.catalogItem.findMany({
      where,
      include: { importer: { select: { id: true, publicName: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.publicItem(r));
  }

  async get(id: string) {
    const i = await this.prisma.catalogItem.findFirst({
      where: { id, active: true, importer: { status: 'VERIFIED' } },
      include: { importer: { select: { id: true, publicName: true } } },
    });
    if (!i) throw notFound('Producto');
    return this.publicItem(i);
  }

  async providers() {
    const rows = await this.prisma.importer.findMany({
      where: { status: 'VERIFIED' },
      select: {
        id: true,
        publicName: true,
        allowedModes: true,
        createdAt: true,
        _count: {
          select: {
            catalogItems: { where: { active: true } },
            orders: { where: { onchainStatus: 'SETTLED', disputeState: 'NONE' } },
          },
        },
      },
      orderBy: { publicName: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      publicName: r.publicName,
      offersAdvance: r.allowedModes.includes('PARTIAL_ADVANCE'),
      catalogItems: r._count.catalogItems,
      completedOrders: r._count.orders,
      memberSince: r.createdAt.toISOString(),
    }));
  }

  async provider(id: string) {
    const p = (await this.providers()).find((x) => x.id === id);
    if (!p) throw notFound('Proveedor');
    return { ...p, items: await this.list({ providerId: id }) };
  }

  // --- importadora ------------------------------------------------------------
  private importerId(user: AuthUser) {
    const m = user.memberships[0];
    if (!m) throw forbidden('Requiere pertenecer a una importadora');
    return m.importerId;
  }

  private data(dto: Partial<CatalogItemDto>): Prisma.CatalogItemUncheckedUpdateInput {
    const d: Prisma.CatalogItemUncheckedUpdateInput = {};
    for (const k of [
      'title',
      'category',
      'description',
      'fiatCurrency',
      'deliveryEstimateDays',
      'active',
    ] as const)
      if (dto[k] !== undefined) (d as Record<string, unknown>)[k] = dto[k];
    if (dto.referencePriceFiat !== undefined)
      d.referencePriceFiat = new Prisma.Decimal(dto.referencePriceFiat);
    if (dto.referenceUrl !== undefined)
      d.referenceUrl = dto.referenceUrl ? assertSafeProductUrl(dto.referenceUrl) : null;
    return d;
  }

  async mine(user: AuthUser) {
    const rows = await this.prisma.catalogItem.findMany({
      where: { importerId: this.importerId(user) },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((r) => this.publicItem(r));
  }

  async create(user: AuthUser, dto: CatalogItemDto, cid?: string) {
    const importerId = this.importerId(user);
    const i = await this.prisma.catalogItem.create({
      data: { ...(this.data(dto) as Prisma.CatalogItemUncheckedCreateInput), importerId },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'catalog.created',
      resourceType: 'CatalogItem',
      resourceId: i.id,
      after: dto,
      correlationId: cid,
    });
    return this.publicItem(i);
  }

  async update(user: AuthUser, id: string, dto: UpdateCatalogItemDto, cid?: string) {
    const i = await this.prisma.catalogItem.findUnique({ where: { id } });
    if (!i || i.importerId !== this.importerId(user)) throw notFound('Producto');
    const u = await this.prisma.catalogItem.update({ where: { id }, data: this.data(dto) });
    await this.audit.record({
      actorId: user.id,
      action: 'catalog.updated',
      resourceType: 'CatalogItem',
      resourceId: id,
      before: i,
      after: dto,
      correlationId: cid,
    });
    return this.publicItem(u);
  }

  // --- solicitudes de cotización --------------------------------------------
  private presentRequest(
    r: QuoteRequest & {
      catalogItem?: CatalogItem | null;
      importer?: Pick<Importer, 'id' | 'publicName'>;
      buyer?: { displayName: string | null };
    },
    forBuyer: boolean,
  ) {
    let checkoutToken: string | null = null;
    if (forBuyer && r.checkoutTokenEnc) {
      try {
        checkoutToken = decryptText(this.env.SESSION_SECRET, QR_TOKEN_PURPOSE, r.checkoutTokenEnc);
      } catch {
        checkoutToken = null; // clave rotada: la importadora debe volver a compartir el enlace
      }
    }
    return toJson({
      id: r.id,
      status: r.status,
      details: r.details,
      quantity: r.quantity,
      destinationCity: r.destinationCity,
      productUrl: r.productUrl,
      catalogItem: r.catalogItem ? { id: r.catalogItem.id, title: r.catalogItem.title } : null,
      provider: r.importer ? { id: r.importer.id, publicName: r.importer.publicName } : undefined,
      ...(forBuyer ? { checkoutToken } : {}),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    });
  }

  async requestQuote(user: AuthUser, dto: CreateQuoteRequestDto, cid?: string) {
    const imp = await this.prisma.importer.findUnique({ where: { id: dto.importerId } });
    if (!imp || imp.status !== 'VERIFIED') throw notFound('Proveedor');
    if (user.memberships.some((m) => m.importerId === imp.id))
      throw forbidden('No puedes pedirte una cotización a ti mismo');
    if (dto.catalogItemId) {
      const item = await this.prisma.catalogItem.findUnique({ where: { id: dto.catalogItemId } });
      if (!item || item.importerId !== imp.id || !item.active)
        throw invalid('INVALID_CATALOG_ITEM', 'El producto no pertenece a ese proveedor');
    } else if (!dto.productUrl)
      throw invalid('PRODUCT_REQUIRED', 'Indica un producto del catálogo o el enlace del producto');
    const open = await this.prisma.quoteRequest.count({
      where: { buyerId: user.id, status: 'OPEN' },
    });
    if (open >= 10)
      throw conflict('TOO_MANY_OPEN_REQUESTS', 'Tienes demasiadas solicitudes abiertas');
    const r = await this.prisma.quoteRequest.create({
      data: {
        importerId: imp.id,
        buyerId: user.id,
        catalogItemId: dto.catalogItemId,
        productUrl: dto.productUrl ? assertSafeProductUrl(dto.productUrl) : null,
        details: dto.details,
        quantity: dto.quantity,
        destinationCity: dto.destinationCity,
      },
      include: { catalogItem: true, importer: { select: { id: true, publicName: true } } },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'quote_request.created',
      resourceType: 'QuoteRequest',
      resourceId: r.id,
      correlationId: cid,
    });
    return this.presentRequest(r, true);
  }

  async myRequests(user: AuthUser) {
    const rows = await this.prisma.quoteRequest.findMany({
      where: { buyerId: user.id },
      include: { catalogItem: true, importer: { select: { id: true, publicName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((r) => this.presentRequest(r, true));
  }

  async importerRequests(user: AuthUser) {
    const rows = await this.prisma.quoteRequest.findMany({
      where: { importerId: this.importerId(user) },
      include: { catalogItem: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.presentRequest(r, false));
  }

  async closeRequest(user: AuthUser, id: string) {
    const r = await this.prisma.quoteRequest.findUnique({ where: { id } });
    const isBuyer = r?.buyerId === user.id;
    const isImporter = !!r && user.memberships.some((m) => m.importerId === r.importerId);
    if (!r || (!isBuyer && !isImporter)) throw notFound('Solicitud');
    if (r.status !== 'OPEN') throw conflict('REQUEST_NOT_OPEN', `Estado ${r.status}`);
    await this.prisma.quoteRequest.update({ where: { id }, data: { status: 'CLOSED' } });
    return { id, status: 'CLOSED' };
  }
}
