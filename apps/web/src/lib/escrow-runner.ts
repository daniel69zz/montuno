// Ejecuta una operación on-chain: prepare (API) -> firma en la wallet (cliente) -> submit (API).
// Soporta motores de varios pasos (Trustless Work: deploy+fund, approve+release).
import { api } from './api';
import { signPrepared, Signer } from './signers';
import type { Prepared, SubmitResult } from './types';

export interface RunStep {
  action: string;
  txHash: string;
  explorerUrl: string;
  status: SubmitResult['status'];
}

export async function runOnchain(opts: {
  orderId: string;
  prepare: () => Promise<Prepared | { prepared: Prepared }>;
  signer: Signer;
  /** máximo de pasos encadenados (TW: 2) */
  maxSteps?: number;
  onStep?: (label: string) => void;
}): Promise<RunStep[]> {
  const steps: RunStep[] = [];
  for (let i = 0; i < (opts.maxSteps ?? 1); i++) {
    opts.onStep?.(i === 0 ? 'Preparando la operación' : 'Preparando el siguiente paso');
    const r = await opts.prepare();
    const p = 'prepared' in r ? r.prepared : r;
    opts.onStep?.('Esperando tu firma en la wallet');
    const signedXdr = await signPrepared(opts.signer, p);
    opts.onStep?.('Enviando a Stellar');
    const key = `submit-${p.preparedId}`; // misma clave en reintentos: el servidor no duplica
    const res = await api<SubmitResult>(`/orders/${opts.orderId}/escrow/submit`, { body: { preparedId: p.preparedId, signedXdr }, idempotent: true, key });
    steps.push({ action: res.action, txHash: res.txHash, explorerUrl: res.explorerUrl, status: res.status });
    if (res.status === 'FAILED') throw new Error(res.error ? `La red rechazó la operación: ${res.error}` : 'La red rechazó la operación.');
    if (res.status !== 'CONFIRMED') break; // PENDING: la conciliación la cerrará
    const more = p.stepsRemaining && p.stepsRemaining.length > 1;
    if (!more) break;
  }
  return steps;
}
