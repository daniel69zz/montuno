import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { loadEnv } from '../config/env';
import { CorrelationId, Public } from '../common/auth/decorators';
import { CreateSessionDto, OtpRequestDto, WalletChallengeDto } from './auth.dto';
import { AuthService } from './auth.service';
import { MockEmailOtpIdentityProvider, StellarWalletIdentityProvider } from './identity.service';

@ApiTags('auth')
@Controller('auth')
// límite estricto anti fuerza bruta de OTP/firmas (configurable)
@Throttle({ default: { limit: loadEnv().AUTH_THROTTLE_LIMIT, ttl: 60_000 } })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly otp: MockEmailOtpIdentityProvider,
    private readonly wallet: StellarWalletIdentityProvider,
  ) {}

  /** Solicita un OTP por email (SIMULADO: el código se devuelve como devCode fuera de producción). */
  @Public()
  @Post('otp/request')
  requestOtp(@Body() dto: OtpRequestDto) {
    return this.otp.requestOtp(dto.email);
  }

  /** Desafío SEP-53 para iniciar sesión con una wallet Stellar. */
  @Public()
  @Post('wallet/challenge')
  walletChallenge(@Body() dto: WalletChallengeDto) {
    return this.wallet.createChallenge(dto.address, 'login');
  }

  /** Intercambia una prueba verificada (OTP o firma SEP-53) por una sesión propia de la API. */
  @Public()
  @Post('session')
  session(@Body() dto: CreateSessionDto, @CorrelationId() cid?: string) {
    this.auth.ensureEmailOrWallet(dto);
    return this.auth.createSession(dto, cid);
  }
}
