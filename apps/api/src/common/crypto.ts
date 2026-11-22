import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'crypto';

export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const hmacHex = (secret: string, data: string | Buffer) =>
  createHmac('sha256', secret).update(data).digest('hex');
export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
}
export const randomOtp = () =>
  (randomBytes(4).readUInt32BE(0) % 1_000_000).toString().padStart(6, '0');

/** AES-256-GCM con clave derivada (para guardar tokens que solo un usuario puede recuperar). */
function aesKey(secret: string, purpose: string) {
  return createHash('sha256').update(`${secret}:${purpose}`).digest();
}
export function encryptText(secret: string, purpose: string, plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', aesKey(secret, purpose), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}
export function decryptText(secret: string, purpose: string, enc: string): string {
  const [iv, tag, data] = enc.split('.').map((p) => Buffer.from(p, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', aesKey(secret, purpose), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}
