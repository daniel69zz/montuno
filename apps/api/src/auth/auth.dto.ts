import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class OtpRequestDto {
  @IsEmail() @MaxLength(254) email: string;
}

export class WalletChallengeDto {
  @Matches(/^G[A-Z2-7]{55}$/, { message: 'address debe ser una cuenta Stellar G...' })
  address: string;
}

export class CreateSessionDto {
  @ApiProperty({ enum: ['mock-email-otp', 'stellar-wallet'] })
  @IsIn(['mock-email-otp', 'stellar-wallet'])
  provider: 'mock-email-otp' | 'stellar-wallet';
  /** mock-email-otp */
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @Matches(/^[0-9]{6}$/) code?: string;
  /** stellar-wallet (SEP-53) */
  @IsOptional() @IsUUID() challengeId?: string;
  @IsOptional() @IsString() @MaxLength(200) signature?: string;
  /**
   * Origen DECLARADO de la wallet (p. ej. 'pollar' si se firmó con la wallet embebida de Pollar).
   * Solo informativo: la identidad la prueba la firma SEP-53, no este campo.
   */
  @IsOptional() @IsIn(['self-custody', 'pollar', 'cli-test']) walletProvider?:
    | 'self-custody'
    | 'pollar'
    | 'cli-test';
}

export class VerifyWalletDto {
  @IsUUID() challengeId: string;
  @IsString() @MaxLength(200) signature: string;
  @IsOptional() @IsIn(['self-custody', 'pollar', 'cli-test']) provider?:
    | 'self-custody'
    | 'pollar'
    | 'cli-test';
}
