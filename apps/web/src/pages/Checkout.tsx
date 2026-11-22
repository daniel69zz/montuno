import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { WalletGate } from '../components/WalletGate';
import { Arrow, Empty, ErrorNote, Loading, Row, useAction, useLoad } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { fiat, pct, usdc } from '../lib/money';
import { useSession } from '../lib/session';
import type { CheckoutView } from '../lib/types';

/** Pasos del pago protegido, explicados en simple y atados a la operación real. */
function EscrowExplainer({ v }: { v: CheckoutView }) {
  const partial = v.escrow.mode === 'PARTIAL_ADVANCE';
  const steps = [
    { n: '01', t: 'Depositas el 100%', d: `${usdc(v.price.token.amountAtomic)} entran al contrato${v.escrow.engine === 'TRUSTLESS_WORK' ? ' de Trustless Work' : ' de Montuno'} en Stellar.` },
    partial
      ? { n: '02', t: `La importadora cobra ${usdc(v.escrow.advanceAmountAtomic)} para comprar`, d: 'Es el anticipo que aceptas ahora. Una vez pagado, no se puede devolver desde el contrato.' }
      : { n: '02', t: 'La importadora compra con su capital', d: 'Tu pago sigue completo dentro del contrato.' },
    { n: '03', t: 'Confirmas la entrega', d: `Recién ahí se liberan ${usdc(v.escrow.protectedAmountAtomic)} a la importadora. Si hay un problema, abres una disputa y decide un árbitro.` },
  ];
  return (
    <ol className="ledger" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {steps.map((s) => (
        <li key={s.n} className="ledger-row" style={{ gridTemplateColumns: '48px minmax(0,1fr)' }}>
          <span className="t-mono t-muted">{s.n}</span>
          <div className="stack" style={{ ['--gap' as string]: '4px' }}>
            <strong>{s.t}</strong>
            <span className="t-muted">{s.d}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Checkout() {
  const { token = '' } = useParams();
  const s = useSession();
  const nav = useNavigate();
  const q = useLoad(() => api<CheckoutView>(`/checkout/${token}`), [token]);
  const [agree, setAgree] = useState(false);
  const [riskOk, setRiskOk] = useState(false);
  const a = useAction();

  if (q.loading) return <div className="wrap"><Loading label="Abriendo la cotización" /></div>;
  if (q.error)
    return (
      <div className="wrap" style={{ padding: '64px var(--pad)' }}>
        <Empty
          title={q.error instanceof ApiError && q.error.status === 404 ? 'Este enlace no existe o fue revocado' : 'No pudimos abrir la cotización'}
          detail="Pide a la importadora que te envíe un enlace nuevo."
          action={<Link className="btn btn-ghost" to="/">Ir al inicio</Link>}
        />
      </div>
    );
  const v = q.data!;
  const partial = v.escrow.mode === 'PARTIAL_ADVANCE';
  const expired = v.status === 'EXPIRED';
  const taken = v.status === 'ACCEPTED' || v.redeemed;

  const accept = () =>
    a.run(async () => {
      const r = await api<{ orderId: string }>(`/checkout/${token}/accept`, {
        idempotent: true,
        key: `accept-${token}-${s.signer?.address}`,
        body: { termsHash: v.termsHash, buyerWallet: s.signer!.address, acceptTerms: true, disclosureVersion: v.riskDisclosure.version, disclosureHash: v.riskDisclosure.hash },
      });
      nav(`/pedidos/${r.orderId}`);
    });

  return (
    <div className="wrap enter" style={{ paddingTop: 'clamp(40px, 7vw, 96px)', paddingBottom: 96 }}>
      <div className="row between" style={{ marginBottom: 24 }}>
        <span className="t-label">Cotización de {v.importer.publicName} {v.importer.verified ? '· verificada' : ''}</span>
        {v.escrow.simulated && <span className="net" data-kind="demo">Demo · simulado</span>}
      </div>
      <div className="grid-2">
        <div className="stack" style={{ ['--gap' as string]: '28px' }}>
          <h1 className="t-h1">{v.product.name}</h1>
          {v.product.variant && <p className="t-lead">{v.product.variant}</p>}
          <div className="stack" style={{ ['--gap' as string]: '6px' }}>
            <span className="t-label">Total a pagar</span>
            <div className="price">{fiat(v.price.fiat.amount, v.price.fiat.currency)}</div>
            <span className="t-mono t-muted">= {usdc(v.price.token.amountAtomic)} exactos al contrato</span>
          </div>
          <dl className="kv">
            <Row k="Cantidad" v={v.product.quantity} />
            <Row k="Entrega en" v={v.destinationCity} />
            <Row k="Plazo estimado" v={`${v.deliveryEstimateDays} días`} />
            <Row k="Protegido" v={<strong>{usdc(v.escrow.protectedAmountAtomic)}{partial && ` (${pct(10000 - v.escrow.advanceBps)})`}</strong>} />
            {partial && <Row k="Anticipo" v={`${usdc(v.escrow.advanceAmountAtomic)} (${pct(v.escrow.advanceBps)}) antes de comprar`} />}
            {v.price.fx && <Row k="Tipo de cambio" v={<span className="t-num">{v.price.fx.rate} BOB · {v.price.fx.source} · vence {new Date(v.price.fx.expiresAt).toLocaleString('es-BO')}</span>} />}
            <Row k="Condiciones" v={v.purchaseTerms} />
            <Row k="Producto" v={<a href={v.product.url} target="_blank" rel="noreferrer noopener">Ver en la tienda ↗</a>} />
          </dl>
        </div>

        <div className="stack" style={{ ['--gap' as string]: '28px' }}>
          <div className="stack">
            <span className="t-label">Cómo te protege</span>
            <EscrowExplainer v={v} />
          </div>

          {expired ? (
            <div className="note">Esta cotización venció. Pide a la importadora una nueva: los precios y el tipo de cambio cambian.</div>
          ) : taken ? (
            <div className="stack">
              <div className="note note-muted">Esta cotización ya fue aceptada.</div>
              {s.me && <Link className="btn btn-ghost" to="/pedidos">Ver mis pedidos <Arrow /></Link>}
            </div>
          ) : (
            <div className="panel stack" style={{ ['--gap' as string]: '20px' }}>
              <span className="t-label">Aviso de riesgo · {v.riskDisclosure.version}</span>
              <p style={{ margin: 0 }}>{v.riskDisclosure.text}</p>
              <label className="check">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                <span>Acepto las condiciones de esta cotización.</span>
              </label>
              {partial && (
                <label className="check">
                  <input type="checkbox" checked={riskOk} onChange={(e) => setRiskOk(e.target.checked)} />
                  <span>Entiendo que el anticipo de {usdc(v.escrow.advanceAmountAtomic)}, una vez pagado, no se recupera desde el contrato.</span>
                </label>
              )}
              <WalletGate reason="Entra para aceptar la cotización. Pagarás desde tu wallet de Stellar.">
                <button className="btn btn-full" disabled={!agree || (partial && !riskOk) || a.busy} aria-busy={a.busy} onClick={() => void accept()}>
                  Aceptar y continuar al pago <Arrow />
                </button>
              </WalletGate>
              <ErrorNote error={a.error} />
              <span className="hint t-mono">Huella de los términos: {v.termsHash.slice(0, 16)}…</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
