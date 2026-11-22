import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@montuno/shared';
import type { AuthUser } from '../common/auth/auth.types';
import { CorrelationId, CurrentUser, RequireRoles } from '../common/auth/decorators';
import { Idempotent } from '../common/http/idempotency.interceptor';
import { CreateQuoteDto, UpdateQuoteDto } from './quotes.dto';
import { QuotesService } from './quotes.service';

@ApiTags('quotes')
@ApiBearerAuth()
@Controller('quotes')
@RequireRoles(Role.IMPORTER_OWNER, Role.IMPORTER_OPERATOR)
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Post()
  @Idempotent()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateQuoteDto, @CorrelationId() cid?: string) {
    return this.quotes.create(u, dto, cid);
  }

  @Get(':id')
  async get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.present(await this.quotes.getForImporter(u, id));
  }

  @Patch(':id')
  update(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQuoteDto,
    @CorrelationId() cid?: string,
  ) {
    return this.quotes.update(u, id, dto, cid);
  }

  @Post(':id/publish')
  @Idempotent()
  publish(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @CorrelationId() cid?: string,
  ) {
    return this.quotes.publish(u, id, cid);
  }

  @Post(':id/cancel')
  cancel(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @CorrelationId() cid?: string,
  ) {
    return this.quotes.cancel(u, id, cid);
  }
}
