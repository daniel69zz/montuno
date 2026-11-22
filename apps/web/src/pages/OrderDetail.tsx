import { FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { WalletGate } from '../components/WalletGate';
import { Arrow, Empty, ErrorNote, EscrowBar, Hash, Loading, Row, useAction, useLoad } from '../components/ui';
import { api } from '../lib/api';
import { runOnchain, RunStep } from '../lib/escrow-runner';
import { fiat, fromAtomic, toAtomic, usdc } from '../lib/money';
import { arbiterAction, buyerAction, importerAction, LOGISTIC_LABEL, nextLogistic, strata } from '../lib/next-action';
import { useSession } from '../lib/session';
import type { Dispute, Evidence, OrderView, Prepared } from '../lib/types';

interface EscrowTx {
  id: string;
  eventType: string;
  txHash: string;
  explorerUrl: string;
  createdAt: string;
}

const EVENT_LABEL: Record<string, string> = {
  escrow_created: 'Escrow creado',
  funded: 'Depósito en el escrow',
  advance_released: 'Anticipo liberado',
  delivery_confirmed: 'Entrega confirmada',
  dispute_opened: 'Disputa abierta',
  dispute_resolved: 'Disputa resuelta',
  refunded: 'Reembolso',
  tw_deploy: 'Escrow desplegado (Trustless Work)',
  tw_fund: 'Depósito (Trustless Work)',
  tw_approve: 'Hito aprobado (Trustless Work)',
  tw_release: 'Fondos liberados (Trustless Work)',
  tw_dispute: 'Disputa (Trustless Work)',
  tw_resolve: 'Resolución (Trustless Work)',
};

export function OrderDetail() {
  const { id = '' } = useParams();
  const s = useSession();
  const order = useLoad(() => api<OrderView>(`/orders/${id}`), [id, s.me?.id]);
  const escrow = useLoad(() => api<{ transactions: EscrowTx[] }>(`/orders/${id}/escrow`), [id, order.data?.updatedAt ?? order.data?.states.onchain]);
  const evidence = useLoad(() => api<Evidence[]>(`/orders/${id}/evidence`), [id]);
  const disputes = useLoad(() => api<Dispute[]>(`/orders/${id}/disputes`), [id, order.data?.states.dispute]);
  const [steps, setSteps] = useState<RunStep[]>([]);

  if (!s.me) return <div className="wrap" style={{ padding: '64px var(--pad)' }}><WalletGate reason="Entra para ver tu pedido.">{null}</WalletGate></div>;
  if (order.loading && !order.data) return <div className="wrap"><Loading label="Cargando el pedido" /></div>;
  if (order.error) return <div className="wrap" style={{ padding: '64px var(--pad)' }}><Empty title="No encontramos este pedido" detail="Puede que no tengas acceso a él." action={<Link className="btn btn-ghost" to="/pedidos">Mis pedidos</Link>} /></div>;
  const o = order.data!;
  const roles = o.myRoles ?? { buyer: false, importer: false, arbiter: false, admin: false };
  const reload = async () => {
    await api(`/orders/${id}/escrow/sync`, { method: 'POST' }).catch(() => undefined);
    await order.reload();
    void evidence.reload();
    void disputes.reload();
  };
  const p = o.escrow.projection;

  return (
    <div className="wrap enter" style={{ paddingTop: 'clamp(40px, 6vw, 80px)', paddingBottom: 96 }}>
      <div className="row between" style={{ marginBottom: 20 }}>
        <span className="t-label">
          Pedido · {o.provider?.publicName ?? 'Importadora'} · {o.escrow.mode === 'PARTIAL_ADVANCE' ? 'Anticipo parcial' : 'Escrow completo'}
          {o.engine === 'TRUSTLESS_WORK' && ' · Trustless Work (beta)'}
        </span>
        <span className="net" data-kind={o.escrow.simulated ? 'demo' : 'testnet'}>{o.escrow.simulated ? 'Demo · simulado' : 'Stellar Testnet'}</span>
      </div>
      <h1 className="t-h1" style={{ maxWidth: '20ch' }}>{o.product?.name ?? 'Pedido'}</h1>
      <p className="t-lead" style={{ marginTop: 16 }}>{o.summary.label}</p>

      <div className="grid-2" style={{ marginTop: 'clamp(32px, 5vw, 56px)' }}>
        <div className="stack" style={{ ['--gap' as string]: '32px' }}>
          {roles.buyer && <BuyerPanel o={o} onDone={reload} onSteps={setSteps} />}
          {roles.importer && <ImporterPanel o={o} onDone={reload} onSteps={setSteps} />}
          {roles.arbiter && <ArbiterPanel o={o} disputes={disputes.data ?? []} onDone={reload} onSteps={setSteps} />}
          {steps.length > 0 && (
            <div className="note">
              <div className="t-label" style={{ marginBottom: 8 }}>Confirmado en la red</div>
              {steps.map((st) => (
                <div key={st.txHash}>
                  {EVENT_LABEL[st.action] ?? st.action} · <Hash value={st.txHash} href={o.escrow.simulated ? undefined : st.explorerUrl} />
                </div>
              ))}
            </div>
          )}
          <div className="stack">
            <span className="t-label">Estado del pedido</span>
            <ol className="strata">
              {strata(o).map((l, i) => (
                <li key={l.key} data-state={l.state}>
                  <span className="lvl">{String(i + 1).padStart(2, '0')}</span>
                  <span>{l.label}</span>
                  <span />
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="stack" style={{ ['--gap' as string]: '40px' }}>
          <section className="stack">
            <span className="t-label">El dinero, ahora mismo</span>
            <div className="t-h2 t-num">{usdc(o.escrow.amountAtomic)}</div>
            <EscrowBar total={o.escrow.amountAtomic} released={p.sellerReleasedAtomic} retained={p.remainingEscrowAtomic} refunded={p.buyerRefundedAtomic} />
            {BigInt(p.advanceReleasedAtomic) > 0n && !['SETTLED', 'CANCELLED'].includes(o.states.onchain) && (
              <p className="note note-muted">
                El anticipo de {usdc(p.advanceReleasedAtomic)} ya está en manos de la importadora y no está en el escrow. Protección actual: {usdc(o.escrow.maxRecoverableByBuyerAtomic)}.
              </p>
            )}
          </section>

          <section className="stack">
            <span className="t-label">Verificable</span>
            <dl className="kv">
              <Row k="Contrato" v={<Hash value={o.escrow.contractId} href={o.escrow.simulated ? undefined : `${s.config?.explorerBaseUrl}/contract/${o.escrow.contractId}`} />} />
              <Row k="Orden on-chain" v={<Hash value={o.escrow.onchainOrderId} />} />
              <Row k="Términos" v={<Hash value={o.escrow.termsHash} />} />
              {o.product && <Row k="Precio" v={fiat(o.product.fiat.amount, o.product.fiat.currency)} />}
              {o.tracking && <Row k="Tracking" v={<span>{o.tracking.carrier} · <span className="t-mono">{o.tracking.number}</span></span>} />}
            </dl>
            {(escrow.data?.transactions ?? []).length > 0 && (
              <div className="ledger">
                {escrow.data!.transactions.map((t) => (
                  <div key={t.id} className="ledger-row" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                    <span>{EVENT_LABEL[t.eventType] ?? t.eventType}</span>
                    <Hash value={t.txHash} href={o.escrow.simulated ? undefined : t.explorerUrl} />
                  </div>
                ))}
              </div>
            )}
          </section>

          <EvidenceSection o={o} items={evidence.data ?? []} onUploaded={evidence.reload} />

          {(disputes.data ?? []).length > 0 && (
            <section className="stack">
              <span className="t-label">Disputa</span>
              {disputes.data!.map((d) => (
                <dl key={d.id} className="kv">
                  <Row k="Estado" v={d.status} />
                  <Row k="Abierta por" v={d.openedByRole === 'BUYER' ? 'Comprador' : 'Importadora'} />
                  <Row k="Motivo" v={d.reason} />
                  {d.resolution && <Row k="Resolución" v={d.resolution} />}
                </dl>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

type PanelProps = { o: OrderView; onDone: () => Promise<void>; onSteps: (s: RunStep[]) => void };

function ActionBox({ eyebrow, title, detail, children }: { eyebrow: string; title: string; detail: string; children?: React.ReactNode }) {
  return (
    <section className="panel stack" style={{ ['--gap' as string]: '18px' }} aria-live="polite">
      <span className="t-label">{eyebrow}</span>
      <h2 className="t-h2">{title}</h2>
      <p className="t-body">{detail}</p>
      {children}
    </section>
  );
}

function useOnchain(o: OrderView, onDone: () => Promise<void>, onSteps: (s: RunStep[]) => void) {
  const s = useSession();
  const a = useAction();
  const [stage, setStage] = useState('');
  const go = (prepare: () => Promise<Prepared | { prepared: Prepared }>, maxSteps = 1) =>
    a.run(async () => {
      const r = await runOnchain({ orderId: o.id, prepare, signer: s.signer!, maxSteps, onStep: setStage });
      onSteps(r);
      setStage('');
      await onDone();
    }).finally(() => setStage(''));
  return { ...a, stage, go };
}

function BusyLabel({ stage }: { stage: string }) {
  return stage ? <span className="hint">{stage}…</span> : null;
}

function BuyerPanel({ o, onDone, onSteps }: PanelProps) {
  const s = useSession();
  const act = buyerAction(o, { rampAvailable: !!s.config });
  const x = useOnchain(o, onDone, onSteps);
  const [showDispute, setShowDispute] = useState(false);
  const canDispute = (o.states.onchain === 'FUNDED' || o.states.onchain === 'ADVANCE_PAID') && o.states.dispute === 'NONE';

  return (
    <>
      <ActionBox eyebrow="Tu siguiente paso" title={act.title} detail={act.detail}>
        {act.id === 'ramp' && <RampFlow o={o} onDone={onDone} />}
        {act.id === 'fund' && (
          <WalletGate address={o.wallets?.buyer}>
            <button className="btn btn-full" aria-busy={x.busy} disabled={x.busy} onClick={() => void x.go(() => api<Prepared>(`/orders/${o.id}/escrow/prepare-funding`, { method: 'POST', idempotent: true }), o.engine === 'TRUSTLESS_WORK' ? 2 : 1)}>
              Firmar el depósito de {usdc(o.escrow.amountAtomic)} <Arrow />
            </button>
            <BusyLabel stage={x.stage} />
          </WalletGate>
        )}
        {act.id === 'confirm' && (
          <WalletGate address={o.wallets?.buyer}>
            <button className="btn btn-full" aria-busy={x.busy} disabled={x.busy} onClick={() => void x.go(() => api<Prepared>(`/orders/${o.id}/delivery/prepare-confirmation`, { method: 'POST', idempotent: true }), o.engine === 'TRUSTLESS_WORK' ? 2 : 1)}>
              Recibí mi pedido: liberar {usdc(o.escrow.projection.remainingEscrowAtomic)} <Arrow />
            </button>
            <BusyLabel stage={x.stage} />
          </WalletGate>
        )}
        <ErrorNote error={x.error} />
      </ActionBox>
      {canDispute && (
        <div className="stack">
          {!showDispute ? (
            <button className="btn-link" onClick={() => setShowDispute(true)}>¿Algo salió mal? Abrir una disputa</button>
          ) : (
            <DisputeForm o={o} address={o.wallets?.buyer} onDone={onDone} onSteps={onSteps} />
          )}
        </div>
      )}
    </>
  );
}

function RampFlow({ o, onDone }: { o: OrderView; onDone: () => Promise<void> }) {
  const s = useSession();
  const a = useAction();
  const [quote, setQuote] = useState<{ rampQuoteId: string; route: { id: string; note?: string }; quote: { fiatAmount: string; fiatCurrency: string; feeFiat: string; rate: string }; kyc: { required: boolean; status: string } } | null>(null);
  const [started, setStarted] = useState<{ paymentInstructions: Record<string, string> } | null>(null);
  const real = s.config?.ramp.deliversRealTestnetToken;
  return (
    <div className="stack">
      {!quote && (
        <button className="btn btn-full" aria-busy={a.busy} disabled={a.busy} onClick={() => void a.run(async () => setQuote(await api(`/orders/${o.id}/ramp/quote`, { method: 'POST' })))}>
          Cotizar en bolivianos <Arrow />
        </button>
      )}
      {quote && !started && (
        <>
          <dl className="kv">
            <Row k="Pagas" v={<strong>{fiat(quote.quote.fiatAmount, quote.quote.fiatCurrency)}</strong>} />
            <Row k="Recibes" v={usdc(o.escrow.amountAtomic)} />
            <Row k="Cambio / comisión" v={`${quote.quote.rate} · Bs ${quote.quote.feeFiat}`} />
          </dl>
          <p className="hint">Pago en bolivianos SIMULADO{real ? '; los USDC de testnet llegan de verdad a tu wallet.' : '.'}</p>
          <button
            className="btn btn-full"
            aria-busy={a.busy}
            disabled={a.busy}
            onClick={() =>
              void a.run(async () => {
                if (quote.kyc.required && quote.kyc.status !== 'approved') await api('/me/kyc/start', { body: { corridorId: quote.route.id } });
                setStarted(await api(`/orders/${o.id}/ramp/start`, { body: { rampQuoteId: quote.rampQuoteId }, idempotent: true, key: `ramp-${quote.rampQuoteId}` }));
              })
            }
          >
            Generar QR de pago <Arrow />
          </button>
        </>
      )}
      {started && (
        <>
          <QrPlaceholder />
          <p className="hint">{started.paymentInstructions.note}</p>
          <button className="btn btn-full" aria-busy={a.busy} disabled={a.busy} onClick={() => void a.run(async () => (await api(`/orders/${o.id}/ramp/simulate-payment`, { method: 'POST', idempotent: true }), await onDone()))}>
            Simular que pagué el QR <Arrow />
          </button>
        </>
      )}
      <button className="btn-link" onClick={() => void onDone()}>Ya tengo USDC en mi wallet</button>
      <ErrorNote error={a.error} />
    </div>
  );
}

/** QR ficticio dibujado con módulos: deja explícito que es una simulación. */
function QrPlaceholder() {
  const cells = Array.from({ length: 21 * 21 }, (_, i) => ((i * 7919) % 13) % 3 === 0);
  return (
    <figure className="stack" style={{ margin: 0, alignItems: 'start' }}>
      <svg viewBox="0 0 21 21" width="168" height="168" role="img" aria-label="QR simulado">
        <rect width="21" height="21" fill="var(--c-snow)" />
        {cells.map((on, i) => on && <rect key={i} x={i % 21} y={Math.floor(i / 21)} width="1" height="1" fill="var(--c-ink)" />)}
        {[0, 14].map((x) => [0, 14].map((y) => (x === 14 && y === 14 ? null : <g key={`${x}${y}`}><rect x={x} y={y} width="7" height="7" fill="var(--c-ink)" /><rect x={x + 1} y={y + 1} width="5" height="5" fill="var(--c-snow)" /><rect x={x + 2} y={y + 2} width="3" height="3" fill="var(--c-ink)" /></g>)))}
      </svg>
      <figcaption className="t-label">QR simulado · no pagues</figcaption>
    </figure>
  );
}

function DisputeForm({ o, address, onDone, onSteps }: PanelProps & { address?: string }) {
  const x = useOnchain(o, onDone, onSteps);
  const [reason, setReason] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void x.go(() => api<{ prepared: Prepared }>(`/orders/${o.id}/disputes`, { body: { reason }, idempotent: true }));
  };
  return (
    <form className="panel stack" onSubmit={submit}>
      <span className="t-label">Abrir disputa</span>
      <p className="t-body">Congela los fondos retenidos. El motivo es privado: a la blockchain solo va su huella.</p>
      <label className="field">
        <span>Qué pasó</span>
        <textarea className="textarea" required minLength={10} maxLength={4000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <WalletGate address={address}>
        <button className="btn btn-ghost btn-full" aria-busy={x.busy} disabled={x.busy || reason.length < 10}>Firmar y abrir disputa</button>
        <BusyLabel stage={x.stage} />
      </WalletGate>
      <ErrorNote error={x.error} />
    </form>
  );
}

function ImporterPanel({ o, onDone, onSteps }: PanelProps) {
  const act = importerAction(o);
  const x = useOnchain(o, onDone, onSteps);
  const a = useAction();
  const [tracking, setTracking] = useState('');
  const [carrier, setCarrier] = useState('');
  const nxt = nextLogistic(o.states.logistic);
  const [showDispute, setShowDispute] = useState(false);
  const canDispute = (o.states.onchain === 'FUNDED' || o.states.onchain === 'ADVANCE_PAID') && o.states.dispute === 'NONE';
  return (
    <>
      <ActionBox eyebrow="Importadora · siguiente paso" title={act.title} detail={act.detail}>
        {act.id === 'advance' && (
          <WalletGate address={o.wallets?.importer}>
            <button className="btn btn-full" aria-busy={x.busy} disabled={x.busy} onClick={() => void x.go(() => api<Prepared>(`/orders/${o.id}/advance/prepare`, { method: 'POST', idempotent: true }))}>
              Cobrar anticipo de {usdc(o.escrow.advanceAmountAtomic)} <Arrow />
            </button>
            <BusyLabel stage={x.stage} />
          </WalletGate>
        )}
        {act.id === 'logistics' && nxt && (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void a.run(async () => {
                await api(`/orders/${o.id}/logistics`, { method: 'PATCH', body: { state: nxt, ...(tracking ? { trackingNumber: tracking, carrier: carrier || undefined } : {}) } });
                await onDone();
              });
            }}
          >
            {nxt === 'IN_TRANSIT' && (
              <div className="row" style={{ alignItems: 'end' }}>
                <label className="field" style={{ flex: 2, minWidth: 160 }}>
                  <span>Tracking</span>
                  <input className="input t-mono" pattern="[A-Za-z0-9-]{4,40}" value={tracking} onChange={(e) => setTracking(e.target.value)} />
                </label>
                <label className="field" style={{ flex: 1, minWidth: 120 }}>
                  <span>Courier</span>
                  <input className="input" value={carrier} onChange={(e) => setCarrier(e.target.value)} />
                </label>
              </div>
            )}
            <button className="btn btn-full" aria-busy={a.busy} disabled={a.busy}>Marcar como «{LOGISTIC_LABEL[nxt]}» <Arrow /></button>
          </form>
        )}
        <ErrorNote error={x.error ?? a.error} />
      </ActionBox>
      {canDispute && (!showDispute ? <button className="btn-link" onClick={() => setShowDispute(true)}>Abrir una disputa</button> : <DisputeForm o={o} address={o.wallets?.importer} onDone={onDone} onSteps={onSteps} />)}
    </>
  );
}

function ArbiterPanel({ o, disputes, onDone, onSteps }: PanelProps & { disputes: Dispute[] }) {
  const act = arbiterAction(o);
  const x = useOnchain(o, onDone, onSteps);
  const a = useAction();
  const active = disputes.find((d) => d.status === 'OPEN' || d.status === 'UNDER_REVIEW');
  const retained = o.escrow.projection.remainingEscrowAtomic;
  const [refund, setRefund] = useState(fromAtomic(retained));
  const [resolution, setResolution] = useState('');
  let release = '';
  let valid = false;
  try {
    const r = toAtomic(refund || '0');
    valid = r >= 0n && r <= BigInt(retained);
    release = valid ? fromAtomic(BigInt(retained) - r) : '';
  } catch {
    valid = false;
  }
  if (act.id === 'wait' || !active) return null;
  return (
    <ActionBox eyebrow="Árbitro" title={act.title} detail={act.detail}>
      {act.id === 'review' && (
        <button className="btn btn-full" aria-busy={a.busy} disabled={a.busy} onClick={() => void a.run(async () => (await api(`/orders/${o.id}/disputes/${active.id}/review`, { method: 'POST' }), await onDone()))}>
          Tomar la disputa <Arrow />
        </button>
      )}
      {act.id === 'resolve' && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void x.go(() =>
              api<{ prepared: Prepared }>(`/orders/${o.id}/disputes/${active.id}/prepare-resolution`, {
                body: { refundToBuyerAtomic: toAtomic(refund).toString(), releaseToImporterAtomic: (BigInt(retained) - toAtomic(refund)).toString(), resolution },
                idempotent: true,
              }),
            );
          }}
        >
          <p className="hint">Saldo retenido a repartir: <span className="t-num t-snow">{usdc(retained)}</span></p>
          <label className="field">
            <span>Devolver al comprador (USDC)</span>
            <input className="input t-num" inputMode="decimal" value={refund} onChange={(e) => setRefund(e.target.value)} />
            {valid && <span className="hint">A la importadora: {release} USDC</span>}
          </label>
          <label className="field">
            <span>Fundamento de la resolución</span>
            <textarea className="textarea" required minLength={10} value={resolution} onChange={(e) => setResolution(e.target.value)} />
          </label>
          <WalletGate address={o.wallets?.arbiter}>
            <button className="btn btn-full" aria-busy={x.busy} disabled={x.busy || !valid || resolution.length < 10}>Firmar resolución <Arrow /></button>
            <BusyLabel stage={x.stage} />
          </WalletGate>
        </form>
      )}
      <ErrorNote error={x.error ?? a.error} />
    </ActionBox>
  );
}

async function sha256Hex(buf: ArrayBuffer) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function EvidenceSection({ o, items, onUploaded }: { o: OrderView; items: Evidence[]; onUploaded: () => Promise<void> }) {
  const a = useAction();
  const roles = o.myRoles;
  const types = roles?.importer ? ['RECEIPT', 'TRACKING', 'DELIVERY_PROOF', 'OTHER'] : roles?.buyer ? ['DELIVERY_PROOF', 'OTHER'] : [];
  const [type, setType] = useState(types[0] ?? 'OTHER');
  const LABEL: Record<string, string> = { RECEIPT: 'Comprobante de compra', TRACKING: 'Tracking', DELIVERY_PROOF: 'Prueba de entrega', OTHER: 'Otro' };
  const upload = (f: File) =>
    a.run(async () => {
      const buf = await f.arrayBuffer();
      const u = await api<{ objectKey: string; uploadUrl: string }>(`/orders/${o.id}/evidence/upload-url`, { body: { type, mimeType: f.type, sizeBytes: f.size, sha256: await sha256Hex(buf) } });
      const url = new URL(u.uploadUrl);
      const put = await fetch(url.pathname + url.search, { method: 'PUT', headers: { 'content-type': f.type }, body: buf });
      if (!put.ok) throw new Error('No se pudo subir el archivo.');
      await api(`/orders/${o.id}/evidence/confirm-upload`, { body: { objectKey: u.objectKey } });
      await onUploaded();
    });
  return (
    <section className="stack">
      <span className="t-label">Evidencias privadas</span>
      {items.length === 0 ? (
        <p className="t-body">Todavía no hay comprobantes.</p>
      ) : (
        <div className="ledger">
          {items.map((e) => (
            <a key={e.id} className="ledger-row" href={new URL(e.downloadUrl).pathname + new URL(e.downloadUrl).search} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
              <span>{LABEL[e.type] ?? e.type}</span>
              <span className="t-mono t-muted">{e.sha256.slice(0, 10)}…</span>
            </a>
          ))}
        </div>
      )}
      {types.length > 0 && (
        <div className="row" style={{ alignItems: 'end' }}>
          <label className="field" style={{ minWidth: 200 }}>
            <span>Tipo</span>
            <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
              {types.map((t) => <option key={t} value={t}>{LABEL[t]}</option>)}
            </select>
          </label>
          <label className="btn btn-ghost" aria-busy={a.busy}>
            Subir PDF o imagen
            <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
          </label>
        </div>
      )}
      <ErrorNote error={a.error} />
    </section>
  );
}
