// Tipos de las respuestas REALES de la API (ver apps/api). Montos atómicos como string (bigint).

export type EscrowMode = 'FULL_ESCROW' | 'PARTIAL_ADVANCE';
export type Engine = 'MONTUNO' | 'TRUSTLESS_WORK';

export interface AppConfig {
  network: string;
  networkPassphrase: string;
  escrow: { contractId: string; tokenContractId: string; tokenDecimals: number; simulated: boolean };
  explorerBaseUrl: string;
  auth: { methods: string[]; challengeEndpoint: string; sessionEndpoint: string; signature: 'sep53' };
  escrowEngines: { id: Engine; label: string; modes: EscrowMode[]; beta: boolean }[];
  ramp: { provider: 'mock' | 'caja-testnet'; fiatPaymentSimulated: boolean; deliversRealTestnetToken: boolean };
  pollar: { apiKey: string; stellarNetwork: 'testnet' | 'mainnet' } | null;
}

export interface Me {
  id: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  roles: string[];
  memberships: { importerId: string; role: 'OWNER' | 'OPERATOR' }[];
  wallets: { id: string; address: string; network: string; provider: string; verified: boolean }[];
}

export interface Importer {
  id: string;
  publicName: string;
  nit: string | null;
  status: 'PENDING' | 'VERIFIED' | 'SUSPENDED';
  walletAddress: string | null;
  limits: { maxOrderAmountAtomic: string; maxAdvanceBps: number; allowedModes: EscrowMode[] };
  myRole?: 'OWNER' | 'OPERATOR';
}

export interface CatalogItem {
  id: string;
  title: string;
  category: string;
  description: string;
  referencePrice: { amount: string; currency: 'BOB' | 'USD' };
  referenceUrl: string | null;
  deliveryEstimateDays: number;
  active: boolean;
  provider?: { id: string; publicName: string };
}

export interface Provider {
  id: string;
  publicName: string;
  offersAdvance: boolean;
  catalogItems: number;
  completedOrders: number;
  memberSince: string;
  items?: CatalogItem[];
}

export interface QuoteRequest {
  id: string;
  status: 'OPEN' | 'QUOTED' | 'CLOSED';
  details: string;
  quantity: number;
  destinationCity: string;
  productUrl: string | null;
  catalogItem: { id: string; title: string } | null;
  provider?: { id: string; publicName: string };
  checkoutToken?: string | null;
  createdAt: string;
}

export interface CheckoutView {
  status: string;
  redeemed: boolean;
  importer: { publicName: string; verified: boolean };
  product: { name: string; variant: string | null; url: string; quantity: number };
  destinationCity: string;
  deliveryEstimateDays: number;
  purchaseTerms: string;
  price: {
    fiat: { amount: string; currency: string };
    fx: { rate: string; spreadBps: number; source: string; expiresAt: string } | null;
    token: { amountAtomic: string; display: string; decimals: number; symbol: string };
    fees: { serviceFeeAtomic: string; rampFeeAtomic: string; includedInTotal: boolean };
  };
  escrow: {
    mode: EscrowMode;
    engine: Engine;
    advanceAmountAtomic: string;
    advanceBps: number;
    protectedAmountAtomic: string;
    fulfillmentDeadline: string;
    network: string;
    simulated: boolean;
  };
  riskDisclosure: { version: string; text: string; hash: string };
  termsHash: string;
  expiresAt: string;
}

export interface OrderView {
  id: string;
  quoteId: string;
  importerId: string;
  engine: Engine;
  summary: { code: string; label: string };
  states: { payment: string; logistic: string; dispute: string; onchain: string };
  product?: { name: string; variant: string | null; url: string; quantity: number; destinationCity: string; deliveryEstimateDays: number; fiat: { amount: string; currency: string } };
  provider?: { id: string; publicName: string };
  escrow: {
    mode: EscrowMode;
    network: string;
    contractId: string;
    tokenContractId: string;
    onchainOrderId: string;
    termsHash: string;
    simulated: boolean;
    amountAtomic: string;
    advanceAmountAtomic: string;
    projection: { advanceReleasedAtomic: string; sellerReleasedAtomic: string; buyerRefundedAtomic: string; remainingEscrowAtomic: string; lastSyncedAt: string | null };
    maxRecoverableByBuyerAtomic: string;
  };
  wallets?: { buyer: string; importer: string; arbiter: string };
  fundingDeadline: string;
  fulfillmentDeadline: string;
  tracking: { carrier: string | null; number: string; note: string } | null;
  history?: { id: string; kind: string; from: string | null; to: string; note: string | null; createdAt: string }[];
  myRoles?: { buyer: boolean; importer: boolean; arbiter: boolean; admin: boolean };
  createdAt: string;
  updatedAt?: string;
}

export interface Prepared {
  preparedId: string;
  action: string;
  format: 'stellar-xdr' | 'simulated-json';
  unsignedXdr: string;
  txHash: string;
  networkPassphrase: string;
  expiresAt: string;
  signer: { role: string; address: string };
  step?: string;
  stepsRemaining?: string[];
  releasesToImporterAtomic?: string;
}

export interface SubmitResult {
  preparedId: string;
  action: string;
  status: 'CONFIRMED' | 'SUBMITTED' | 'FAILED' | 'PREPARED';
  txHash: string;
  ledger: number | null;
  explorerUrl: string;
  error?: string | null;
  order: { paymentState: string; onchainStatus: string; remainingEscrowAtomic: string };
}

export interface Dispute {
  id: string;
  status: string;
  openedByRole: string;
  reason: string;
  onchainConfirmedAt: string | null;
  resolution: string | null;
  createdAt: string;
}

export interface Evidence {
  id: string;
  type: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  downloadUrl: string;
  createdAt: string;
}
