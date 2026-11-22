import { Keypair } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
// Implementación del BACKEND (fuente de verdad del formato simulado).
import { SimulatedEscrowGateway } from '../../../api/src/stellar/simulated.gateway';
import { testSigner } from './signers';

describe('firma del modo DEMO', () => {
  it('el navegador produce exactamente el sobre que verifica el backend', async () => {
    const kp = Keypair.random();
    const unsignedXdr = btoa(JSON.stringify({ v: 1, kind: 'simulated-escrow-tx', nonce: 'abc' }));
    const fromWeb = JSON.parse(atob(await testSigner(kp.secret()).signSimulated!(unsignedXdr)));
    const fromApi = JSON.parse(Buffer.from(SimulatedEscrowGateway.sign(unsignedXdr, kp), 'base64').toString('utf8'));
    expect(fromWeb).toEqual(fromApi);
  });

  it('SEP-53 del navegador verifica con la clave pública', async () => {
    const kp = Keypair.random();
    const sig = await testSigner(kp.secret()).signMessage('montuno login');
    expect(kp.verifyMessage('montuno login', Uint8Array.from(atob(sig), (c) => c.charCodeAt(0)))).toBe(true);
  });
});
