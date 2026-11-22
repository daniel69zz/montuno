import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EvidenceType } from '@prisma/client';
import { IsIn, IsInt, IsString, Matches, Max, Min } from 'class-validator';
import type { Request, Response } from 'express';
import type { AuthUser } from '../common/auth/auth.types';
import { CorrelationId, CurrentUser, Public } from '../common/auth/decorators';
import { EvidenceService } from './evidence.service';

class UploadUrlDto {
  @IsIn(['RECEIPT', 'TRACKING', 'DELIVERY_PROOF', 'OTHER']) type: EvidenceType;
  @IsString() mimeType: string;
  @IsInt() @Min(1) @Max(50 * 1024 * 1024) sizeBytes: number;
  @Matches(/^[0-9a-f]{64}$/) sha256: string;
}
class ConfirmDto {
  @IsString() objectKey: string;
}

@ApiTags('evidence')
@ApiBearerAuth()
@Controller('orders/:id/evidence')
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  @Post('upload-url')
  uploadUrl(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UploadUrlDto,
  ) {
    return this.evidence.createUploadUrl(u, id, dto);
  }

  @Post('confirm-upload')
  confirm(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmDto,
    @CorrelationId() cid?: string,
  ) {
    return this.evidence.confirmUpload(u, id, dto.objectKey, cid);
  }

  @Get()
  list(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.evidence.list(u, id);
  }
}

/** Endpoints de URLs prefirmadas (autorización = firma HMAC de la URL). */
@ApiTags('storage')
@Controller('storage/objects')
export class StorageController {
  constructor(private readonly evidence: EvidenceService) {}

  @Public()
  @Put(':key')
  put(
    @Param('key') key: string,
    @Query() q: { exp: string; sig: string; mime: string; max: string },
    @Headers('content-type') ct: string,
    @Req() req: Request,
  ) {
    return this.evidence.receiveUpload(key, q, ct, req.body as Buffer);
  }

  @Public()
  @Get(':key')
  async get(
    @Param('key') key: string,
    @Query() q: { exp: string; sig: string },
    @Res() res: Response,
  ) {
    const { data, mimeType } = await this.evidence.download(key, q);
    res.setHeader('content-type', mimeType);
    res.setHeader('content-disposition', 'attachment');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('cache-control', 'private, no-store');
    res.send(data);
  }
}
