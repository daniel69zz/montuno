import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../common/prisma.service';
import { EscrowService } from '../escrow/escrow.service';
import { QuotesService } from '../quotes/quotes.service';
import { RampsService } from '../ramps/ramps.service';
import { ESCROW_GATEWAY, StellarEscrowGateway } from '../stellar/escrow-gateway';

const LOCKS = { indexer: 71_001, reconcile: 71_002, expiry: 71_003 };

/**
 * Workers en proceso con lock asesor de Postgres (una sola instancia ejecuta cada job a la vez).
 * Patrón preparado para migrar a BullMQ (REDIS_URL) sin cambiar la lógica: cada job es un método idempotente.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Jobs');
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly escrow: EscrowService,
    private readonly quotes: QuotesService,
    private readonly ramps: RampsService,
    @Inject(ESCROW_GATEWAY) private readonly gateway: StellarEscrowGateway,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap() {
    if (!this.env.JOBS_ENABLED) return;
    this.timers.push(
      setInterval(
        () => void this.withLock('indexer', () => this.indexEvents()),
        this.env.JOBS_INDEXER_INTERVAL_MS,
      ),
    );
    this.timers.push(
      setInterval(
        () => void this.withLock('reconcile', () => this.reconcile()),
        this.env.JOBS_RECONCILE_INTERVAL_MS,
      ),
    );
    this.timers.push(
      setInterval(
        () => void this.withLock('expiry', () => this.quotes.expireStale()),
        this.env.JOBS_RECONCILE_INTERVAL_MS,
      ),
    );
    this.log.log(JSON.stringify({ msg: 'jobs_started', gateway: this.gateway.kind }));
  }
  onModuleDestroy() {
    this.timers.forEach(clearInterval);
  }

  async withLock<T>(name: keyof typeof LOCKS, fn: () => Promise<T>): Promise<T | undefined> {
    const [{ locked }] = await this.prisma.$queryRaw<
      { locked: boolean }[]
    >`SELECT pg_try_advisory_lock(${LOCKS[name]}) AS locked`;
    if (!locked) return undefined;
    try {
      return await fn();
    } catch (e) {
      this.log.error(JSON.stringify({ msg: 'job_failed', job: name, error: (e as Error).message }));
      return undefined;
    } finally {
      await this.prisma.$queryRaw`SELECT pg_advisory_unlock(${LOCKS[name]})`;
    }
  }

  /**
   * EscrowIndexer: lee eventos del contrato por checkpoint (cursor RPC), valida contrato/orden, registra
   * EscrowTransaction con clave única (tx:evento) y re-proyecta desde get_order. Si el checkpoint quedó
   * fuera de la ventana de retención del RPC, reinicia desde el ledger más antiguo disponible y la
   * conciliación cubre cualquier hueco leyendo el estado actual de cada orden activa.
   */
  async indexEvents() {
    const id = `escrow:${this.gateway.contractId}`;
    const cp = await this.prisma.indexerCheckpoint.findUnique({ where: { id } });
    let page;
    try {
      page = cp?.cursor
        ? await this.gateway.getEvents({ cursor: cp.cursor })
        : await this.gateway.getEvents({ startLedger: cp?.lastLedger });
    } catch (e) {
      // típico: cursor/ledger fuera de retención => reinicio desde el más antiguo disponible
      this.log.warn(
        JSON.stringify({ msg: 'indexer_restart_from_retention', error: (e as Error).message }),
      );
      page = await this.gateway.getEvents({});
    }
    let applied = 0;
    const touched = new Set<string>();
    for (const ev of page.events) {
      if (!ev.orderIdHex) continue;
      const order = await this.prisma.order.findUnique({
        where: { onchainOrderId: ev.orderIdHex },
      });
      if (!order || order.escrowContractId !== this.gateway.contractId) continue;
      const amount = typeof ev.data.amount === 'bigint' ? ev.data.amount : null;
      await this.escrow.recordTx(
        order.id,
        ev.txHash,
        ev.type,
        amount,
        ev.ledger,
        'indexer',
        order.network,
      );
      touched.add(order.id);
      applied++;
    }
    for (const orderId of touched) await this.escrow.syncFromChain(orderId, 'indexer');
    const lastLedger = page.events.at(-1)?.ledger ?? cp?.lastLedger ?? page.latestLedger;
    await this.prisma.indexerCheckpoint.upsert({
      where: { id },
      create: { id, lastLedger, cursor: page.cursor },
      update: { lastLedger, cursor: page.cursor },
    });
    return { events: page.events.length, applied };
  }

  /** Reconciliation: compara BD vs contrato y repara estados derivados. NUNCA transfiere fondos. */
  async reconcile() {
    const candidates = await this.prisma.order.findMany({
      where: {
        OR: [
          { paymentState: { in: ['ESCROW_PENDING', 'WALLET_FUNDED', 'RAMP_PENDING', 'FAILED'] } },
          {
            paymentState: 'ESCROW_FUNDED',
            onchainStatus: { in: ['NONE', 'FUNDED', 'ADVANCE_PAID', 'DISPUTED'] },
          },
        ],
      },
      take: 200,
      orderBy: { updatedAt: 'asc' },
    });
    let repaired = 0;
    for (const o of candidates) {
      const before = `${o.paymentState}|${o.onchainStatus}|${o.remainingEscrowAtomic}`;
      const after = await this.escrow.syncFromChain(o.id, 'reconciliation');
      if (`${after.paymentState}|${after.onchainStatus}|${after.remainingEscrowAtomic}` !== before)
        repaired++;
    }
    // Transacciones SUBMITTED sin resultado (timeout del RPC) y entregas de rampa en PROCESSING: por hash.
    const submitted = await this.escrow.resolveSubmitted();
    const deliveries = await this.ramps.reconcileDeliveries();
    await this.prisma.preparedTransaction.updateMany({
      where: { status: 'PREPARED', expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    });
    return { checked: candidates.length, repaired, submitted, deliveries };
  }
}
