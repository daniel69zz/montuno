import type { EscrowEventType, EscrowMode, OnchainStatus } from '@montuno/shared';

/** Puerto hacia el contrato escrow. Implementaciones: Soroban (Testnet real) y Simulated (dev/tests). */
export const ESCROW_GATEWAY = Symbol('ESCROW_GATEWAY');

export type EscrowCall =
  | {
      fn: 'create_and_fund';
      orderIdHex: string;
      buyer: string;
      terms: {
        importer: string;
        arbiter: string;
        token: string;
        amountTotal: bigint;
        advanceAmount: bigint;
        mode: EscrowMode;
        termsHashHex: string;
        fundingDeadline: number; // unix segundos (UTC)
        fulfillmentDeadline: number;
      };
    }
  | { fn: 'claim_advance'; orderIdHex: string }
  | { fn: 'confirm_delivery_and_release'; orderIdHex: string }
  | { fn: 'open_dispute'; orderIdHex: string; caller: string; reasonHashHex: string }
  | {
      fn: 'resolve_dispute';
      orderIdHex: string;
      refundToBuyer: bigint;
      releaseToImporter: bigint;
      resolutionHashHex: string;
    };

export interface PreparedEnvelope {
  format: 'stellar-xdr' | 'simulated-json';
  unsignedXdr: string;
  /** Hash del cuerpo de la transacción; firmar NO lo cambia, por eso sirve para atar la firma a lo preparado. */
  txHash: string;
  networkPassphrase: string;
  expiresAt: Date;
  /** Fee máxima en stroops que pagará la cuenta firmante (fuente de la tx). */
  maxFeeStroops: string;
}

export interface SubmitResult {
  txHash: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  ledger?: number;
  error?: string;
}

export interface OnChainOrder {
  orderIdHex: string;
  buyer: string;
  importer: string;
  arbiter: string;
  asset: string;
  amountTotal: bigint;
  advanceAmount: bigint;
  advanceReleased: bigint;
  sellerReleased: bigint;
  buyerRefunded: bigint;
  remainingEscrow: bigint;
  termsHashHex: string;
  mode: EscrowMode;
  fundingDeadline: number;
  fulfillmentDeadline: number;
  status: Exclude<OnchainStatus, 'NONE'>;
  fundedAt: number;
  disputeOpenedBy: string | null;
  disputeReasonHashHex: string | null;
  resolutionHashHex: string | null;
}

export interface ChainEvent {
  id: string; // id único del evento en RPC
  ledger: number;
  txHash: string;
  type: EscrowEventType | string;
  orderIdHex: string | null;
  data: Record<string, unknown>;
}

export interface EventsPage {
  events: ChainEvent[];
  cursor: string | null;
  latestLedger: number;
  oldestLedger?: number;
}

export interface StellarEscrowGateway {
  readonly kind: 'soroban' | 'simulated';
  readonly contractId: string;
  readonly tokenContractId: string;
  readonly arbiterAddress: string;
  readonly maxAdvanceBps: number;
  prepare(call: EscrowCall, sourceAddress: string): Promise<PreparedEnvelope>;
  submit(signedEnvelope: string, expectedTxHash: string): Promise<SubmitResult>;
  getOrder(orderIdHex: string): Promise<OnChainOrder | null>;
  getEvents(opts: { startLedger?: number; cursor?: string | null }): Promise<EventsPage>;
  tokenBalance(address: string): Promise<bigint>;
  /** Estado real de una tx por hash (para recuperar envíos cortados por timeout del RPC). */
  getTransactionStatus(
    txHash: string,
  ): Promise<{ status: 'SUCCESS' | 'FAILED' | 'NOT_FOUND'; ledger?: number }>;
  health(): Promise<{ ok: boolean; latestLedger?: number; detail?: string }>;
  explorerTxUrl(txHash: string): string;
}

/** Errores del contrato (mismo orden que `enum Error` en Rust). */
export const CONTRACT_ERRORS: Record<number, string> = {
  1: 'OrderExists',
  2: 'OrderNotFound',
  3: 'TokenNotAllowed',
  4: 'ArbiterNotAllowed',
  5: 'InvalidAmount',
  6: 'InvalidAdvance',
  7: 'ModeMismatch',
  8: 'FundingDeadlinePassed',
  9: 'InvalidDeadline',
  10: 'InvalidParticipants',
  11: 'InvalidState',
  12: 'AdvanceNotAllowed',
  13: 'AdvanceAlreadyClaimed',
  14: 'NotParticipant',
  15: 'InvalidResolution',
  16: 'DisputeActive',
  17: 'TransferMismatch',
  18: 'Overflow',
  19: 'InvalidConfig',
  20: 'InvariantViolated',
};

export class EscrowGatewayError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly contractError?: string,
  ) {
    super(message);
  }
}

export function contractErrorFromMessage(msg: string): string | undefined {
  const m = /Error\(Contract, #(\d+)\)/.exec(msg);
  return m ? (CONTRACT_ERRORS[Number(m[1])] ?? `Contract#${m[1]}`) : undefined;
}
