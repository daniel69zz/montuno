import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { testQuote } from './ramp-quote';
import { PrismaService } from '../common/prisma.service';
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

/**
 * Rampa BOB -> token de prueba SIMULADA.
 * Según el README de Pollar la ruta BOB documentada es hacia SOLANA (Stereum + CCTP), no Stellar, y no hay
 * soporte Testnet documentado. Por eso no hay ruta real: este mock NO mueve dinero ni tokens reales.
 * El tipo de cambio es un valor de prueba explícito, nunca una tasa real.
 */
export const MOCK_ROUTE_ID = 'MOCK-BOB-TESTUSD-TESTNET';

@Injectable()
export class MockRampProvider implements RampProvider {
  readonly id = 'mock-ramp';
  constructor(private readonly prisma: PrismaService) {}

  async listAvailableRoutes(input: RampRouteInput): Promise<RampRoute[]> {
    if (input.country !== 'BO' || input.fiatCurrency !== 'BOB' || input.network !== 'testnet')
      return [];
    return [
      {
        id: MOCK_ROUTE_ID,
        provider: this.id,
        fiatCurrency: 'BOB',
        asset: input.tokenContractId,
        network: 'testnet',
        kycRequired: true,
        available: true,
        simulated: true,
        note: 'Ruta SIMULADA. No existe corredor BOB->Stellar Testnet verificado.',
      },
    ];
  }

  async getQuote(input: RampQuoteInput): Promise<RampQuote> {
    if (input.routeId !== MOCK_ROUTE_ID) throw new Error('Ruta desconocida');
    return testQuote(this.id, input);
  }

  async start(_input: StartRampInput): Promise<RampSession> {
    return {
      externalId: `mock-ramp-${randomUUID()}`,
      status: 'PENDING',
      paymentInstructions: {
        method: 'SIMULATED',
        note: 'No pagues nada: ruta simulada. Completa vía /webhooks/mock-ramp firmado.',
      },
      simulated: true,
    };
  }

  async getStatus(externalId: string): Promise<RampState> {
    const r = await this.prisma.rampTransaction.findUnique({
      where: { providerReference: externalId },
    });
    if (!r) return 'FAILED';
    return r.status === 'QUOTED' ? 'PENDING' : (r.status as RampState);
  }
}
