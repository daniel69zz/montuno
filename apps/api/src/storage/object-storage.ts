import { Inject, Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { ENV, Env } from '../config/env';
import { hmacHex, safeEqualHex } from '../common/crypto';

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export interface ObjectStorage {
  presignUpload(
    key: string,
    mimeType: string,
    maxBytes: number,
    ttlSeconds: number,
  ): { url: string; expiresAt: Date };
  presignDownload(key: string, ttlSeconds: number): { url: string; expiresAt: Date };
  verifySignature(
    op: 'put' | 'get',
    key: string,
    exp: number,
    sig: string,
    extra?: string,
  ): boolean;
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
}

const KEY_RE = /^[a-z0-9-]+\/[a-f0-9-]{36}\/[A-Za-z0-9_-]{20,64}$/;

/**
 * Almacenamiento PRIVADO local con URLs prefirmadas (HMAC + expiración), mismo patrón que S3 presigned URLs.
 * Los archivos quedan fuera de cualquier ruta estática; solo se acceden con firma válida.
 */
@Injectable()
export class LocalObjectStorage implements ObjectStorage {
  private readonly dir: string;
  constructor(@Inject(ENV) private readonly env: Env) {
    this.dir = path.resolve(env.OBJECT_STORAGE_LOCAL_DIR, env.OBJECT_STORAGE_BUCKET);
  }
  static isValidKey(key: string) {
    return KEY_RE.test(key);
  }
  private sign(op: string, key: string, exp: number, extra = '') {
    return hmacHex(this.env.SESSION_SECRET + ':storage', `${op}\n${key}\n${exp}\n${extra}`);
  }
  presignUpload(key: string, mimeType: string, maxBytes: number, ttlSeconds: number) {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const extra = `${mimeType}|${maxBytes}`;
    const qs = new URLSearchParams({
      exp: String(exp),
      mime: mimeType,
      max: String(maxBytes),
      sig: this.sign('put', key, exp, extra),
    });
    return {
      url: `${this.env.PUBLIC_API_BASE_URL}/api/v1/storage/objects/${encodeURIComponent(key)}?${qs}`,
      expiresAt: new Date(exp * 1000),
    };
  }
  presignDownload(key: string, ttlSeconds: number) {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const qs = new URLSearchParams({ exp: String(exp), sig: this.sign('get', key, exp) });
    return {
      url: `${this.env.PUBLIC_API_BASE_URL}/api/v1/storage/objects/${encodeURIComponent(key)}?${qs}`,
      expiresAt: new Date(exp * 1000),
    };
  }
  verifySignature(op: 'put' | 'get', key: string, exp: number, sig: string, extra = '') {
    if (!KEY_RE.test(key) || !Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000))
      return false;
    return safeEqualHex(this.sign(op, key, exp, extra), sig);
  }
  private file(key: string) {
    if (!KEY_RE.test(key)) throw new Error('clave inválida');
    return path.join(this.dir, ...key.split('/'));
  }
  async put(key: string, data: Buffer) {
    const f = this.file(key);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, data, { flag: 'wx', mode: 0o600 }); // no sobrescribe
  }
  async get(key: string) {
    try {
      return await fs.readFile(this.file(key));
    } catch {
      return null;
    }
  }
}

/** Validación básica por "magic bytes" del contenido real (no confiar en el MIME declarado). */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'image/png';
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-')
    return 'application/pdf';
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp';
  return null;
}
export const ALLOWED_EVIDENCE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
