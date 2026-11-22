import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateImporterDto {
  @IsString() @MinLength(2) @MaxLength(80) publicName: string;
  @IsOptional() @Matches(/^[0-9]{5,15}$/) nit?: string;
}
export class UpdateImporterDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) publicName?: string;
  @IsOptional() @Matches(/^[0-9]{5,15}$/) nit?: string;
}
export class SetImporterWalletDto {
  /** Wallet YA verificada (SEP-53) del usuario propietario. */
  @IsUUID() walletId: string;
}
export class ImporterLimitsDto {
  @ApiProperty({ description: 'Límite de orden en unidades atómicas (string entero)' })
  @Matches(/^(0|[1-9][0-9]{0,17})$/)
  maxOrderAmountAtomic: string;
  @IsInt() @Min(0) @Max(9999) maxAdvanceBps: number;
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(['FULL_ESCROW', 'PARTIAL_ADVANCE'], { each: true })
  allowedModes: ('FULL_ESCROW' | 'PARTIAL_ADVANCE')[];
}
export class GrantRoleDto {
  @IsIn(['ADMIN', 'ARBITER']) role: 'ADMIN' | 'ARBITER';
}
export class AddMemberDto {
  @IsUUID() userId: string;
  @IsIn(['OPERATOR']) role: 'OPERATOR';
}
