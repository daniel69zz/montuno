import { Inject, Injectable } from '@nestjs/common';
import { EvidenceType } from '@prisma/client';
import { randomToken } from '../common/crypto';
import { createHash } from 'crypto';
import { ENV, Env } from '../config/env';
import type { AuthUser } from '../common/auth/auth.types';
import { AuditService } from '../common/audit.service';
import { conflict, forbidden, invalid, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { toJson } from '../common/serialize';
import { OrderAccessService } from '../orders/order-access.service';
import {
  ALLOWED_EVIDENCE_MIME,
  OBJECT_STORAGE,
  ObjectStorage,
  sniffMime,
} from '../storage/object-storage';

const IMPORTER_TYPES: EvidenceType[] = ['RECEIPT', 'TRACKING', 'DELIVERY_PROOF', 'OTHER'];
const BUYER_TYPES: EvidenceType[] = ['DELIVERY_PROOF', 'OTHER'];

@Injectable()
export class EvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrderAccessService,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async createUploadUrl(
    user: AuthUser,
    orderId: string,
    dto: { type: EvidenceType; mimeType: string; sizeBytes: number; sha256: string },
  ) {
    const { order, isBuyer, isImporter } = await this.access.load(user, orderId);
    const allowed = isImporter ? IMPORTER_TYPES : isBuyer ? BUYER_TYPES : [];
    if (!allowed.includes(dto.type)) throw forbidden('Tipo de evidencia no permitido para tu rol');
    if (!ALLOWED_EVIDENCE_MIME.includes(dto.mimeType))
      throw invalid('MIME_NOT_ALLOWED', `MIME permitido: ${ALLOWED_EVIDENCE_MIME.join(', ')}`);
    if (dto.sizeBytes <= 0 || dto.sizeBytes > this.env.EVIDENCE_MAX_BYTES)
      throw invalid('FILE_TOO_LARGE', `Máximo ${this.env.EVIDENCE_MAX_BYTES} bytes`);
    // nombre aleatorio: nunca el nombre original del archivo
    const objectKey = `evidence/${order.id}/${randomToken(24)}`;
    await this.prisma.purchaseEvidence.create({
      data: {
        orderId,
        type: dto.type,
        objectKey,
        sha256: dto.sha256,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        uploadedBy: user.id,
      },
    });
    const signed = this.storage.presignUpload(objectKey, dto.mimeType, dto.sizeBytes, 600);
    return {
      objectKey,
      uploadUrl: signed.url,
      method: 'PUT',
      headers: { 'content-type': dto.mimeType },
      expiresAt: signed.expiresAt.toISOString(),
    };
  }

  async confirmUpload(user: AuthUser, orderId: string, objectKey: string, cid?: string) {
    await this.access.load(user, orderId);
    const ev = await this.prisma.purchaseEvidence.findUnique({ where: { objectKey } });
    if (!ev || ev.orderId !== orderId || ev.uploadedBy !== user.id) throw notFound('Evidencia');
    if (ev.confirmedAt) return toJson(ev);
    const data = await this.storage.get(objectKey);
    if (!data) throw conflict('UPLOAD_MISSING', 'El archivo no fue subido');
    const hash = createHash('sha256').update(data).digest('hex');
    if (hash !== ev.sha256)
      throw invalid('HASH_MISMATCH', 'El SHA-256 del archivo no coincide con el declarado');
    if (data.length !== ev.sizeBytes)
      throw invalid('SIZE_MISMATCH', 'Tamaño distinto al declarado');
    if (sniffMime(data) !== ev.mimeType)
      throw invalid('MIME_MISMATCH', 'El contenido no corresponde al tipo declarado');
    const updated = await this.prisma.purchaseEvidence.update({
      where: { id: ev.id },
      data: { confirmedAt: new Date() },
    });
    await this.audit.record({
      actorId: user.id,
      action: 'evidence.confirmed',
      resourceType: 'PurchaseEvidence',
      resourceId: ev.id,
      after: { type: ev.type, sha256: ev.sha256 },
      correlationId: cid,
    });
    return toJson(updated);
  }

  async list(user: AuthUser, orderId: string) {
    await this.access.load(user, orderId);
    const rows = await this.prisma.purchaseEvidence.findMany({
      where: { orderId, confirmedAt: { not: null } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      ...(toJson(r) as object),
      downloadUrl: this.storage.presignDownload(r.objectKey, 300).url,
    }));
  }

  /** PUT prefirmado. Valida firma, expiración, MIME y tamaño. */
  async receiveUpload(
    objectKey: string,
    q: { exp: string; sig: string; mime: string; max: string },
    contentType: string | undefined,
    body: Buffer,
  ) {
    const exp = Number(q.exp);
    if (!this.storage.verifySignature('put', objectKey, exp, q.sig, `${q.mime}|${q.max}`))
      throw forbidden('URL de subida inválida o expirada');
    if (contentType !== q.mime)
      throw invalid('CONTENT_TYPE_MISMATCH', 'content-type distinto al firmado');
    if (!Buffer.isBuffer(body) || body.length === 0 || body.length > Number(q.max))
      throw invalid('FILE_TOO_LARGE', 'Tamaño inválido');
    const ev = await this.prisma.purchaseEvidence.findUnique({ where: { objectKey } });
    if (!ev) throw notFound('Evidencia');
    try {
      await this.storage.put(objectKey, body);
    } catch {
      throw conflict('ALREADY_UPLOADED', 'El objeto ya existe');
    }
    return { stored: true, sizeBytes: body.length };
  }

  async download(objectKey: string, q: { exp: string; sig: string }) {
    if (!this.storage.verifySignature('get', objectKey, Number(q.exp), q.sig))
      throw forbidden('URL inválida o expirada');
    const ev = await this.prisma.purchaseEvidence.findUnique({ where: { objectKey } });
    const data = ev?.confirmedAt ? await this.storage.get(objectKey) : null;
    if (!ev || !data) throw notFound('Archivo');
    return { data, mimeType: ev.mimeType };
  }
}
