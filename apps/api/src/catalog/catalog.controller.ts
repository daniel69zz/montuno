import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@montuno/shared';
import type { AuthUser } from '../common/auth/auth.types';
import { CorrelationId, CurrentUser, Public, RequireRoles } from '../common/auth/decorators';
import { Idempotent } from '../common/http/idempotency.interceptor';
import {
  CatalogItemDto,
  CATALOG_CATEGORIES,
  CreateQuoteRequestDto,
  UpdateCatalogItemDto,
} from './catalog.dto';
import { CatalogService } from './catalog.service';

@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get('catalog')
  list(
    @Query('q') q?: string,
    @Query('category') category?: string,
    @Query('providerId') providerId?: string,
  ) {
    return this.catalog.list({ search: q?.slice(0, 80), category, providerId });
  }

  @Public()
  @Get('catalog/categories')
  categories() {
    return CATALOG_CATEGORIES;
  }

  @Public()
  @Get('catalog/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.get(id);
  }

  @Public()
  @Get('providers')
  providers() {
    return this.catalog.providers();
  }

  @Public()
  @Get('providers/:id')
  provider(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.provider(id);
  }

  @ApiBearerAuth()
  @Get('importers/me/catalog')
  @RequireRoles(Role.IMPORTER_OWNER, Role.IMPORTER_OPERATOR)
  mine(@CurrentUser() u: AuthUser) {
    return this.catalog.mine(u);
  }

  @ApiBearerAuth()
  @Post('importers/me/catalog')
  @RequireRoles(Role.IMPORTER_OWNER, Role.IMPORTER_OPERATOR)
  create(@CurrentUser() u: AuthUser, @Body() dto: CatalogItemDto, @CorrelationId() cid?: string) {
    return this.catalog.create(u, dto, cid);
  }

  @ApiBearerAuth()
  @Patch('importers/me/catalog/:id')
  @RequireRoles(Role.IMPORTER_OWNER, Role.IMPORTER_OPERATOR)
  update(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCatalogItemDto,
    @CorrelationId() cid?: string,
  ) {
    return this.catalog.update(u, id, dto, cid);
  }

  /** Comprador: pide una cotización a un proveedor (desde el catálogo o con un enlace propio). */
  @ApiBearerAuth()
  @Post('quote-requests')
  @Idempotent()
  request(
    @CurrentUser() u: AuthUser,
    @Body() dto: CreateQuoteRequestDto,
    @CorrelationId() cid?: string,
  ) {
    return this.catalog.requestQuote(u, dto, cid);
  }

  @ApiBearerAuth()
  @Get('me/quote-requests')
  myRequests(@CurrentUser() u: AuthUser) {
    return this.catalog.myRequests(u);
  }

  @ApiBearerAuth()
  @Get('importers/me/quote-requests')
  @RequireRoles(Role.IMPORTER_OWNER, Role.IMPORTER_OPERATOR)
  importerRequests(@CurrentUser() u: AuthUser) {
    return this.catalog.importerRequests(u);
  }

  @ApiBearerAuth()
  @Post('quote-requests/:id/close')
  close(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.closeRequest(u, id);
  }
}
