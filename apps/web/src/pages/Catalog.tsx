import { FormEvent, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { WalletGate } from '../components/WalletGate';
import { Arrow, Empty, ErrorNote, Loading, Page, Row, useAction, useLoad } from '../components/ui';
import { api } from '../lib/api';
import { fiat } from '../lib/money';
import type { CatalogItem, Provider } from '../lib/types';

const CAT: Record<string, string> = { tecnologia: 'Tecnología', telefonia: 'Telefonía', audio: 'Audio', hogar: 'Hogar', moda: 'Moda', deporte: 'Deporte', belleza: 'Belleza', juguetes: 'Juguetes', herramientas: 'Herramientas', otros: 'Otros' };

export function Catalog() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const category = params.get('categoria') ?? '';
  const [text, setText] = useState(q);
  const items = useLoad(() => api<CatalogItem[]>(`/catalog?${new URLSearchParams({ ...(q ? { q } : {}), ...(category ? { category } : {}) })}`), [q, category]);
  const cats = useLoad(() => api<string[]>('/catalog/categories'), []);
  return (
    <Page eyebrow="Catálogo" title="Lo que traen las importadoras verificadas." lead="Precios de referencia. El precio final siempre llega en una cotización, con el pago protegido.">
      <form className="row" onSubmit={(e) => (e.preventDefault(), setParams({ ...(text ? { q: text } : {}), ...(category ? { categoria: category } : {}) }))} style={{ marginBottom: 24 }}>
        <input className="input" style={{ flex: '1 1 260px' }} placeholder="Buscar: iPhone, consola, perfume…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Buscar" />
        <button className="btn btn-ghost">Buscar</button>
      </form>
      <div className="tabs" role="tablist" style={{ marginBottom: 8 }}>
        {['', ...(cats.data ?? [])].map((c) => (
          <button key={c || 'todo'} role="tab" aria-selected={category === c} onClick={() => setParams({ ...(q ? { q } : {}), ...(c ? { categoria: c } : {}) })}>
            {c ? CAT[c] ?? c : 'Todo'}
          </button>
        ))}
      </div>
      {items.loading ? <Loading /> : items.error ? <ErrorNote error={items.error} onRetry={items.reload} /> : items.data!.length === 0 ? (
        <Empty title="Nada por aquí todavía" detail="Las importadoras verificadas publican sus productos de referencia. Prueba otra categoría." />
      ) : (
        <div className="ledger">
          {items.data!.map((it, i) => (
            <Link key={it.id} className="ledger-row" to={`/catalogo/${it.id}`}>
              <span className="t-mono t-muted">{String(i + 1).padStart(2, '0')}</span>
              <span className="stack" style={{ ['--gap' as string]: '4px' }}>
                <strong style={{ fontSize: 18 }}>{it.title}</strong>
                <span className="hint">{CAT[it.category] ?? it.category} · {it.provider?.publicName} · {it.deliveryEstimateDays} días</span>
              </span>
              <span className="t-num">desde {fiat(it.referencePrice.amount, it.referencePrice.currency)} <span className="ledger-go">→</span></span>
            </Link>
          ))}
        </div>
      )}
    </Page>
  );
}

export function CatalogItemPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const it = useLoad(() => api<CatalogItem>(`/catalog/${id}`), [id]);
  const a = useAction();
  const [details, setDetails] = useState('');
  const [qty, setQty] = useState(1);
  const [city, setCity] = useState('La Paz');
  if (it.loading) return <div className="wrap"><Loading /></div>;
  if (it.error) return <div className="wrap" style={{ padding: '64px var(--pad)' }}><Empty title="Producto no disponible" action={<Link className="btn btn-ghost" to="/catalogo">Volver al catálogo</Link>} /></div>;
  const item = it.data!;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void a.run(async () => {
      await api('/quote-requests', { idempotent: true, body: { importerId: item.provider!.id, catalogItemId: item.id, details, quantity: qty, destinationCity: city } });
      nav('/pedidos');
    });
  };
  return (
    <Page
      eyebrow={`${CAT[item.category] ?? item.category} · ${item.provider?.publicName}`}
      title={item.title}
      lead={item.description}
      aside={
        <form className="panel stack" style={{ ['--gap' as string]: '18px' }} onSubmit={submit}>
          <span className="t-label">Pedir cotización</span>
          <p className="t-body">La importadora te responde con el precio final y un enlace de pago protegido.</p>
          <label className="field">
            <span>Detalles (color, talla, modelo)</span>
            <textarea className="textarea" required minLength={5} value={details} onChange={(e) => setDetails(e.target.value)} />
          </label>
          <div className="row">
            <label className="field" style={{ flex: 1 }}>
              <span>Cantidad</span>
              <input className="input t-num" type="number" min={1} max={100} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
            </label>
            <label className="field" style={{ flex: 2 }}>
              <span>Ciudad de entrega</span>
              <input className="input" required value={city} onChange={(e) => setCity(e.target.value)} />
            </label>
          </div>
          <WalletGate reason="Entra para pedir la cotización.">
            <button className="btn btn-full" aria-busy={a.busy} disabled={a.busy}>Pedir cotización <Arrow /></button>
          </WalletGate>
          <ErrorNote error={a.error} />
        </form>
      }
    >
      <dl className="kv">
        <Row k="Precio de referencia" v={<span className="t-num">{fiat(item.referencePrice.amount, item.referencePrice.currency)}</span>} />
        <Row k="Plazo estimado" v={`${item.deliveryEstimateDays} días`} />
        <Row k="Proveedor" v={<Link to={`/proveedores/${item.provider?.id}`}>{item.provider?.publicName}</Link>} />
        {item.referenceUrl && <Row k="Tienda de origen" v={<a href={item.referenceUrl} target="_blank" rel="noreferrer noopener">Ver producto ↗</a>} />}
      </dl>
    </Page>
  );
}

export function Providers() {
  const ps = useLoad(() => api<Provider[]>('/providers'), []);
  return (
    <Page eyebrow="Proveedores" title="Importadoras verificadas." lead="Revisadas por Montuno antes de poder cobrar. Su historial de pedidos liquidados es público y verificable.">
      {ps.loading ? <Loading /> : ps.error ? <ErrorNote error={ps.error} onRetry={ps.reload} /> : ps.data!.length === 0 ? <Empty title="Aún no hay importadoras verificadas" /> : (
        <div className="ledger">
          {ps.data!.map((p, i) => (
            <Link key={p.id} className="ledger-row" to={`/proveedores/${p.id}`}>
              <span className="t-mono t-muted">{String(i + 1).padStart(2, '0')}</span>
              <span className="stack" style={{ ['--gap' as string]: '4px' }}>
                <strong style={{ fontSize: 18 }}>{p.publicName}</strong>
                <span className="hint">{p.catalogItems} productos · {p.completedOrders} pedidos completados{p.offersAdvance ? ' · ofrece anticipo parcial' : ''}</span>
              </span>
              <span className="ledger-go">→</span>
            </Link>
          ))}
        </div>
      )}
    </Page>
  );
}

export function ProviderPage() {
  const { id = '' } = useParams();
  const p = useLoad(() => api<Provider>(`/providers/${id}`), [id]);
  if (p.loading) return <div className="wrap"><Loading /></div>;
  if (p.error) return <div className="wrap" style={{ padding: '64px var(--pad)' }}><Empty title="Proveedor no encontrado" /></div>;
  const v = p.data!;
  return (
    <Page eyebrow="Proveedor verificado" title={v.publicName} lead={`${v.completedOrders} pedidos completados sin disputa · miembro desde ${new Date(v.memberSince).toLocaleDateString('es-BO', { month: 'long', year: 'numeric' })}`}>
      {(v.items ?? []).length === 0 ? <Empty title="Sin productos publicados" /> : (
        <div className="ledger">
          {v.items!.map((it, i) => (
            <Link key={it.id} className="ledger-row" to={`/catalogo/${it.id}`}>
              <span className="t-mono t-muted">{String(i + 1).padStart(2, '0')}</span>
              <strong>{it.title}</strong>
              <span className="t-num">desde {fiat(it.referencePrice.amount, it.referencePrice.currency)}</span>
            </Link>
          ))}
        </div>
      )}
    </Page>
  );
}
