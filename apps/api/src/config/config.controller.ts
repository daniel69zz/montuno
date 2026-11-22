import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/auth/decorators';
import { ESCROW_GATEWAY, StellarEscrowGateway } from '../stellar/escrow-gateway';
import { TrustlessWorkConfig } from '../trustless-work/trustless-work.config';
import { ENV, Env } from './env';

/**
 * Configuración PÚBLICA para la futura UI (sin secretos).
 * Login con Pollar (mismo patrón que WorkVille): la UI carga @pollar/core con `pollar.apiKey`, la persona entra
 * con su correo, y la wallet embebida firma el desafío SEP-53 de POST /auth/wallet/challenge. El backend verifica
 * la firma; nunca confía en la sesión ni en el correo de Pollar.
 */
@ApiTags('ops')
@Controller('config')
export class ConfigController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(ESCROW_GATEWAY) private readonly gateway: StellarEscrowGateway,
    private readonly tw: TrustlessWorkConfig,
  ) {}

  @Public()
  @Get()
  get() {
    const pollar = !!this.env.POLLAR_API_KEY;
    return {
      network: this.env.STELLAR_NETWORK,
      networkPassphrase: this.env.STELLAR_NETWORK_PASSPHRASE,
      escrow: {
        contractId: this.gateway.contractId,
        tokenContractId: this.gateway.tokenContractId,
        tokenDecimals: this.env.STELLAR_TOKEN_DECIMALS,
        simulated: this.gateway.kind === 'simulated',
      },
      explorerBaseUrl: this.env.STELLAR_EXPLORER_BASE_URL,
      auth: {
        methods: [
          'stellar-wallet',
          ...(pollar ? ['pollar-email'] : []),
          ...(this.env.NODE_ENV !== 'production' ? ['mock-email-otp'] : []),
        ],
        challengeEndpoint: '/api/v1/auth/wallet/challenge',
        sessionEndpoint: '/api/v1/auth/session',
        signature: 'sep53',
      },
      escrowEngines: [
        {
          id: 'MONTUNO',
          label: 'Contrato Montuno',
          modes: ['FULL_ESCROW', 'PARTIAL_ADVANCE'],
          beta: false,
        },
        ...(this.tw.enabled
          ? [{ id: 'TRUSTLESS_WORK', label: 'Trustless Work', modes: ['FULL_ESCROW'], beta: true }]
          : []),
      ],
      ramp: {
        provider: this.env.RAMP_PROVIDER,
        fiatPaymentSimulated: true,
        deliversRealTestnetToken: this.env.RAMP_PROVIDER === 'caja-testnet',
      },
      pollar: pollar
        ? { apiKey: this.env.POLLAR_API_KEY, stellarNetwork: this.env.STELLAR_NETWORK }
        : null,
    };
  }
}
