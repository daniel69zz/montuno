import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { randomBytes } from 'crypto';
import { canonicalJson, EscrowMode } from '@montuno/shared';
import { sha256 } from '../common/crypto';
import {
  ChainEvent,
  EscrowCall,
  EscrowGatewayError,
  EventsPage,
  OnChainOrder,
  PreparedEnvelope,
  StellarEscrowGateway,
  SubmitResult,
} from './escrow-gateway';

/**
 * Ledger SIMULADO en memoria que replica las reglas del contrato Rust.
 * Solo para desarrollo y tests (ESCROW_GATEWAY=simulated); toda orden queda marcada `simulated=true`.
 * Las firmas SÍ son ed25519 reales: la "transacción" se ata a su hash y debe firmarla la cuenta fuente,
 * igual que con source-account auth en Soroban.
 */
interface SimPayload {
  v: 1;
  kind: 'simulated-escrow-tx';
  contractId: string;
  source: string;
  call: Record<string, unknown>;
  nonce: string;
  expiresAt: number;
}

export interface SimulatedSignedEnvelope {
  unsignedXdr: string;
  publicKey: string;
  signature: string; // base64 de ed25519(txHashBytes)
}

const BPS = 10_000n;
const err = (contractError: string) =>
  new EscrowGatewayError(
    'SIMULATION_FAILED',
    `El contrato rechazaría la operación: ${contractError}`,
    contractError,
  );

export class SimulatedEscrowGateway implements StellarEscrowGateway {
  readonly kind = 'simulated' as const;
  readonly contractId = 'CSIMULATED' + 'A'.repeat(46);
  readonly tokenContractId = 'CSIMTOKEN' + 'A'.repeat(47);
  private readonly orders = new Map<string, OnChainOrder>();
  private readonly balances = new Map<string, bigint>();
  private readonly events: ChainEvent[] = [];
  private readonly applied = new Set<string>();
  private ledger = 1000;
  /** Desplazamiento de reloj para tests (segundos). */
  clockOffsetSeconds = 0;

  constructor(
    readonly arbiterAddress: string,
    readonly maxAdvanceBps = 9000,
  ) {}

  private now() {
    return Math.floor(Date.now() / 1000) + this.clockOffsetSeconds;
  }

  // --- utilidades solo de simulación --------------------------------------
  mint(address: string, amount: bigint) {
    this.balances.set(address, (this.balances.get(address) ?? 0n) + amount);
  }
  async tokenBalance(address: string) {
    return this.balances.get(address) ?? 0n;
  }
  static sign(unsignedXdr: string, kp: Keypair): string {
    const hash = Buffer.from(sha256(unsignedXdr), 'hex');
    const env: SimulatedSignedEnvelope = {
      unsignedXdr,
      publicKey: kp.publicKey(),
      signature: Buffer.from(kp.sign(new Uint8Array(hash))).toString('base64'),
    };
    return Buffer.from(JSON.stringify(env)).toString('base64');
  }

  // --- puerto ---------------------------------------------------------------
  async prepare(call: EscrowCall, sourceAddress: string): Promise<PreparedEnvelope> {
    if (!StrKey.isValidEd25519PublicKey(sourceAddress))
      throw new EscrowGatewayError('INVALID_SOURCE', 'Cuenta inválida');
    // "simulación" previa: ejecuta en seco para rechazar igual que prepareTransaction.
    this.execute(call, sourceAddress, true);
    const payload: SimPayload = {
      v: 1,
      kind: 'simulated-escrow-tx',
      contractId: this.contractId,
      source: sourceAddress,
      call: JSON.parse(JSON.stringify(call, (_, v) => (typeof v === 'bigint' ? v.toString() : v))),
      nonce: randomBytes(8).toString('hex'),
      expiresAt: this.now() + 300,
    };
    const unsignedXdr = Buffer.from(canonicalJson(payload)).toString('base64');
    return {
      format: 'simulated-json',
      unsignedXdr,
      txHash: sha256(unsignedXdr),
      networkPassphrase: 'SIMULATED',
      expiresAt: new Date(payload.expiresAt * 1000),
      maxFeeStroops: '0',
    };
  }

  async submit(signedEnvelope: string, expectedTxHash: string): Promise<SubmitResult> {
    let env: SimulatedSignedEnvelope;
    let payload: SimPayload;
    try {
      env = JSON.parse(Buffer.from(signedEnvelope, 'base64').toString('utf8'));
      payload = JSON.parse(Buffer.from(env.unsignedXdr, 'base64').toString('utf8'));
    } catch {
      throw new EscrowGatewayError('INVALID_ENVELOPE', 'Sobre simulado inválido');
    }
    const hash = sha256(env.unsignedXdr);
    if (hash !== expectedTxHash)
      throw new EscrowGatewayError(
        'TX_MISMATCH',
        'La transacción firmada no corresponde a la preparada',
      );
    if (env.publicKey !== payload.source)
      throw new EscrowGatewayError('MISSING_SIGNATURE', 'Falta la firma de la cuenta fuente');
    let ok = false;
    try {
      ok = Keypair.fromPublicKey(env.publicKey).verify(
        new Uint8Array(Buffer.from(hash, 'hex')),
        new Uint8Array(Buffer.from(env.signature, 'base64')),
      );
    } catch {
      ok = false;
    }
    if (!ok) throw new EscrowGatewayError('MISSING_SIGNATURE', 'Firma inválida');
    if (this.applied.has(hash)) return { txHash: hash, status: 'SUCCESS', ledger: this.ledger }; // DUPLICATE
    if (payload.expiresAt < this.now())
      return { txHash: hash, status: 'FAILED', error: 'txTooLate' };
    const call = this.reviveCall(payload.call);
    try {
      this.ledger += 1;
      this.execute(call, payload.source, false, hash);
      this.applied.add(hash);
      return { txHash: hash, status: 'SUCCESS', ledger: this.ledger };
    } catch (e) {
      return {
        txHash: hash,
        status: 'FAILED',
        ledger: this.ledger,
        error: (e as EscrowGatewayError).contractError ?? (e as Error).message,
      };
    }
  }

  async getOrder(orderIdHex: string) {
    const o = this.orders.get(orderIdHex);
    return o ? { ...o } : null;
  }

  async getEvents(opts: { startLedger?: number; cursor?: string | null }): Promise<EventsPage> {
    const after = opts.cursor ? Number(opts.cursor) : -1;
    const start = opts.startLedger ?? 0;
    const list = this.events.filter((e, i) => i > after && e.ledger >= start);
    const lastIdx = list.length ? this.events.indexOf(list[list.length - 1]) : after;
    return { events: list, cursor: String(lastIdx), latestLedger: this.ledger, oldestLedger: 0 };
  }

  async getTransactionStatus(txHash: string) {
    return this.applied.has(txHash)
      ? { status: 'SUCCESS' as const, ledger: this.ledger }
      : { status: 'NOT_FOUND' as const };
  }

  async health() {
    return { ok: true, latestLedger: this.ledger, detail: 'SIMULATED' };
  }
  explorerTxUrl(txHash: string) {
    return `simulated://tx/${txHash}`;
  }

  // --- semántica del contrato ----------------------------------------------
  private reviveCall(c: Record<string, unknown>): EscrowCall {
    const big = (v: unknown) => BigInt(v as string);
    if (c.fn === 'create_and_fund') {
      const t = c.terms as Record<string, unknown>;
      return {
        fn: 'create_and_fund',
        orderIdHex: String(c.orderIdHex),
        buyer: String(c.buyer),
        terms: {
          importer: String(t.importer),
          arbiter: String(t.arbiter),
          token: String(t.token),
          amountTotal: big(t.amountTotal),
          advanceAmount: big(t.advanceAmount),
          mode: t.mode as EscrowMode,
          termsHashHex: String(t.termsHashHex),
          fundingDeadline: Number(t.fundingDeadline),
          fulfillmentDeadline: Number(t.fulfillmentDeadline),
        },
      };
    }
    if (c.fn === 'resolve_dispute')
      return {
        fn: 'resolve_dispute',
        orderIdHex: String(c.orderIdHex),
        refundToBuyer: big(c.refundToBuyer),
        releaseToImporter: big(c.releaseToImporter),
        resolutionHashHex: String(c.resolutionHashHex),
      };
    if (c.fn === 'open_dispute')
      return {
        fn: 'open_dispute',
        orderIdHex: String(c.orderIdHex),
        caller: String(c.caller),
        reasonHashHex: String(c.reasonHashHex),
      };
    return {
      fn: c.fn as 'claim_advance' | 'confirm_delivery_and_release',
      orderIdHex: String(c.orderIdHex),
    };
  }

  private requireAuth(signer: string, who: string) {
    if (signer !== who)
      throw new EscrowGatewayError(
        'AUTH_FAILED',
        'Error(Auth, InvalidAction): firma de la cuenta requerida ausente',
      );
  }

  private transfer(from: string, to: string, amount: bigint, dry: boolean) {
    const b = this.balances.get(from) ?? 0n;
    if (b < amount)
      throw new EscrowGatewayError(
        'SIMULATION_FAILED',
        'Saldo insuficiente del token',
        'InsufficientBalance',
      );
    if (dry) return;
    this.balances.set(from, b - amount);
    this.balances.set(to, (this.balances.get(to) ?? 0n) + amount);
  }

  private emit(
    dry: boolean,
    txHash: string | undefined,
    type: string,
    orderIdHex: string,
    data: Record<string, unknown>,
  ) {
    if (dry || !txHash) return;
    this.events.push({
      id: `${this.ledger}-${this.events.length}`,
      ledger: this.ledger,
      txHash,
      type,
      orderIdHex,
      data,
    });
  }

  private load(id: string): OnChainOrder {
    const o = this.orders.get(id);
    if (!o) throw err('OrderNotFound');
    return { ...o };
  }

  private execute(call: EscrowCall, signer: string, dry: boolean, txHash?: string) {
    const C = this.contractId;
    switch (call.fn) {
      case 'create_and_fund': {
        this.requireAuth(signer, call.buyer);
        const t = call.terms;
        if (this.orders.has(call.orderIdHex)) throw err('OrderExists');
        if (t.token !== this.tokenContractId) throw err('TokenNotAllowed');
        if (t.arbiter !== this.arbiterAddress) throw err('ArbiterNotAllowed');
        if (call.buyer === t.importer || call.buyer === t.arbiter || t.importer === t.arbiter)
          throw err('InvalidParticipants');
        if (t.amountTotal <= 0n) throw err('InvalidAmount');
        if (t.mode === 'FULL_ESCROW' && t.advanceAmount !== 0n) throw err('ModeMismatch');
        if (t.mode === 'PARTIAL_ADVANCE') {
          if (t.advanceAmount <= 0n || t.advanceAmount >= t.amountTotal)
            throw err('InvalidAdvance');
          if (t.advanceAmount * BPS > t.amountTotal * BigInt(this.maxAdvanceBps))
            throw err('InvalidAdvance');
        }
        const now = this.now();
        if (now > t.fundingDeadline) throw err('FundingDeadlinePassed');
        if (t.fulfillmentDeadline <= now || t.fulfillmentDeadline < t.fundingDeadline)
          throw err('InvalidDeadline');
        this.transfer(call.buyer, C, t.amountTotal, dry);
        if (dry) return;
        this.orders.set(call.orderIdHex, {
          orderIdHex: call.orderIdHex,
          buyer: call.buyer,
          importer: t.importer,
          arbiter: t.arbiter,
          asset: t.token,
          amountTotal: t.amountTotal,
          advanceAmount: t.advanceAmount,
          advanceReleased: 0n,
          sellerReleased: 0n,
          buyerRefunded: 0n,
          remainingEscrow: t.amountTotal,
          termsHashHex: t.termsHashHex,
          mode: t.mode,
          fundingDeadline: t.fundingDeadline,
          fulfillmentDeadline: t.fulfillmentDeadline,
          status: 'FUNDED',
          fundedAt: now,
          disputeOpenedBy: null,
          disputeReasonHashHex: null,
          resolutionHashHex: null,
        });
        this.emit(dry, txHash, 'escrow_created', call.orderIdHex, { amount_total: t.amountTotal });
        this.emit(dry, txHash, 'funded', call.orderIdHex, { amount: t.amountTotal });
        return;
      }
      case 'claim_advance': {
        const o = this.load(call.orderIdHex);
        this.requireAuth(signer, o.importer);
        if (o.mode !== 'PARTIAL_ADVANCE') throw err('AdvanceNotAllowed');
        if (o.status === 'ADVANCE_PAID') throw err('AdvanceAlreadyClaimed');
        if (o.status === 'DISPUTED') throw err('DisputeActive');
        if (o.status !== 'FUNDED') throw err('InvalidState');
        this.transfer(C, o.importer, o.advanceAmount, dry);
        if (dry) return;
        o.advanceReleased = o.advanceAmount;
        o.sellerReleased += o.advanceAmount;
        o.remainingEscrow -= o.advanceAmount;
        o.status = 'ADVANCE_PAID';
        this.orders.set(o.orderIdHex, o);
        this.emit(dry, txHash, 'advance_released', o.orderIdHex, {
          amount: o.advanceAmount,
          remaining_escrow: o.remainingEscrow,
        });
        return;
      }
      case 'confirm_delivery_and_release': {
        const o = this.load(call.orderIdHex);
        this.requireAuth(signer, o.buyer);
        if (o.status === 'DISPUTED') throw err('DisputeActive');
        if (o.status !== 'FUNDED' && o.status !== 'ADVANCE_PAID') throw err('InvalidState');
        const amount = o.remainingEscrow;
        if (amount > 0n) this.transfer(C, o.importer, amount, dry);
        if (dry) return;
        o.sellerReleased += amount;
        o.remainingEscrow = 0n;
        o.status = 'SETTLED';
        this.orders.set(o.orderIdHex, o);
        this.emit(dry, txHash, 'delivery_confirmed', o.orderIdHex, {
          released_to_importer: amount,
        });
        return;
      }
      case 'open_dispute': {
        const o = this.load(call.orderIdHex);
        if (call.caller !== o.buyer && call.caller !== o.importer) throw err('NotParticipant');
        this.requireAuth(signer, call.caller);
        if (o.status === 'DISPUTED') throw err('DisputeActive');
        if (o.status !== 'FUNDED' && o.status !== 'ADVANCE_PAID') throw err('InvalidState');
        if (dry) return;
        o.status = 'DISPUTED';
        o.disputeOpenedBy = call.caller;
        o.disputeReasonHashHex = call.reasonHashHex;
        this.orders.set(o.orderIdHex, o);
        this.emit(dry, txHash, 'dispute_opened', o.orderIdHex, {
          opened_by: call.caller,
          remaining_escrow: o.remainingEscrow,
        });
        return;
      }
      case 'resolve_dispute': {
        const o = this.load(call.orderIdHex);
        this.requireAuth(signer, o.arbiter);
        if (o.status !== 'DISPUTED') throw err('InvalidState');
        if (call.refundToBuyer < 0n || call.releaseToImporter < 0n) throw err('InvalidResolution');
        if (call.refundToBuyer + call.releaseToImporter !== o.remainingEscrow)
          throw err('InvalidResolution');
        if (dry) return;
        if (call.refundToBuyer > 0n) this.transfer(C, o.buyer, call.refundToBuyer, false);
        if (call.releaseToImporter > 0n)
          this.transfer(C, o.importer, call.releaseToImporter, false);
        o.buyerRefunded += call.refundToBuyer;
        o.sellerReleased += call.releaseToImporter;
        o.remainingEscrow = 0n;
        o.status = 'SETTLED';
        o.resolutionHashHex = call.resolutionHashHex;
        this.orders.set(o.orderIdHex, o);
        this.emit(dry, txHash, 'dispute_resolved', o.orderIdHex, {
          refund_to_buyer: call.refundToBuyer,
          release_to_importer: call.releaseToImporter,
        });
        if (call.refundToBuyer > 0n)
          this.emit(dry, txHash, 'refunded', o.orderIdHex, { amount: call.refundToBuyer });
        return;
      }
    }
  }
}
