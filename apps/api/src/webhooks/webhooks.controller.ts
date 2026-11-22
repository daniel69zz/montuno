import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { ENV, Env } from '../config/env';
import { Public } from '../common/auth/decorators';
import { hmacHex, safeEqualHex, sha256 } from '../common/crypto';
import { DomainError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { RampsService } from '../ramps/ramps.service';

const TOLERANCE_S = 300;

/**
 * Webhooks.
 * - /webhooks/pollar: NO implementado. Pollar no documenta webhooks ni su firma (ver docs/pollar-integration.md),
 *   así que no se acepta ningún callback "de Pollar".
 * - /webhooks/mock-ramp: SOLO dev/test. Firma HMAC-SHA256 sobre `${timestamp}.${rawBody}`, tolerancia de 5 min y
 *   deduplicación por eventId (WebhookReceipt). Sirve para probar el patrón de seguridad del futuro webhook real.
 */
@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ramps: RampsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Post('pollar')
  @ApiExcludeEndpoint()
  pollar() {
    throw new NotFoundException(
      'Webhook de Pollar no disponible: el proveedor no documenta endpoint ni firma',
    );
  }

  @Public()
  @Post('mock-ramp')
  @HttpCode(200)
  async mockRamp(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-mock-timestamp') ts: string,
    @Headers('x-mock-signature') sig: string,
    @Body() body: { eventId: string; providerReference: string; outcome: 'COMPLETED' | 'FAILED' },
  ) {
    if (this.env.NODE_ENV === 'production' || !this.env.MOCK_WEBHOOK_SECRET)
      throw new NotFoundException();
    const raw = req.rawBody?.toString('utf8') ?? '';
    const t = Number(ts);
    const now = Math.floor(Date.now() / 1000);
    if (
      !Number.isFinite(t) ||
      Math.abs(now - t) > TOLERANCE_S ||
      !sig ||
      !safeEqualHex(hmacHex(this.env.MOCK_WEBHOOK_SECRET, `${ts}.${raw}`), sig)
    )
      throw new DomainError('WEBHOOK_SIGNATURE_INVALID', 'Firma o timestamp inválidos', 401);
    if (
      !body?.eventId ||
      !body.providerReference ||
      !['COMPLETED', 'FAILED'].includes(body.outcome)
    )
      throw new DomainError('WEBHOOK_PAYLOAD_INVALID', 'Payload inválido', 400);
    try {
      await this.prisma.webhookReceipt.create({
        data: { provider: 'mock-ramp', externalId: body.eventId, payloadHash: sha256(raw) },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        return { received: true, duplicate: true };
      throw e;
    }
    const r = await this.ramps.applyCompletion(body.providerReference, body.outcome);
    await this.prisma.webhookReceipt.update({
      where: { provider_externalId: { provider: 'mock-ramp', externalId: body.eventId } },
      data: { processedAt: new Date() },
    });
    return { received: true, duplicate: false, ...r, simulated: true };
  }
}
