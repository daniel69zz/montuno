// Firmantes de la wallet del usuario. El servidor NUNCA recibe claves: solo firmas.
import { Keypair, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import type { Prepared } from './types';

export type SignerKind = 'freighter' | 'pollar' | 'test';

export interface Signer {
  kind: SignerKind;
  address: string;
  /** SEP-53: devuelve la firma en base64. */
  signMessage(message: string): Promise<string>;
  /** Firma el XDR exacto que preparó la API. */
  signXdr(unsignedXdr: string, networkPassphrase: string): Promise<string>;
  /** Solo el ledger SIMULADO (modo DEMO) usa este formato; requiere wallet de prueba. */
  signSimulated?(unsignedXdr: string): Promise<string>;
}

const b64 = (u8: Uint8Array) => btoa(String.fromCharCode(...u8));

// --- wallet de prueba (DEMO) ------------------------------------------------
const TEST_KEY = 'montuno.testWallet';

/** Wallet de prueba: la clave vive SOLO en esta pestaña (sessionStorage). Para DEMO y testnet. */
export function testSigner(secret: string): Signer {
  const kp = Keypair.fromSecret(secret);
  return {
    kind: 'test',
    address: kp.publicKey(),
    async signMessage(message) {
      return b64(kp.signMessage(message));
    },
    async signXdr(xdr, passphrase) {
      const tx = TransactionBuilder.fromXDR(xdr, passphrase) as Transaction;
      tx.sign(kp);
      return tx.toXDR();
    },
    async signSimulated(unsignedXdr) {
      // Mismo formato que SimulatedEscrowGateway.sign del backend: ed25519 sobre sha256(unsignedXdr).
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(unsignedXdr)));
      const env = { unsignedXdr, publicKey: kp.publicKey(), signature: b64(kp.sign(hash)) };
      return btoa(JSON.stringify(env));
    },
  };
}
export function loadTestSecret(): string | null {
  try {
    return sessionStorage.getItem(TEST_KEY);
  } catch {
    return null;
  }
}
export function saveTestSecret(secret: string | null) {
  try {
    if (secret) sessionStorage.setItem(TEST_KEY, secret);
    else sessionStorage.removeItem(TEST_KEY);
  } catch {
    /* sin almacenamiento: la wallet dura hasta recargar */
  }
}

// --- Freighter ----------------------------------------------------------------
export async function freighterSigner(): Promise<Signer> {
  const f = await import('@stellar/freighter-api');
  const conn = await f.isConnected();
  if (!conn.isConnected) throw new Error('No encontramos Freighter. Instala la extensión y recarga la página.');
  const acc = await f.requestAccess();
  if (acc.error || !acc.address) throw new Error(acc.error?.message ?? 'Freighter no compartió la cuenta.');
  const address = acc.address;
  return {
    kind: 'freighter',
    address,
    async signMessage(message) {
      const r = await f.signMessage(message, { address });
      if (r.error || !r.signedMessage) throw new Error(r.error?.message ?? 'Firma rechazada en Freighter.');
      // v4+ devuelve base64; v3 devolvía Buffer.
      return typeof r.signedMessage === 'string' ? r.signedMessage : b64(new Uint8Array(r.signedMessage as unknown as ArrayBuffer));
    },
    async signXdr(xdr, networkPassphrase) {
      const r = await f.signTransaction(xdr, { networkPassphrase, address });
      if (r.error || !r.signedTxXdr) throw new Error(r.error?.message ?? 'Firma rechazada en Freighter.');
      return r.signedTxXdr;
    },
  };
}

// --- Pollar (wallet embebida por correo) ---------------------------------------
type PollarClient = import('@pollar/core').PollarClient;
let pollar: PollarClient | null = null;

export async function pollarClient(apiKey: string, network: 'testnet' | 'mainnet'): Promise<PollarClient> {
  if (pollar) return pollar;
  const { PollarClient } = await import('@pollar/core');
  const c = new PollarClient({ apiKey, stellarNetwork: network });
  await c.ready();
  pollar = c;
  return c;
}

/** Espera a que la wallet embebida esté lista (recién creada puede tardar unos segundos). */
async function pollarAddress(c: PollarClient): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const w = c.getWallet();
    if (w?.address) return w.address;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Tu cuenta todavía está preparando su wallet. Intenta en un momento.');
}

export async function pollarSigner(c: PollarClient): Promise<Signer> {
  const address = await pollarAddress(c);
  return {
    kind: 'pollar',
    address,
    async signMessage(message) {
      const r = await c.stellar.sep53.signMessage(message);
      if (r.status !== 'signed') throw new Error(r.details ?? r.code ?? 'Pollar no pudo firmar.');
      return r.signature;
    },
    async signXdr(xdr) {
      // Desde 0.12 Pollar pide confirmar cada firma: se confirma SOLO esta tx (la persona ya pulsó "Firmar").
      const off = c.onConfirmationRequest((pend) => {
        for (const p of pend) if (p.kind === 'sign' && p.unsignedXdr === xdr) p.confirm();
      });
      try {
        const r = await c.signTx(xdr);
        if (r.status === 'signed') return r.signedXdr;
        if (r.status === 'cosign_pending') throw new Error('Tu cuenta espera la aprobación de otro dispositivo.');
        throw new Error((r as { message?: string }).message ?? 'Pollar no pudo firmar.');
      } finally {
        off();
      }
    },
  };
}

export async function pollarLogout() {
  try {
    await pollar?.logout();
  } catch {
    /* sin red: Pollar igual borra la sesión local */
  }
  pollar = null;
}

/** Firma una transacción preparada por la API con el firmante activo. */
export async function signPrepared(signer: Signer, p: Prepared): Promise<string> {
  if (signer.address !== p.signer.address) {
    throw new Error(`Esta operación la debe firmar ${short(p.signer.address)}; tu wallet activa es ${short(signer.address)}.`);
  }
  if (p.format === 'simulated-json') {
    if (!signer.signSimulated) throw new Error('El modo DEMO (ledger simulado) solo se puede firmar con la wallet de prueba.');
    return signer.signSimulated(p.unsignedXdr);
  }
  return signer.signXdr(p.unsignedXdr, p.networkPassphrase);
}

export const short = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);
