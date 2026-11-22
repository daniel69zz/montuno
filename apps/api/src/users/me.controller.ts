import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { AuthUser } from '../common/auth/auth.types';
import { CorrelationId, CurrentUser } from '../common/auth/decorators';
import { PrismaService } from '../common/prisma.service';
import { toJson } from '../common/serialize';
import { VerifyWalletDto, WalletChallengeDto } from '../auth/auth.dto';
import { AuthService } from '../auth/auth.service';
import { StellarWalletIdentityProvider } from '../auth/identity.service';
import { KYC_PROVIDER, KycProvider } from '../integrations/ports';
import { OrdersQueryService } from '../orders/orders-query.service';

class KycStartDto {
  @IsOptional() @IsString() @MaxLength(100) corridorId?: string;
}

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly wallet: StellarWalletIdentityProvider,
    private readonly orders: OrdersQueryService,
    @Inject(KYC_PROVIDER) private readonly kyc: KycProvider,
  ) {}

  @Get()
  async me(@CurrentUser() user: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { wallets: true },
    });
    return toJson({
      id: u.id,
      email: u.email,
      emailVerified: !!u.emailVerifiedAt,
      displayName: u.displayName,
      roles: [...user.roles],
      memberships: user.memberships,
      wallets: u.wallets.map((w) => ({
        id: w.id,
        address: w.address,
        network: w.network,
        provider: w.provider,
        verified: !!w.verifiedAt,
      })),
    });
  }

  @Get('orders')
  myOrders(@CurrentUser() user: AuthUser) {
    return this.orders.listForBuyer(user);
  }

  @Post('wallets/challenge')
  challenge(@CurrentUser() user: AuthUser, @Body() dto: WalletChallengeDto) {
    return this.wallet.createChallenge(dto.address, 'link-wallet', user.id);
  }

  @Post('wallets/verify')
  async verify(
    @CurrentUser() user: AuthUser,
    @Body() dto: VerifyWalletDto,
    @CorrelationId() cid?: string,
  ) {
    const w = await this.auth.linkWallet(
      user.id,
      dto.challengeId,
      dto.signature,
      dto.provider,
      cid,
    );
    return { id: w.id, address: w.address, network: w.network, verified: true };
  }

  @Get('kyc')
  async kycStatus(@CurrentUser() user: AuthUser, @Query('corridorId') corridorId?: string) {
    const [requirements, status] = await Promise.all([
      this.kyc.getRequirements(user.id, corridorId),
      this.kyc.getStatus(user.id, corridorId),
    ]);
    return { status, requirements, simulated: true };
  }

  @Post('kyc/start')
  kycStart(@CurrentUser() user: AuthUser, @Body() dto: KycStartDto) {
    return this.kyc.startVerification(user.id, dto.corridorId);
  }
}
