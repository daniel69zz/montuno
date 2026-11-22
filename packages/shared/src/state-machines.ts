// Máquinas de estado independientes (guía §5). Las transiciones se aplican SOLO
// desde servicios de dominio; nunca mediante un PATCH genérico de status.
import { DisputeState, LogisticState, PaymentState, QuoteStatus } from './enums';

type Graph<S extends string> = Record<S, readonly S[]>;

export const QUOTE_TRANSITIONS: Graph<QuoteStatus> = {
  DRAFT: ['SENT', 'CANCELLED'],
  SENT: ['ACCEPTED', 'EXPIRED', 'CANCELLED'],
  ACCEPTED: ['EXPIRED'], // expira si la cotización de conversión vence antes del depósito
  EXPIRED: [],
  CANCELLED: [],
};

export const PAYMENT_TRANSITIONS: Graph<PaymentState> = {
  NOT_STARTED: ['RAMP_PENDING', 'ESCROW_PENDING'],
  RAMP_PENDING: ['WALLET_FUNDED', 'FAILED', 'ESCROW_PENDING'],
  WALLET_FUNDED: ['ESCROW_PENDING'],
  ESCROW_PENDING: ['ESCROW_FUNDED', 'FAILED', 'ESCROW_PENDING'],
  FAILED: ['RAMP_PENDING', 'ESCROW_PENDING', 'ESCROW_FUNDED'],
  ESCROW_FUNDED: ['REFUNDED', 'PARTIALLY_REFUNDED'],
  REFUNDED: [],
  PARTIALLY_REFUNDED: [],
};

/** Logística: solo avanza. ACCEPTED solo se alcanza por confirmación on-chain del comprador. */
export const LOGISTIC_ORDER: readonly LogisticState[] = [
  'NOT_PURCHASED',
  'PURCHASED',
  'IN_TRANSIT',
  'ARRIVED_BOLIVIA',
  'READY_FOR_DELIVERY',
  'DELIVERED',
  'ACCEPTED',
];

export const DISPUTE_TRANSITIONS: Graph<DisputeState> = {
  NONE: ['OPEN'],
  OPEN: ['UNDER_REVIEW', 'RESOLVED'],
  UNDER_REVIEW: ['RESOLVED'],
  RESOLVED: [],
};

export function canTransition<S extends string>(graph: Graph<S>, from: S, to: S): boolean {
  return (graph[from] ?? []).includes(to);
}

/** Importadora puede avanzar logística hacia adelante (se permiten saltos), nunca a ACCEPTED. */
export function canImporterSetLogistic(from: LogisticState, to: LogisticState): boolean {
  if (to === 'ACCEPTED' || to === 'NOT_PURCHASED') return false;
  return LOGISTIC_ORDER.indexOf(to) > LOGISTIC_ORDER.indexOf(from);
}
