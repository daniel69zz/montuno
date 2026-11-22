import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../common/prisma.service';
import type { KycProvider, KycRequirements, KycState, VerificationStart } from './ports';

/**
 * KYC SIMULADO. Pollar documenta getKycStatus/startKyc/resolveKyc en su SDK de CLIENTE, pero no un API
 * de servidor verificable; por eso el backend no puede confiar en un estado KYC enviado por el navegador.
 * Estado persistido en KycRecord con simulated=true.
 */
@Injectable()
export class MockKycProvider implements KycProvider {
  readonly id = 'mock-kyc';
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async getRequirements(_userId: string, corridorId?: string): Promise<KycRequirements> {
    const required = !!corridorId; // toda ruta de rampa exige KYC en el mock
    return {
      corridorId: corridorId ?? null,
      required,
      level: required ? 'basic' : null,
      steps: required ? ['FORM', 'KYC'] : [],
      simulated: true,
    };
  }

  async getStatus(userId: string, corridorId = ''): Promise<KycState> {
    const r = await this.prisma.kycRecord.findUnique({
      where: { userId_provider_corridorId: { userId, provider: this.id, corridorId } },
    });
    return (r?.status as KycState) ?? 'none';
  }

  async startVerification(userId: string, corridorId = ''): Promise<VerificationStart> {
    const status: KycState = this.env.MOCK_KYC_AUTO_APPROVE ? 'approved' : 'pending';
    const ref = `mock-kyc-${randomUUID()}`;
    await this.prisma.kycRecord.upsert({
      where: { userId_provider_corridorId: { userId, provider: this.id, corridorId } },
      create: {
        userId,
        provider: this.id,
        corridorId,
        status,
        providerReference: ref,
        simulated: true,
      },
      update: { status, providerReference: ref },
    });
    return { status, providerReference: ref, redirectUrl: null, simulated: true };
  }

  /** Solo dev/test: forzar decisión. */
  async setDecision(userId: string, corridorId: string, status: KycState) {
    await this.prisma.kycRecord.upsert({
      where: { userId_provider_corridorId: { userId, provider: this.id, corridorId } },
      create: { userId, provider: this.id, corridorId, status, simulated: true },
      update: { status },
    });
  }
}
