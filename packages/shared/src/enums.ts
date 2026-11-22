// Enums de dominio compartibles con una futura UI.

export const EscrowMode = {
  FULL_ESCROW: 'FULL_ESCROW',
  PARTIAL_ADVANCE: 'PARTIAL_ADVANCE',
} as const;
export type EscrowMode = (typeof EscrowMode)[keyof typeof EscrowMode];

export const QuoteStatus = {
  DRAFT: 'DRAFT',
  SENT: 'SENT',
  ACCEPTED: 'ACCEPTED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;
export type QuoteStatus = (typeof QuoteStatus)[keyof typeof QuoteStatus];

export const PaymentState = {
  NOT_STARTED: 'NOT_STARTED',
  RAMP_PENDING: 'RAMP_PENDING',
  WALLET_FUNDED: 'WALLET_FUNDED',
  ESCROW_PENDING: 'ESCROW_PENDING',
  ESCROW_FUNDED: 'ESCROW_FUNDED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
} as const;
export type PaymentState = (typeof PaymentState)[keyof typeof PaymentState];

export const LogisticState = {
  NOT_PURCHASED: 'NOT_PURCHASED',
  PURCHASED: 'PURCHASED',
  IN_TRANSIT: 'IN_TRANSIT',
  ARRIVED_BOLIVIA: 'ARRIVED_BOLIVIA',
  READY_FOR_DELIVERY: 'READY_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  ACCEPTED: 'ACCEPTED',
} as const;
export type LogisticState = (typeof LogisticState)[keyof typeof LogisticState];

export const DisputeState = {
  NONE: 'NONE',
  OPEN: 'OPEN',
  UNDER_REVIEW: 'UNDER_REVIEW',
  RESOLVED: 'RESOLVED',
} as const;
export type DisputeState = (typeof DisputeState)[keyof typeof DisputeState];

/** Estados del contrato Soroban (mismo orden que el enum `Status` en Rust, repr u32). */
export const OnchainStatus = {
  NONE: 'NONE', // la orden aún no existe en el contrato
  FUNDED: 'FUNDED',
  ADVANCE_PAID: 'ADVANCE_PAID',
  DISPUTED: 'DISPUTED',
  SETTLED: 'SETTLED',
  CANCELLED: 'CANCELLED',
} as const;
export type OnchainStatus = (typeof OnchainStatus)[keyof typeof OnchainStatus];
export const ONCHAIN_STATUS_BY_U32: OnchainStatus[] = [
  OnchainStatus.FUNDED,
  OnchainStatus.ADVANCE_PAID,
  OnchainStatus.DISPUTED,
  OnchainStatus.SETTLED,
  OnchainStatus.CANCELLED,
];
export const MODE_TO_U32: Record<EscrowMode, number> = { FULL_ESCROW: 0, PARTIAL_ADVANCE: 1 };
export const U32_TO_MODE: EscrowMode[] = [EscrowMode.FULL_ESCROW, EscrowMode.PARTIAL_ADVANCE];

export const Role = {
  BUYER: 'BUYER',
  IMPORTER_OWNER: 'IMPORTER_OWNER',
  IMPORTER_OPERATOR: 'IMPORTER_OPERATOR',
  ADMIN: 'ADMIN',
  ARBITER: 'ARBITER',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const EscrowAction = {
  CREATE_AND_FUND: 'create_and_fund',
  CLAIM_ADVANCE: 'claim_advance',
  CONFIRM_DELIVERY: 'confirm_delivery_and_release',
  OPEN_DISPUTE: 'open_dispute',
  RESOLVE_DISPUTE: 'resolve_dispute',
  CANCEL_BY_AGREEMENT: 'cancel_by_agreement',
} as const;
export type EscrowAction = (typeof EscrowAction)[keyof typeof EscrowAction];

export const EscrowEventType = {
  ESCROW_CREATED: 'escrow_created',
  FUNDED: 'funded',
  ADVANCE_RELEASED: 'advance_released',
  DELIVERY_CONFIRMED: 'delivery_confirmed',
  DISPUTE_OPENED: 'dispute_opened',
  DISPUTE_RESOLVED: 'dispute_resolved',
  REFUNDED: 'refunded',
  CANCELLED: 'cancelled',
} as const;
export type EscrowEventType = (typeof EscrowEventType)[keyof typeof EscrowEventType];
