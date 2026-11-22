import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { randomOtp, sha256, safeEqualHex, randomToken } from '../common/crypto';
import { DomainError, invalid } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { verifySep53 } from '../common/auth/sep53';
import type { IdentityProvider, VerifiedIdentity } from '../integrations/ports';

const OTP_TTL_MS = 10 * 60 * 1000;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const normEmail = (e: string) => e.trim().toLowerCase();

/**
 * Email OTP SIMULADO: no hay envío de correo. Pollar documenta login por email OTP solo en su SDK de
 * cliente y NO documenta verificación del lado servidor (JWT/JWKS/endpoint), así que el backend no puede
 * aceptar "el usuario ya inició sesión en Pollar" como prueba. Este mock reemplaza ese paso en desarrollo.
 */
@Injectable()
export class MockEmailOtpIdentityProvider implements IdentityProvider {
  readonly id = 'mock-email-otp';
  private readonly log = new Logger('MockEmailOtp');
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async requestOtp(emailRaw: string) {
    const email = normEmail(emailRaw);
    const code = randomOtp();
    await this.prisma.authChallenge.updateMany({
      where: { kind: 'email-otp', subject: email, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await this.prisma.authChallenge.create({
      data: {
        kind: 'email-otp',
        subject: email,
        secretHash: sha256(`${email}:${code}`),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });
    this.log.log(
      JSON.stringify({ msg: 'otp_issued_SIMULATED', emailHash: sha256(email).slice(0, 12) }),
    );
    // Solo fuera de producción se devuelve el código (no hay proveedor de correo).
    return {
      sent: true,
      simulated: true,
      expiresInSeconds: OTP_TTL_MS / 1000,
      ...(this.env.NODE_ENV !== 'production' ? { devCode: code } : {}),
    };
  }

  async verifySessionOrWalletProof(input: unknown): Promise<VerifiedIdentity> {
    const { email: raw, code } = input as { email?: string; code?: string };
    if (!raw || !code) throw invalid('OTP_REQUIRED', 'email y code requeridos');
    const email = normEmail(raw);
    const ch = await this.prisma.authChallenge.findFirst({
      where: { kind: 'email-otp', subject: email, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!ch || ch.attempts >= MAX_ATTEMPTS)
      throw new DomainError('OTP_INVALID', 'Código inválido o expirado', HttpStatus.UNAUTHORIZED);
    const ok = safeEqualHex(ch.secretHash, sha256(`${email}:${code}`));
    if (!ok) {
      await this.prisma.authChallenge.update({
        where: { id: ch.id },
        data: { attempts: { increment: 1 } },
      });
      throw new DomainError('OTP_INVALID', 'Código inválido o expirado', HttpStatus.UNAUTHORIZED);
    }
    // consumo atómico: evita doble uso concurrente
    const used = await this.prisma.authChallenge.updateMany({
      where: { id: ch.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (used.count !== 1)
      throw new DomainError('OTP_INVALID', 'Código ya utilizado', HttpStatus.UNAUTHORIZED);
    return { provider: this.id, subject: email, email, simulated: true };
  }
}

/** Prueba de posesión de wallet con SEP-53 (criptografía real). */
@Injectable()
export class StellarWalletIdentityProvider implements IdentityProvider {
  readonly id = 'stellar-wallet';
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async createChallenge(address: string, purpose: 'login' | 'link-wallet', userId?: string) {
    const nonce = randomToken(16);
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
    const message = [
      `${this.env.AUTH_DOMAIN} solicita verificar la posesión de esta cuenta Stellar.`,
      `Propósito: ${purpose}`,
      `Cuenta: ${address}`,
      `Red: ${this.env.STELLAR_NETWORK}`,
      `Nonce: ${nonce}`,
      `Expira: ${expiresAt.toISOString()}`,
    ].join('\n');
    const ch = await this.prisma.authChallenge.create({
      data: {
        kind: `wallet-sep53:${purpose}`,
        subject: address,
        userId,
        secretHash: sha256(message),
        message,
        expiresAt,
      },
    });
    return { challengeId: ch.id, message, expiresAt, scheme: 'sep53' };
  }

  async verifySessionOrWalletProof(input: unknown): Promise<VerifiedIdentity> {
    const { challengeId, signature, purpose, userId } = input as {
      challengeId?: string;
      signature?: string;
      purpose: string;
      userId?: string;
    };
    if (!challengeId || !signature)
      throw invalid('SIGNATURE_REQUIRED', 'challengeId y signature requeridos');
    const ch = await this.prisma.authChallenge.findUnique({ where: { id: challengeId } });
    const unauthorized = () =>
      new DomainError(
        'WALLET_PROOF_INVALID',
        'Firma inválida o desafío expirado',
        HttpStatus.UNAUTHORIZED,
      );
    if (
      !ch ||
      ch.kind !== `wallet-sep53:${purpose}` ||
      ch.consumedAt ||
      ch.expiresAt < new Date() ||
      !ch.message
    )
      throw unauthorized();
    if (purpose === 'link-wallet' && ch.userId !== userId) throw unauthorized();
    if (!verifySep53(ch.subject, ch.message, signature)) {
      await this.prisma.authChallenge.update({
        where: { id: ch.id },
        data: { attempts: { increment: 1 } },
      });
      throw unauthorized();
    }
    const used = await this.prisma.authChallenge.updateMany({
      where: { id: ch.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (used.count !== 1) throw unauthorized();
    return { provider: this.id, subject: ch.subject, walletAddress: ch.subject, simulated: false };
  }
}
