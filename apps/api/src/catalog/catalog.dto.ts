import { PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const CATALOG_CATEGORIES = [
  'tecnologia',
  'telefonia',
  'audio',
  'hogar',
  'moda',
  'deporte',
  'belleza',
  'juguetes',
  'herramientas',
  'otros',
] as const;

export class CatalogItemDto {
  @IsString() @MinLength(3) @MaxLength(120) title: string;
  @IsIn(CATALOG_CATEGORIES as unknown as string[]) category: string;
  @IsString() @MinLength(10) @MaxLength(1000) description: string;
  @Matches(/^[0-9]{1,15}(\.[0-9]{1,2})?$/) referencePriceFiat: string;
  @IsIn(['BOB', 'USD']) fiatCurrency: 'BOB' | 'USD';
  @IsOptional() @IsString() @MaxLength(2048) referenceUrl?: string;
  @IsInt() @Min(1) @Max(365) deliveryEstimateDays: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
export class UpdateCatalogItemDto extends PartialType(CatalogItemDto) {}

export class CreateQuoteRequestDto {
  @IsUUID() importerId: string;
  @IsOptional() @IsUUID() catalogItemId?: string;
  @IsOptional() @IsString() @MaxLength(2048) productUrl?: string;
  @IsString() @MinLength(5) @MaxLength(1000) details: string;
  @IsInt() @Min(1) @Max(100) quantity: number;
  @IsString() @MinLength(2) @MaxLength(80) destinationCity: string;
}
