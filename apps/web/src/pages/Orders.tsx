import { Link } from 'react-router-dom';
import { WalletGate } from '../components/WalletGate';
import { Arrow, Empty, ErrorNote, Loading, Page, useLoad } from '../components/ui';
import { api } from '../lib/api';
import { usdc } from '../lib/money';
import { useSession } from '../lib/session';
import type { OrderView, QuoteRequest } from '../lib/types';

export function Orders() {
  const s = useSession();
  const orders = useLoad(() => (s.me ? api<OrderView[]>('/me/orders') : Promise.resolve([])), [s.me?.id]);
  const reqs = useLoad(() => (s.me ? api<QuoteRequest[]>('/me/quote-requests') : Promise.resolve([])), [s.me?.id]);
  if (!s.me) return <Page eyebrow="Mis pedidos" title="Tus compras protegidas."><WalletGate reason="Entra para ver tus pedidos.">{null}</WalletGate></Page>;
  const quoted = (reqs.data ?? []).filter((r) => r.status === 'QUOTED' && r.checkoutToken);
  return (
    <Page eyebrow="Mis pedidos" title="Tus compras protegidas.">
      <div className="stack" style={{ ['--gap' as string]: '48px' }}>
        {quoted.length > 0 && (
          <section className="stack">
            <span className="t-label">Cotizaciones listas para ti</span>
            <div className="ledger">
              {quoted.map((r, i) => (
                <Link key={r.id} className="ledger-row" to={`/c/${r.checkoutToken}`}>
                  <span className="t-mono t-muted">{String(i + 1).padStart(2, '0')}</span>
                  <span><strong>{r.catalogItem?.title ?? 'Tu solicitud'}</strong> <span className="t-muted">· {r.provider?.publicName}</span></span>
                  <span className="ledger-go">Revisar y pagar →</span>
                </Link>
              ))}
            </div>
          </section>
        )}
        <section className="stack">
          <span className="t-label">Pedidos</span>
          {orders.loading ? <Loading /> : orders.error ? <ErrorNote error={orders.error} onRetry={orders.reload} /> : (orders.data ?? []).length === 0 ? (
            <Empty title="Aún no tienes pedidos" detail="Cuando aceptes una cotización aparecerá aquí, con su pago protegido." action={<Link className="btn btn-ghost" to="/catalogo">Explorar el catálogo <Arrow /></Link>} />
          ) : (
            <div className="ledger">
              {orders.data!.map((o, i) => (
                <Link key={o.id} className="ledger-row" to={`/pedidos/${o.id}`}>
                  <span className="t-mono t-muted">{String(i + 1).padStart(2, '0')}</span>
                  <span className="stack" style={{ ['--gap' as string]: '4px' }}>
                    <strong>{o.product?.name ?? 'Pedido'}</strong>
                    <span className="hint">{o.provider?.publicName} · {o.summary.label}</span>
                  </span>
                  <span className="t-num">{usdc(o.escrow.amountAtomic)} <span className="ledger-go">→</span></span>
                </Link>
              ))}
            </div>
          )}
        </section>
        {(reqs.data ?? []).filter((r) => r.status === 'OPEN').length > 0 && (
          <section className="stack">
            <span className="t-label">Solicitudes enviadas</span>
            <div className="ledger">
              {reqs.data!.filter((r) => r.status === 'OPEN').map((r, i) => (
                <div key={r.id} className="ledger-row">
                  <span className="t-mono t-muted">{String(i + 1).padStart(2, '0')}</span>
                  <span>{r.catalogItem?.title ?? r.productUrl} <span className="t-muted">· {r.provider?.publicName}</span></span>
                  <span className="t-label">Esperando cotización</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </Page>
  );
}
