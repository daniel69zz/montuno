import {
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
} from '@stellar/stellar-sdk';
import type { Env } from '../config/env';
import { EscrowGatewayError } from './escrow-gateway';

/** Puerto: entrega de tokens desde la caja de la rampa simulada de testnet. */
export const TOKEN_SENDER = Symbol('TOKEN_SENDER');
export interface TokenSender {
  readonly cajaAddress: string;
  balanceOf(address: string): Promise<bigint>;
  /** true si la cuenta puede recibir el token (trustline del USDC clásico detrás del SAC). */
  canReceive(address: string): Promise<boolean>;
  send(
    destination: string,
    amountAtomic: bigint,
  ): Promise<{
    txHash: string;
    status: 'SUCCESS' | 'FAILED' | 'PENDING';
    ledger?: number;
    error?: string;
  }>;
}

/**
 * Caja de TESTNET (patrón WorkVille `pagarDesdeCaja`): transfiere USDC de Circle de testnet con el SAC
 * `transfer(caja, destino, monto)`. Es la única clave del servidor y solo firma transferencias DESDE la caja.
 * La validación de entorno impide usarla fuera de testnet o en production.
 */
export class SorobanCajaSender implements TokenSender {
  readonly cajaAddress: string;
  private readonly kp: Keypair;
  private readonly server: rpc.Server;

  constructor(private readonly env: Env) {
    if (env.STELLAR_NETWORK !== 'testnet' || env.NODE_ENV === 'production')
      throw new Error('La caja solo existe en testnet');
    this.kp = Keypair.fromSecret(env.RAMP_CAJA_SECRET);
    this.cajaAddress = this.kp.publicKey();
    this.server = new rpc.Server(env.STELLAR_RPC_URL);
  }

  private async simulate(fn: string, args: ReturnType<typeof nativeToScVal>[], source: string) {
    const acc = await this.server.getAccount(source);
    const tx = new TransactionBuilder(acc, {
      fee: BASE_FEE,
      networkPassphrase: this.env.STELLAR_NETWORK_PASSPHRASE,
    })
      .addOperation(new Contract(this.env.STELLAR_ESCROW_TOKEN_CONTRACT_ID).call(fn, ...args))
      .setTimeout(60)
      .build();
    return { tx, sim: await this.server.simulateTransaction(tx) };
  }

  async balanceOf(address: string): Promise<bigint> {
    const { sim } = await this.simulate(
      'balance',
      [new Address(address).toScVal()],
      this.cajaAddress,
    );
    if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) return 0n; // sin trustline el SAC falla: saldo 0
    return BigInt(scValToNative(sim.result.retval) as bigint);
  }

  async canReceive(address: string): Promise<boolean> {
    if (!StrKey.isValidEd25519PublicKey(address)) return false;
    // transferir 1 unidad en SIMULACIÓN: falla si el destino no tiene trustline (no se envía nada).
    const { sim } = await this.simulate(
      'transfer',
      [
        new Address(this.cajaAddress).toScVal(),
        new Address(address).toScVal(),
        nativeToScVal(1n, { type: 'i128' }),
      ],
      this.cajaAddress,
    );
    return !rpc.Api.isSimulationError(sim);
  }

  async send(destination: string, amountAtomic: bigint) {
    if (amountAtomic <= 0n) throw new EscrowGatewayError('INVALID_AMOUNT', 'Monto inválido');
    if (destination === this.cajaAddress)
      throw new EscrowGatewayError('INVALID_DESTINATION', 'La caja no se paga a sí misma');
    const acc = await this.server.getAccount(this.cajaAddress);
    const built = new TransactionBuilder(acc, {
      fee: BASE_FEE,
      networkPassphrase: this.env.STELLAR_NETWORK_PASSPHRASE,
    })
      .addOperation(
        new Contract(this.env.STELLAR_ESCROW_TOKEN_CONTRACT_ID).call(
          'transfer',
          new Address(this.cajaAddress).toScVal(),
          new Address(destination).toScVal(),
          nativeToScVal(amountAtomic, { type: 'i128' }),
        ),
      )
      .setTimeout(120)
      .build();
    let tx: Transaction;
    try {
      tx = (await this.server.prepareTransaction(built)) as Transaction;
    } catch (e) {
      throw new EscrowGatewayError(
        'CAJA_TRANSFER_REJECTED',
        `La caja no pudo preparar la transferencia: ${(e as Error).message.slice(0, 200)}`,
      );
    }
    tx.sign(this.kp);
    const txHash = Buffer.from(tx.hash()).toString('hex');
    try {
      const sent = await this.server.sendTransaction(tx);
      if (sent.status === 'ERROR' || sent.status === 'TRY_AGAIN_LATER')
        return { txHash, status: 'FAILED' as const, error: `sendTransaction ${sent.status}` };
      const r = await this.server.pollTransaction(txHash, { attempts: 30 });
      if (r.status === rpc.Api.GetTransactionStatus.SUCCESS)
        return { txHash, status: 'SUCCESS' as const, ledger: r.ledger };
      if (r.status === rpc.Api.GetTransactionStatus.FAILED)
        return {
          txHash,
          status: 'FAILED' as const,
          ledger: r.ledger,
          error: 'transferencia fallida on-chain',
        };
      return { txHash, status: 'PENDING' as const };
    } catch {
      return { txHash, status: 'PENDING' as const }; // se resuelve consultando el hash, nunca re-pagando
    }
  }
}
