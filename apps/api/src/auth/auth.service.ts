import { Inject, Injectable } from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { AuditService } from '../common/audit.service';
import { conflict, invalid } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { SessionService } from '../common/auth/session.service';
import { MockEmailOtpIdentityProvider, StellarWalletIdentityProvider } from './identity.service';
import type { CreateSessionDto } from './auth.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly otp: MockEmailOtpIdentityProvider,
    private readonly wallet: StellarWalletIdentityProvider,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async createSession(dto: CreateSessionDto, correlationId?: string) {
    let userId: string;
    let simulated: boolean;
    if (dto.provider === 'mock-email-otp') {
      const id = await this.otp.verifySessionOrWalletProof({ email: dto.email, code: dto.code });
      simulated = id.simulated;
      const user = await this.prisma.user.upsert({
        where: { email: id.email! },
        create: {
          email: id.email!,
          emailVerifiedAt: new Date(),
          identityProvider: id.provider,
          externalSubject: id.subject,
        },
        update: { emailVerifiedAt: new Date() },
      });
      userId = user.id;
      await this.bootstrapAdmin(user.id, id.email!);
    } else {
      const id = await this.wallet.verifySessionOrWalletProof({
        challengeId: dto.challengeId,
        signature: dto.signature,
        purpose: 'login',
      });
      simulated = false;
      const existing = await this.prisma.userWallet.findUnique({
        where: {
          address_network: { address: id.walletAddress!, network: this.env.STELLAR_NETWORK },
        },
      });
      if (existing?.verifiedAt) userId = existing.userId;
      else if (existing) throw conflict('WALLET_UNVERIFIED', 'Wallet registrada sin verificar');
      else {
        const user = await this.prisma.user.create({
          data: {
            identityProvider: id.provider,
            externalSubject: id.subject,
            wallets: {
              create: {
                address: id.walletAddress!,
                network: this.env.STELLAR_NETWORK,
                // origen declarado (p. ej. 'pollar'); la posesión ya la probó la firma SEP-53
                provider: dto.walletProvider ?? 'self-custody',
                verifiedAt: new Date(),
              },
            },
          },
        });
        userId = user.id;
      }
    }
    await this.audit.record({
      actorId: userId,
      action: 'auth.session_created',
      resourceType: 'User',
      resourceId: userId,
      after: { provider: dto.provider },
      correlationId,
    });
    return { ...this.sessions.issue(userId, dto.provider), userId, simulated };
  }

  /** El primer login verificado con ADMIN_INITIAL_EMAIL recibe rol ADMIN. */
  private async bootstrapAdmin(userId: string, email: string) {
    if (!this.env.ADMIN_INITIAL_EMAIL || email !== this.env.ADMIN_INITIAL_EMAIL.toLowerCase())
      return;
    await this.prisma.userPlatformRole.upsert({
      where: { userId_role: { userId, role: 'ADMIN' } },
      create: { userId, role: 'ADMIN' },
      update: {},
    });
  }

  async linkWallet(
    userId: string,
    challengeId: string,
    signature: string,
    provider = 'self-custody',
    correlationId?: string,
  ) {
    const id = await this.wallet.verifySessionOrWalletProof({
      challengeId,
      signature,
      purpose: 'link-wallet',
      userId,
    });
    const key = {
      address_network: { address: id.walletAddress!, network: this.env.STELLAR_NETWORK },
    };
    const existing = await this.prisma.userWallet.findUnique({ where: key });
    if (existing && existing.userId !== userId)
      throw conflict('WALLET_OWNED_BY_OTHER', 'Esta wallet ya está vinculada a otra cuenta');
    const w = await this.prisma.userWallet.upsert({
      where: key,
      create: {
        userId,
        address: id.walletAddress!,
        network: this.env.STELLAR_NETWORK,
        provider,
        verifiedAt: new Date(),
      },
      update: { verifiedAt: new Date() },
    });
    await this.audit.record({
      actorId: userId,
      action: 'wallet.verified',
      resourceType: 'UserWallet',
      resourceId: w.id,
      after: { address: w.address },
      correlationId,
    });
    return w;
  }

  ensureEmailOrWallet(dto: CreateSessionDto) {
    if (dto.provider === 'mock-email-otp' && (!dto.email || !dto.code))
      throw invalid('OTP_REQUIRED', 'email y code requeridos');
    if (dto.provider === 'stellar-wallet' && (!dto.challengeId || !dto.signature))
      throw invalid('SIGNATURE_REQUIRED', 'challengeId y signature requeridos');
  }
}
