import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { createHash } from 'crypto';

/**
 * Verificación SEP-53 ("Sign and Verify Messages"):
 * firma ed25519 sobre SHA-256("Stellar Signed Message:\n" + mensaje).
 * Compatible con `stellar message sign` (CLI) y con `client.stellar.sep53.signMessage` (Pollar, según su README).
 */
export const SEP53_PREFIX = 'Stellar Signed Message:\n';

export function sep53Hash(message: string): Buffer {
  return createHash('sha256')
    .update(Buffer.concat([Buffer.from(SEP53_PREFIX, 'utf8'), Buffer.from(message, 'utf8')]))
    .digest();
}

export function verifySep53(address: string, message: string, signature: string): boolean {
  if (!StrKey.isValidEd25519PublicKey(address)) return false;
  let sig: Buffer;
  try {
    sig = Buffer.from(signature, /^[0-9a-f]{128}$/i.test(signature) ? 'hex' : 'base64');
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;
  try {
    // verifyMessage del SDK implementa SEP-53; comprobamos además nuestro hash explícito.
    const kp = Keypair.fromPublicKey(address);
    return (
      kp.verifyMessage(message, new Uint8Array(sig)) &&
      kp.verify(new Uint8Array(sep53Hash(message)), new Uint8Array(sig))
    );
  } catch {
    return false;
  }
}

export function signSep53(kp: Keypair, message: string): string {
  return Buffer.from(kp.signMessage(message)).toString('base64');
}
