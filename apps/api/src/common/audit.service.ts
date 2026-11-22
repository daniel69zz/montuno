import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { redact } from './logger';
import { PrismaService } from './prisma.service';
import { toJson } from './serialize';

type Tx = Prisma.TransactionClient | PrismaService;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    entry: {
      actorId?: string | null;
      action: string;
      resourceType: string;
      resourceId?: string;
      before?: unknown;
      after?: unknown;
      correlationId?: string;
    },
    tx: Tx = this.prisma,
  ) {
    const clean = (v: unknown) =>
      v === undefined ? undefined : (redact(toJson(v)) as Prisma.InputJsonValue);
    await tx.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        before: clean(entry.before),
        after: clean(entry.after),
        correlationId: entry.correlationId,
      },
    });
  }
}
