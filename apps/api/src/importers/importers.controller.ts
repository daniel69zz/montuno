import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@montuno/shared';
import type { AuthUser } from '../common/auth/auth.types';
import { CorrelationId, CurrentUser, RequireRoles } from '../common/auth/decorators';
import { OrdersQueryService } from '../orders/orders-query.service';
import { CreateImporterDto, SetImporterWalletDto, UpdateImporterDto } from './importers.dto';
import { ImportersService } from './importers.service';

@ApiTags('importers')
@ApiBearerAuth()
@Controller('importers')
export class ImportersController {
  constructor(
    private readonly importers: ImportersService,
    private readonly orders: OrdersQueryService,
  ) {}

  /** Registra una importadora (queda PENDING hasta revisión manual del admin). */
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateImporterDto,
    @CorrelationId() cid?: string,
  ) {
    return this.importers.create(user, dto, cid);
  }

  @Get('me')
  @RequireRoles(Role.IMPORTER_OWNER, Role.IMPORTER_OPERATOR)
  async me(@CurrentUser() user: AuthUser) {
    const { importer, role } = await this.importers.mine(user);
    return { ...(this.importers.present(importer) as object), myRole: role };
  }

  @Patch('me')
  @RequireRoles(Role.IMPORTER_OWNER)
  update(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateImporterDto,
    @CorrelationId() cid?: string,
  ) {
    return this.importers.update(user, dto, cid);
  }

  @Post('me/wallet/verify')
  @RequireRoles(Role.IMPORTER_OWNER)
  setWallet(
    @CurrentUser() user: AuthUser,
    @Body() dto: SetImporterWalletDto,
    @CorrelationId() cid?: string,
  ) {
    return this.importers.setWallet(user, dto.walletId, cid);
  }

  @Get('me/orders')
  @RequireRoles(Role.IMPORTER_OWNER, Role.IMPORTER_OPERATOR)
  async myOrders(@CurrentUser() user: AuthUser) {
    const { importer } = await this.importers.mine(user);
    return this.orders.listForImporter(importer.id);
  }
}
