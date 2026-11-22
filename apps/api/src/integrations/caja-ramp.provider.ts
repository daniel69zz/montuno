import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../common/prisma.service';
import { TOKEN_SENDER, TokenSender } from '../stellar/caja-sender';
import type {
  RampProvider,
  RampQuote,
  RampQuoteInput,
  RampRoute,
  RampRouteInput,
  RampSession,
  RampState,
  StartRampInput,
} from './ports';
import { testQuote } from './ramp-quote';

export const CAJA_ROUTE_ID = 'CAJA-BOB-USDC-TESTNET';

/** Rampa que además entrega tokens reales de testnet (ver RampsService.applyCompletion). */
export interface DeliveringRampProvider extends RampProvider {
  readonly delivers: true;
  preflight(
    destination: string,
    amountAtomic: bigint,
  ): Promise<{ ok: true } | { ok: false; code: string; message: string }>;
  deliver(destination: string, amountAtomic: bigint): ReturnType<TokenSender['send']>;
}
export function isDelivering(p: RampProvider): p is DeliveringRampProvider {
  return (p as Partial<DeliveringRampProvider>).delivers === true;
}

/**
 * Rampa SIMULADA con USDC REAL de testnet (patrón WorkVille):
 * - el "pago en bolivianos" es simulado (QR ficticio marcado SIMULADO; se confirma con un webhook firmado o el
 *   endpoint de desarrollo simulate-payment);
 * - la entrega es REAL en testnet: la caja transfiere USDC de Circle de testnet a la wallet del comprador.
 * Lleva a WALLET_FUNDED, nunca a ESCROW_FUNDED: el comprador debe firmar luego create_and_fund.
 */
@Injectable()
export class CajaTestnetRampProvider implements DeliveringRampProvider {
  readonly id = 'caja-testnet';
  readonly delivers = true as const;
  constructor(
    private readonly prisma: PrismaService,
    @Inject(TOKEN_SENDER) private readonly sender: TokenSender,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async listAvailableRoutes(input: RampRouteInput): Promise<RampRoute[]> {
    if (input.country !== 'BO' || input.fiatCurrency !== 'BOB' || input.network !== 'testnet')
      return [];
    return [
      {
        id: CAJA_ROUTE_ID,
        provider: this.id,
        fiatCurrency: 'BOB',
        asset: input.tokenContractId,
        network: 'testnet',
        kycRequired: true,
        available: true,
        simulated: true,
        note: 'Pago en BOB SIMULADO; USDC de Circle de TESTNET real entregado por la caja.',
      },
    ];
  }

  async getQuote(input: RampQuoteInput): Promise<RampQuote> {
    if (input.routeId !== CAJA_ROUTE_ID) throw new Error('Ruta desconocida');
    return testQuote(this.id, input);
  }

  async start(_input: StartRampInput): Promise<RampSession> {
    return {
      externalId: `caja-${randomUUID()}`,
      status: 'PENDING',
      paymentInstructions: {
        method: 'QR_SIMULADO',
        qr: 'SIMULADO-NO-PAGAR',
        note: 'QR ficticio: no pagues nada. El pago se simula; la entrega de USDC de testnet es real.',
      },
      simulated: true,
    };
  }

  async getStatus(externalId: string): Promise<RampState> {
    const r = await this.prisma.rampTransaction.findUnique({
      where: { providerReference: externalId },
    });
    if (!r) return 'FAILED';
    if (r.status === 'QUOTED' || r.status === 'PROCESSING') return 'PENDING';
    return r.status as RampState;
  }

  async preflight(destination: string, amountAtomic: bigint) {
    if (amountAtomic > BigInt(this.env.RAMP_CAJA_MAX_PER_ORDER_ATOMIC))
      return {
        ok: false as const,
        code: 'CAJA_LIMIT',
        message: 'El monto supera el máximo por orden de la caja de testnet',
      };
    if (!(await this.sender.canReceive(destination)))
      return {
        ok: false as const,
        code: 'TRUSTLINE_REQUIRED',
        message:
          'La wallet debe activar la trustline del USDC de Circle (testnet) antes de recibir',
      };
    if ((await this.sender.balanceOf(this.sender.cajaAddress)) < amountAtomic)
      return {
        ok: false as const,
        code: 'CAJA_SIN_FONDOS',
        message:
          'La caja de testnet no tiene USDC suficiente; recárgala (scripts/testnet/deploy.sh)',
      };
    return { ok: true as const };
  }

  deliver(destination: string, amountAtomic: bigint) {
    return this.sender.send(destination, amountAtomic);
  }
}
