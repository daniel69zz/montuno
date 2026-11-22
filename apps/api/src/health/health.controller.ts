import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/auth/decorators';
import { PrismaService } from '../common/prisma.service';
import { ESCROW_GATEWAY, StellarEscrowGateway } from '../stellar/escrow-gateway';

@ApiTags('ops')
@Controller()
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ESCROW_GATEWAY) private readonly gateway: StellarEscrowGateway,
  ) {}

  @Public()
  @Get('health')
  health() {
    return { status: 'ok', time: new Date().toISOString() };
  }

  @Public()
  @Get('ready')
  async ready() {
    const checks: Record<string, unknown> = {};
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch {
      checks.database = 'down';
    }
    const chain = await this.gateway.health();
    checks.stellar = {
      gateway: this.gateway.kind,
      simulated: this.gateway.kind === 'simulated',
      contractId: this.gateway.contractId,
      ...chain,
    };
    const ok = checks.database === 'ok' && chain.ok;
    if (!ok) throw new ServiceUnavailableException({ status: 'not_ready', checks });
    return { status: 'ready', checks };
  }
}
