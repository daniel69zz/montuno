import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const ATOMIC = /^(0|[1-9][0-9]{0,17})$/;

export class FxDto {
  @Matches(/^[0-9]{1,8}(\.[0-9]{1,10})?$/) rate: string;
  @IsInt() @Min(0) @Max(5000) spreadBps: number;
  @IsString() @MaxLength(60) source: string;
  @IsISO8601({ strict: true }) expiresAt: string;
}

export class CreateQuoteDto {
  @IsString() @MaxLength(2048) productUrl: string;
  @IsString() @MinLength(2) @MaxLength(200) productName: string;
  @IsOptional() @IsString() @MaxLength(200) productVariant?: string;
  @IsInt() @Min(1) @Max(100) quantity: number;
  @IsString() @MinLength(2) @MaxLength(80) destinationCity: string;
  @IsInt() @Min(1) @Max(365) deliveryEstimateDays: number;
  @IsString() @MaxLength(2000) purchaseTerms: string;
  @ApiProperty({ example: '8352.00' }) @Matches(/^[0-9]{1,15}(\.[0-9]{1,2})?$/) fiatPrice: string;
  @IsIn(['BOB', 'USD']) fiatCurrency: 'BOB' | 'USD';
  @ApiProperty({
    description:
      'Monto TOTAL final en unidades atómicas del token (7 decimales para USDC/TESTUSD). Incluye comisiones.',
    example: '12000000000',
  })
  @Matches(ATOMIC)
  amountAtomic: string;
  @ApiPropertyOptional({ description: 'Desglose informativo, incluido en amountAtomic' })
  @IsOptional()
  @Matches(ATOMIC)
  serviceFeeAtomic?: string;
  @ApiPropertyOptional({ description: 'Desglose informativo, incluido en amountAtomic' })
  @IsOptional()
  @Matches(ATOMIC)
  rampFeeAtomic?: string;
  @IsOptional() @ValidateNested() @Type(() => FxDto) fx?: FxDto;
  @IsIn(['FULL_ESCROW', 'PARTIAL_ADVANCE']) escrowMode: 'FULL_ESCROW' | 'PARTIAL_ADVANCE';
  @ApiPropertyOptional({ example: '9000000000' })
  @IsOptional()
  @Matches(ATOMIC)
  advanceAmountAtomic?: string;
  @ApiProperty({
    description:
      'Vencimiento de la cotización (UTC). Es el funding_deadline on-chain salvo que fx venza antes.',
  })
  @IsISO8601({ strict: true })
  expiresAt: string;
  @IsISO8601({ strict: true }) fulfillmentDeadline: string;
}

export class UpdateQuoteDto extends PartialType(CreateQuoteDto) {
  @ApiProperty({ description: 'Versión esperada (control optimista)' })
  @IsInt()
  @Min(1)
  expectedVersion: number;
}
