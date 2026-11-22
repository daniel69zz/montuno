import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

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
