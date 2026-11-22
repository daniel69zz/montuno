import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { LogisticState } from '@prisma/client';
import type { AuthUser } from '../common/auth/auth.types';
import { CorrelationId, CurrentUser } from '../common/auth/decorators';
import { Idempotent } from '../common/http/idempotency.interceptor';
import { PrismaService } from '../common/prisma.service';
import { toJson } from '../common/serialize';
import { LogisticsService } from '../orders/logistics.service';
import { OrderAccessService } from '../orders/order-access.service';
import { OrdersQueryService } from '../orders/orders-query.service';
import { EscrowService } from './escrow.service';

class SubmitDto {
  @IsUUID() preparedId: string;
  @IsString() @MaxLength(20000) signedXdr: string;
}
class LogisticsDto {
  @IsIn(['PURCHASED', 'IN_TRANSIT', 'ARRIVED_BOLIVIA', 'READY_FOR_DELIVERY', 'DELIVERED'])
  state: LogisticState;
  @IsOptional() @Matches(/^[A-Za-z0-9-]{4,40}$/) trackingNumber?: string;
  @IsOptional() @IsString() @MaxLength(40) carrier?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly access: OrderAccessService,
    private readonly query: OrdersQueryService,
    private readonly escrow: EscrowService,
    private readonly logistics: LogisticsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get(':id')
  async get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const a = await this.access.load(u, id);
    const events = await this.prisma.orderEvent.findMany({
      where: { orderId: id },
      orderBy: { createdAt: 'asc' },
    });
    const full = await this.prisma.order.findUniqueOrThrow({
      where: { id },
      include: OrdersQueryService.include,
    });
    return {
      ...(this.query.present(full, { includeWallets: true }) as object),
      history: toJson(events),
      myRoles: { buyer: a.isBuyer, importer: a.isImporter, arbiter: a.isArbiter, admin: a.isAdmin },
    };
  }

  /** Construye la tx `create_and_fund` (firma el comprador). */
  @Post(':id/escrow/prepare-funding')
  @Idempotent()
  prepareFunding(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @CorrelationId() cid?: string,
  ) {
    return this.escrow.prepareFunding(u, id, cid);
  }

  /** Recibe la tx FIRMADA por el cliente (jamás claves privadas) y la envía si coincide con la preparada. */
  @Post(':id/escrow/submit')
  @Idempotent()
  submit(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitDto,
    @CorrelationId() cid?: string,
  ) {
    return this.escrow.submit(u, id, dto.preparedId, dto.signedXdr, cid);
  }

  @Get(':id/escrow')
  escrowView(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.escrow.view(u, id);
  }

  /** Fuerza una relectura del contrato (no mueve fondos). */
  @Post(':id/escrow/sync')
  async sync(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.access.load(u, id);
    return this.query.present(await this.escrow.syncFromChain(id, 'manual'));
  }

  @Post(':id/advance/prepare')
  @Idempotent()
  prepareAdvance(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @CorrelationId() cid?: string,
  ) {
    return this.escrow.prepareAdvance(u, id, cid);
  }

  @Post(':id/delivery/prepare-confirmation')
  @Idempotent()
  prepareDelivery(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @CorrelationId() cid?: string,
  ) {
    return this.escrow.prepareDeliveryConfirmation(u, id, cid);
  }

  @Patch(':id/logistics')
  async updateLogistics(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LogisticsDto,
    @CorrelationId() cid?: string,
  ) {
    return this.query.present(await this.logistics.update(u, id, dto, cid));
  }
}
