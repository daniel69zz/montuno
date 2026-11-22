import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import type { AuthUser } from '../common/auth/auth.types';
import { CorrelationId, CurrentUser } from '../common/auth/decorators';
import { Idempotent } from '../common/http/idempotency.interceptor';
import { ENV, Env } from '../config/env';
import { RampsService } from './ramps.service';

class StartRampDto {
  @IsUUID() rampQuoteId: string;
}

@ApiTags('ramps (SIMULATED)')
@ApiBearerAuth()
@Controller('orders/:id/ramp')
export class RampsController {
  constructor(
    private readonly ramps: RampsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post('quote')
  quote(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ramps.quote(u, id);
  }

  @Post('start')
  @Idempotent()
  start(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StartRampDto,
    @CorrelationId() cid?: string,
  ) {
    return this.ramps.start(u, id, dto.rampQuoteId, cid);
  }

  @Get('status')
  status(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ramps.status(u, id);
  }

  /** SOLO desarrollo/testnet: simula el pago del QR en bolivianos. Con caja-testnet dispara la entrega REAL de USDC de testnet. */
  @Post('simulate-payment')
  @Idempotent()
  simulatePayment(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    if (this.env.NODE_ENV === 'production') throw new NotFoundException();
    return this.ramps.simulatePayment(u, id);
  }
}
