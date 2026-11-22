/**
 * Servidor FALSO de la Core API v2 de Trustless Work (solo single-release), fiel a los esquemas documentados:
 * cada escritura devuelve { unsignedXdr, txHash, contractId? } con un XDR de Stellar REAL armado para el firmante,
 * y POST /stellar/send-transaction aplica la acción solo si el XDR está firmado por esa cuenta.
 */
import {
  Account,
  BASE_FEE,
  Keypair,
  Operation,
  StrKey,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { randomBytes } from 'crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';

const PASSPHRASE = 'Test SDF Network ; September 2015';
type Escrow = {
  contractId: string;
  amount: number;
  balance: number;
  platformFee: number;
  trustline: { contractId: string };
  roles: Record<string, unknown>;
  milestones: {
    description: string;
    status: string;
    approvals: { target: number; approvalCount: number; approvedBy: string[] };
  }[];
  dispute: { isDisputed: boolean; reason?: string; resolved: boolean };
  released: boolean;
};

export class FakeTrustlessWork {
  escrows = new Map<string, Escrow>();
  pending = new Map<string, { signer: string; apply: () => { contractId?: string } }>();
  calls: { path: string; body: Record<string, unknown> }[] = [];
  apiKeys = new Set<string>();
  overrideReceiver?: string;
  private server?: Server;

  start(port = 47811) {
    this.server = createServer((req, res) => void this.handle(req, res));
    return new Promise<void>((r) => this.server!.listen(port, '127.0.0.1', () => r()));
  }
  stop() {
    return new Promise<void>((r) => this.server?.close(() => r()));
  }

  private unsigned(signer: string, apply: () => { contractId?: string }, contractId?: string) {
    const tx = new TransactionBuilder(
      new Account(signer, String(Math.floor(Math.random() * 1e9))),
      { fee: BASE_FEE, networkPassphrase: PASSPHRASE },
    )
      .addOperation(Operation.manageData({ name: 'tw', value: randomBytes(8).toString('hex') }))
      .setTimeout(300)
      .build();
    const txHash = Buffer.from(tx.hash()).toString('hex');
    this.pending.set(txHash, { signer, apply });
    return { unsignedXdr: tx.toXDR(), txHash, contractId: contractId ?? null };
  }

  private bad(res: ServerResponse, status: number, message: string) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 'VALIDATION_ERROR', message }));
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    const url = req.url ?? '';
    this.calls.push({ path: `${req.method} ${url}`, body });
    if (req.headers['x-api-key'] !== 'test-tw-key.secret')
      return this.bad(res, 401, 'invalid api key');
    const ok = (data: unknown) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    const e = (id: string) => this.escrows.get(id);

    if (req.method === 'GET' && url.startsWith('/escrow/single-release/v2/')) {
      const esc = e(decodeURIComponent(url.split('/').pop()!));
      return esc ? ok(esc) : this.bad(res, 404, 'not found');
    }
    switch (url) {
      case '/escrow/single-release/v2/deploy': {
        const r = body.roles ?? {};
        for (const k of [
          'approvers',
          'serviceProviders',
          'platform',
          'releaseSigners',
          'disputeResolvers',
          'receiver',
          'admin',
        ])
          if (r[k] === undefined) return this.bad(res, 400, `roles.${k} requerido`);
        const others = [
          ...r.approvers,
          ...r.serviceProviders,
          r.platform,
          ...r.releaseSigners,
          ...r.disputeResolvers,
          r.receiver,
        ];
        if (others.includes(r.admin))
          return this.bad(res, 400, 'roles.admin MUST be distinct from every other role');
        if (typeof body.amount !== 'number' || typeof body.platformFee !== 'number')
          return this.bad(res, 400, 'amount/platformFee number');
        if (!body.trustline?.contractId) return this.bad(res, 400, 'trustline');
        const contractId = StrKey.encodeContract(randomBytes(32));
        const roles = this.overrideReceiver ? { ...r, receiver: this.overrideReceiver } : r;
        return ok(
          this.unsigned(
            body.signer,
            () => {
              this.escrows.set(contractId, {
                contractId,
                amount: body.amount,
                balance: 0,
                platformFee: body.platformFee,
                trustline: body.trustline,
                roles,
                milestones: (body.milestones ?? []).map((m: { description: string }) => ({
                  description: m.description,
                  status: 'pending',
                  approvals: { target: 1, approvalCount: 0, approvedBy: [] },
                })),
                dispute: { isDisputed: false, resolved: false },
                released: false,
              });
              return { contractId };
            },
            contractId,
          ),
        );
      }
      case '/escrow/single-release/v2/fund': {
        const esc = e(body.contractId);
        if (!esc) return this.bad(res, 404, 'escrow');
        return ok(this.unsigned(body.signer, () => ((esc.balance += body.amount), {})));
      }
      case '/escrow/single-release/v2/approve-milestones': {
        const esc = e(body.contractId);
        if (!esc || !(esc.roles.approvers as string[]).includes(body.approver))
          return this.bad(res, 400, 'approver');
        return ok(
          this.unsigned(body.approver, () => {
            for (const i of body.milestoneIndexes) {
              const m = esc.milestones[i];
              m.approvals.approvalCount = 1;
              m.approvals.approvedBy = [body.approver];
              m.status = 'approved';
            }
            return {};
          }),
        );
      }
      case '/escrow/single-release/v2/release-funds': {
        const esc = e(body.contractId);
        if (!esc || !(esc.roles.releaseSigners as string[]).includes(body.releaseSigner))
          return this.bad(res, 400, 'releaseSigner');
        if (esc.milestones.some((m) => m.approvals.approvalCount < m.approvals.target))
          return this.bad(res, 400, 'Requires every milestone to be approved');
        if (esc.dispute.isDisputed && !esc.dispute.resolved) return this.bad(res, 400, 'disputed');
        return ok(
          this.unsigned(body.releaseSigner, () => ((esc.released = true), (esc.balance = 0), {})),
        );
      }
      case '/escrow/single-release/v2/dispute': {
        const esc = e(body.contractId);
        if (!esc || String(body.reason ?? '').length > 500) return this.bad(res, 400, 'dispute');
        if ((esc.roles.disputeResolvers as string[]).includes(body.signer))
          return this.bad(res, 400, 'resolver cannot dispute');
        return ok(
          this.unsigned(
            body.signer,
            () => ((esc.dispute = { isDisputed: true, reason: body.reason, resolved: false }), {}),
          ),
        );
      }
      case '/escrow/single-release/v2/resolve-dispute': {
        const esc = e(body.contractId);
        if (!esc || !(esc.roles.disputeResolvers as string[]).includes(body.disputeResolver))
          return this.bad(res, 400, 'disputeResolver');
        const sum = (body.distributions as { amount: number }[]).reduce((a, d) => a + d.amount, 0);
        if (Math.abs(sum - esc.balance) > 1e-9)
          return this.bad(res, 400, 'The sum of distributions MUST equal the escrow balance');
        return ok(
          this.unsigned(
            body.disputeResolver,
            () => ((esc.dispute.resolved = true), (esc.balance = 0), {}),
          ),
        );
      }
      case '/stellar/send-transaction': {
        let tx: Transaction;
        try {
          tx = TransactionBuilder.fromXDR(body.signedXdr, PASSPHRASE) as Transaction;
        } catch {
          return this.bad(res, 400, 'bad xdr');
        }
        const hash = Buffer.from(tx.hash()).toString('hex');
        const p = this.pending.get(hash);
        if (!p) return this.bad(res, 400, 'unknown tx');
        const kp = Keypair.fromPublicKey(p.signer);
        if (!tx.signatures.some((s) => kp.verify(tx.hash(), s.signature)))
          return this.bad(res, 400, 'tx_bad_auth');
        this.pending.delete(hash);
        const out = p.apply();
        return ok({
          txHash: hash,
          ledger: 4242,
          ...(out.contractId
            ? { contractId: out.contractId }
            : { code: 'STELLAR_TX_SUBMITTED', message: 'ok' }),
        });
      }
    }
    return this.bad(res, 404, 'unknown route');
  }
}
