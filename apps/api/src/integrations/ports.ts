// Puertos internos (guía §8). NO son afirmaciones sobre la API de Pollar.

export interface VerifiedIdentity {
  provider: string;
  subject: string; // email normalizado o address G...
  email?: string;
  walletAddress?: string;
  simulated: boolean;
}

export interface IdentityProvider {
  readonly id: string;
  verifySessionOrWalletProof(input: unknown): Promise<VerifiedIdentity>;
}

export type KycState = 'none' | 'pending' | 'approved' | 'rejected' | 'expired';
export interface KycRequirements {
  corridorId: string | null;
  required: boolean;
  level: string | null;
  steps: string[];
  simulated: boolean;
}
export interface VerificationStart {
  status: KycState;
  providerReference: string;
  redirectUrl: string | null;
  simulated: boolean;
}
export interface KycProvider {
  readonly id: string;
  getRequirements(userId: string, corridorId?: string): Promise<KycRequirements>;
  getStatus(userId: string, corridorId?: string): Promise<KycState>;
  startVerification(userId: string, corridorId?: string): Promise<VerificationStart>;
}

export interface RampRouteInput {
  country: string;
  fiatCurrency: string;
  network: string;
  tokenContractId: string;
}
export interface RampRoute {
  id: string;
  provider: string;
  fiatCurrency: string;
  asset: string;
  network: string;
  kycRequired: boolean;
  available: boolean;
  simulated: boolean;
  note?: string;
}
export interface RampQuoteInput {
  routeId: string;
  targetAtomic: bigint;
  tokenDecimals: number;
  destinationWallet: string;
}
export interface RampQuote {
  routeId: string;
  provider: string;
  fiatAmount: string; // decimal string
  fiatCurrency: string;
  rate: string;
  spreadBps: number;
  feeFiat: string;
  deliversAtomic: bigint;
  expiresAt: Date;
  simulated: boolean;
}
export interface StartRampInput {
  quote: RampQuote;
  orderId: string;
  destinationWallet: string;
}
export interface RampSession {
  externalId: string;
  status: 'PENDING';
  paymentInstructions: Record<string, string>;
  simulated: boolean;
}
export type RampState = 'PENDING' | 'COMPLETED' | 'FAILED' | 'EXPIRED';
export interface RampProvider {
  readonly id: string;
  listAvailableRoutes(input: RampRouteInput): Promise<RampRoute[]>;
  getQuote(input: RampQuoteInput): Promise<RampQuote>;
  start(input: StartRampInput): Promise<RampSession>;
  getStatus(externalId: string): Promise<RampState>;
}

export const KYC_PROVIDER = Symbol('KYC_PROVIDER');
export const RAMP_PROVIDER = Symbol('RAMP_PROVIDER');
