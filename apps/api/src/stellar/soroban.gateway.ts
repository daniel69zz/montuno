import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  nativeToScVal,
  rpc,
  scValToNative,
  StrKey,
  Transaction,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { MODE_TO_U32, ONCHAIN_STATUS_BY_U32, U32_TO_MODE } from '@montuno/shared';
import type { Env } from '../config/env';
import {
  ChainEvent,
  contractErrorFromMessage,
  EscrowCall,
  EscrowGatewayError,
  EventsPage,
  OnChainOrder,
  PreparedEnvelope,
  StellarEscrowGateway,
  SubmitResult,
} from './escrow-gateway';

const HEX32 = /^[0-9a-f]{64}$/;
const bytes32 = (hex: string) => {
  if (!HEX32.test(hex)) throw new EscrowGatewayError('INVALID_ARG', 'Se esperaban 32 bytes hex');
  return xdr.ScVal.scvBytes(Buffer.from(hex, 'hex'));
};
const addr = (a: string) => new Address(a).toScVal();
const i128 = (v: bigint) => nativeToScVal(v, { type: 'i128' });
const u64 = (v: number) => nativeToScVal(BigInt(v), { type: 'u64' });

/** Struct Soroban = ScMap con claves Symbol ORDENADAS. */
function scStruct(fields: Record<string, xdr.ScVal>): xdr.ScVal {
  const entries = Object.keys(fields)
    .sort()
    .map((k) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: fields[k] }));
  return xdr.ScVal.scvMap(entries);
}

export function encodeCallArgs(call: EscrowCall): xdr.ScVal[] {
  switch (call.fn) {
    case 'create_and_fund': {
      const t = call.terms;
      return [
        bytes32(call.orderIdHex),
        addr(call.buyer),
        scStruct({
          importer: addr(t.importer),
          arbiter: addr(t.arbiter),
          token: addr(t.token),
          amount_total: i128(t.amountTotal),
          advance_amount: i128(t.advanceAmount),
          mode: xdr.ScVal.scvU32(MODE_TO_U32[t.mode]),
          terms_hash: bytes32(t.termsHashHex),
          funding_deadline: u64(t.fundingDeadline),
          fulfillment_deadline: u64(t.fulfillmentDeadline),
        }),
      ];
    }
    case 'claim_advance':
    case 'confirm_delivery_and_release':
      return [bytes32(call.orderIdHex)];
    case 'open_dispute':
      return [bytes32(call.orderIdHex), addr(call.caller), bytes32(call.reasonHashHex)];
    case 'resolve_dispute':
      return [
        bytes32(call.orderIdHex),
        i128(call.refundToBuyer),
        i128(call.releaseToImporter),
        bytes32(call.resolutionHashHex),
      ];
  }
}

const hexOrNull = (v: unknown) => (v == null ? null : Buffer.from(v as Uint8Array).toString('hex'));

export function decodeOrder(native: Record<string, unknown>): OnChainOrder {
  return {
    orderIdHex: Buffer.from(native.order_id as Uint8Array).toString('hex'),
    buyer: String(native.buyer),
    importer: String(native.importer),
    arbiter: String(native.arbiter),
    asset: String(native.asset),
    amountTotal: BigInt(native.amount_total as bigint),
    advanceAmount: BigInt(native.advance_amount as bigint),
    advanceReleased: BigInt(native.advance_released as bigint),
    sellerReleased: BigInt(native.seller_released as bigint),
    buyerRefunded: BigInt(native.buyer_refunded as bigint),
    remainingEscrow: BigInt(native.remaining_escrow as bigint),
    termsHashHex: Buffer.from(native.terms_hash as Uint8Array).toString('hex'),
    mode: U32_TO_MODE[Number(native.mode)],
    fundingDeadline: Number(native.funding_deadline),
    fulfillmentDeadline: Number(native.fulfillment_deadline),
    status: ONCHAIN_STATUS_BY_U32[Number(native.status)] as OnChainOrder['status'],
    fundedAt: Number(native.funded_at),
    disputeOpenedBy: native.dispute_opened_by == null ? null : String(native.dispute_opened_by),
    disputeReasonHashHex: hexOrNull(native.dispute_reason_hash),
    resolutionHashHex: hexOrNull(native.resolution_hash),
  };
}

export class SorobanEscrowGateway implements StellarEscrowGateway {
  readonly kind = 'soroban' as const;
  readonly contractId: string;
  readonly tokenContractId: string;
  readonly arbiterAddress: string;
  readonly maxAdvanceBps: number;
  private readonly server: rpc.Server;
  private readonly passphrase: string;

  constructor(private readonly env: Env) {
    this.contractId = env.STELLAR_ESCROW_CONTRACT_ID;
    this.tokenContractId = env.STELLAR_ESCROW_TOKEN_CONTRACT_ID;
    this.arbiterAddress = env.STELLAR_ARBITER_ADDRESS;
    this.maxAdvanceBps = env.STELLAR_MAX_ADVANCE_BPS;
    this.passphrase = env.STELLAR_NETWORK_PASSPHRASE;
    this.server = new rpc.Server(env.STELLAR_RPC_URL, {
      allowHttp: env.STELLAR_RPC_URL.startsWith('http://'),
    });
  }

  async prepare(call: EscrowCall, sourceAddress: string): Promise<PreparedEnvelope> {
    if (!StrKey.isValidEd25519PublicKey(sourceAddress))
      throw new EscrowGatewayError(
        'INVALID_SOURCE',
        'La cuenta firmante debe ser una cuenta G... válida',
      );
    let account: Account;
    try {
      account = await this.server.getAccount(sourceAddress);
    } catch {
      throw new EscrowGatewayError(
        'ACCOUNT_NOT_FOUND',
        `La cuenta ${sourceAddress} no existe en Testnet (fondéala con friendbot)`,
      );
    }
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.passphrase,
    })
      .addOperation(new Contract(this.contractId).call(call.fn, ...encodeCallArgs(call)))
      .setTimeout(this.env.STELLAR_TX_TIMEOUT_SECONDS)
      .build();
    let prepared: Transaction;
    try {
      // Simula, añade footprint/recursos y las auth entries (source-account auth del firmante).
      prepared = (await this.server.prepareTransaction(tx)) as Transaction;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const ce = contractErrorFromMessage(msg);
      throw new EscrowGatewayError(
        'SIMULATION_FAILED',
        ce
          ? `El contrato rechazaría la operación: ${ce}`
          : `Simulación fallida: ${msg.slice(0, 300)}`,
        ce,
      );
    }
    const maxTime = Number(prepared.timeBounds?.maxTime ?? 0);
    return {
      format: 'stellar-xdr',
      unsignedXdr: prepared.toXDR(),
      txHash: Buffer.from(prepared.hash()).toString('hex'),
      networkPassphrase: this.passphrase,
      expiresAt: new Date(maxTime * 1000),
      maxFeeStroops: prepared.fee,
    };
  }

  async submit(signedEnvelope: string, expectedTxHash: string): Promise<SubmitResult> {
    let tx: Transaction;
    try {
      const parsed = TransactionBuilder.fromXDR(signedEnvelope, this.passphrase);
      if (!(parsed instanceof Transaction)) throw new Error('fee-bump no soportado en el MVP');
      tx = parsed;
    } catch (e) {
      throw new EscrowGatewayError('INVALID_ENVELOPE', `XDR inválido: ${(e as Error).message}`);
    }
    const hash = tx.hash();
    if (Buffer.from(hash).toString('hex') !== expectedTxHash)
      throw new EscrowGatewayError(
        'TX_MISMATCH',
        'La transacción firmada no corresponde a la preparada (argumentos distintos)',
      );
    // Verificación previa de la firma del firmante esperado (la red la verifica igualmente).
    const kp = Keypair.fromPublicKey(tx.source);
    const signed = tx.signatures.some((s) => {
      try {
        return kp.verify(hash, s.signature);
      } catch {
        return false;
      }
    });
    if (!signed)
      throw new EscrowGatewayError('MISSING_SIGNATURE', 'Falta la firma de la cuenta fuente');

    const txHash = Buffer.from(hash).toString('hex');
    let sent;
    try {
      sent = await this.server.sendTransaction(tx);
    } catch {
      // El RPC puede cortar por timeout DESPUÉS de recibir la tx: nunca asumir que no se envió.
      const st = await this.getTransactionStatus(txHash).catch(() => ({
        status: 'NOT_FOUND' as const,
        ledger: undefined,
      }));
      if (st.status === 'NOT_FOUND') return { txHash, status: 'PENDING' };
      return {
        txHash,
        status: st.status,
        ledger: st.ledger,
        error: st.status === 'FAILED' ? 'Transacción fallida on-chain' : undefined,
      };
    }
    if (sent.status === 'ERROR' || sent.status === 'TRY_AGAIN_LATER') {
      return {
        txHash: sent.hash,
        status: 'FAILED',
        error: `sendTransaction: ${sent.status} ${sent.errorResult?.result.type ?? ''}`.trim(),
      };
    }
    let res;
    try {
      res = await this.server.pollTransaction(sent.hash, { attempts: 30 });
    } catch {
      return { txHash: sent.hash, status: 'PENDING' };
    }
    if (res.status === rpc.Api.GetTransactionStatus.SUCCESS)
      return { txHash: sent.hash, status: 'SUCCESS', ledger: res.ledger };
    if (res.status === rpc.Api.GetTransactionStatus.FAILED) {
      const diag = (res.diagnosticEventsXdr ?? []).map((d) => d.toXDR('base64')).join(',');
      return {
        txHash: sent.hash,
        status: 'FAILED',
        ledger: res.ledger,
        error: contractErrorFromMessage(diag) ?? 'Transacción fallida on-chain',
      };
    }
    return { txHash: sent.hash, status: 'PENDING' };
  }

  async getTransactionStatus(txHash: string) {
    const r = await this.server.getTransaction(txHash);
    if (r.status === rpc.Api.GetTransactionStatus.SUCCESS)
      return { status: 'SUCCESS' as const, ledger: r.ledger };
    if (r.status === rpc.Api.GetTransactionStatus.FAILED)
      return { status: 'FAILED' as const, ledger: r.ledger };
    return { status: 'NOT_FOUND' as const };
  }

  async getOrder(orderIdHex: string): Promise<OnChainOrder | null> {
    const native = await this.read('get_order', [bytes32(orderIdHex)], true);
    return native == null ? null : decodeOrder(native as Record<string, unknown>);
  }

  async tokenBalance(address: string): Promise<bigint> {
    const v = await this.readContract(this.tokenContractId, 'balance', [addr(address)], false);
    return BigInt(v as bigint);
  }

  private read(fn: string, args: xdr.ScVal[], nullOnNotFound: boolean) {
    return this.readContract(this.contractId, fn, args, nullOnNotFound);
  }

  /** Lectura por simulación (no envía nada, no requiere firma). */
  private async readContract(
    contractId: string,
    fn: string,
    args: xdr.ScVal[],
    nullOnNotFound: boolean,
  ): Promise<unknown> {
    const source = new Account(this.arbiterAddress, '0');
    const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: this.passphrase })
      .addOperation(new Contract(contractId).call(fn, ...args))
      .setTimeout(30)
      .build();
    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
      if (nullOnNotFound && contractErrorFromMessage(sim.error) === 'OrderNotFound') return null;
      throw new EscrowGatewayError(
        'READ_FAILED',
        `Lectura ${fn} fallida: ${sim.error.slice(0, 300)}`,
      );
    }
    if (!rpc.Api.isSimulationSuccess(sim) || !sim.result)
      throw new EscrowGatewayError('READ_FAILED', `Lectura ${fn} sin resultado`);
    return scValToNative(sim.result.retval);
  }

  async getEvents(opts: { startLedger?: number; cursor?: string | null }): Promise<EventsPage> {
    const filters: rpc.Api.EventFilter[] = [{ type: 'contract', contractIds: [this.contractId] }];
    const resp = opts.cursor
      ? await this.server.getEvents({ filters, cursor: opts.cursor, limit: 100 })
      : await this.server.getEvents({
          filters,
          startLedger: opts.startLedger ?? (await this.server.getLatestLedger()).sequence - 1000,
          limit: 100,
        });
    const events: ChainEvent[] = resp.events.map((e) => {
      const topics = e.topic.map((t) => scValToNative(t));
      const type = typeof topics[0] === 'string' ? topics[0] : String(topics[0]);
      const orderIdHex =
        topics[1] instanceof Uint8Array || Buffer.isBuffer(topics[1])
          ? Buffer.from(topics[1] as Uint8Array).toString('hex')
          : null;
      let data: Record<string, unknown> = {};
      try {
        const v = scValToNative(e.value);
        data = v && typeof v === 'object' ? (v as Record<string, unknown>) : { value: v };
      } catch {
        data = {};
      }
      return { id: e.id, ledger: e.ledger, txHash: e.txHash, type, orderIdHex, data };
    });
    return {
      events,
      cursor: resp.cursor,
      latestLedger: resp.latestLedger,
      oldestLedger: (resp as { oldestLedger?: number }).oldestLedger,
    };
  }

  async health() {
    try {
      const h = await this.server.getHealth();
      return { ok: h.status === 'healthy', latestLedger: h.latestLedger };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }

  explorerTxUrl(txHash: string) {
    return `${this.env.STELLAR_EXPLORER_BASE_URL}/tx/${/^[0-9a-f]{64}$/.test(txHash) ? txHash : ''}`;
  }
}

/** Ayuda para clientes/tests: firma un XDR preparado con una keypair local (NUNCA en el servidor). */
export function signPreparedXdr(unsignedXdr: string, passphrase: string, kp: Keypair): string {
  const tx = TransactionBuilder.fromXDR(unsignedXdr, passphrase) as Transaction;
  tx.sign(kp);
  return tx.toXDR();
}
