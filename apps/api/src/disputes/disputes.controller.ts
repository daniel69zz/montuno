import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import type { AuthUser } from '../common/auth/auth.types';
import { CorrelationId, CurrentUser } from '../common/auth/decorators';
import { Idempotent } from '../common/http/idempotency.interceptor';
import { DisputesService } from './disputes.service';

class OpenDisputeDto {
  @IsString() @MinLength(10) @MaxLength(4000) reason: string;
}
class ResolutionDto {
  @Matches(/^(0|[1-9][0-9]{0,17})$/) refundToBuyerAtomic: string;
  @Matches(/^(0|[1-9][0-9]{0,17})$/) releaseToImporterAtomic: string;
  @IsString() @MinLength(10) @MaxLength(4000) resolution: string;
}

@ApiTags('disputes')
@ApiBearerAuth()
@Controller('orders/:id/disputes')
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Post()
  @Idempotent()
  open(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OpenDisputeDto,
    @CorrelationId() cid?: string,
  ) {
    return this.disputes.open(u, id, dto.reason, cid);
  }

  @Get()
  list(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.disputes.list(u, id);
  }

  @Post(':disputeId/review')
  review(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('disputeId', ParseUUIDPipe) did: string,
    @CorrelationId() cid?: string,
  ) {
    return this.disputes.markUnderReview(u, id, did, cid);
  }

  @Post(':disputeId/prepare-resolution')
  @Idempotent()
  prepareResolution(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('disputeId', ParseUUIDPipe) did: string,
    @Body() dto: ResolutionDto,
    @CorrelationId() cid?: string,
  ) {
    return this.disputes.prepareResolution(u, id, did, dto, cid);
  }
}
