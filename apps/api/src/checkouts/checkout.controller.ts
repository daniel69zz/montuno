import { Body, Controller, Get, Headers, Ip, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Equals, IsBoolean, IsString, Matches, MaxLength } from 'class-validator';
import type { AuthUser } from '../common/auth/auth.types';
import { CorrelationId, CurrentUser, Public } from '../common/auth/decorators';
import { Idempotent } from '../common/http/idempotency.interceptor';
import { CheckoutService } from './checkout.service';

class AcceptCheckoutDto {
  @Matches(/^[0-9a-f]{64}$/) termsHash: string;
  @Matches(/^G[A-Z2-7]{55}$/) buyerWallet: string;
  @IsBoolean() @Equals(true) acceptTerms: boolean;
  @IsString() @MaxLength(40) disclosureVersion: string;
  @Matches(/^[0-9a-f]{64}$/) disclosureHash: string;
}

@ApiTags('checkout')
@Controller('checkout')
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Public()
  @Get(':token')
  view(@Param('token') token: string) {
    return this.checkout.view(token);
  }

  /** Requiere sesión del comprador + consentimiento expreso (incluye aviso de riesgo versionado). */
  @Post(':token/accept')
  @Idempotent()
  accept(
    @CurrentUser() u: AuthUser,
    @Param('token') token: string,
    @Body() dto: AcceptCheckoutDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
    @CorrelationId() cid?: string,
  ) {
    return this.checkout.accept(u, token, dto, { ip, userAgent: ua, cid });
  }
}
