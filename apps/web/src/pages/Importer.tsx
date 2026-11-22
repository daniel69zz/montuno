import { FormEvent, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { WalletGate } from '../components/WalletGate';
import { Arrow, Empty, ErrorNote, Hash, Loading, Page, Row, useAction, useLoad } from '../components/ui';
import { api } from '../lib/api';
import { fiat, fmtDecimal, fromAtomic, pct, toAtomic, usdc } from '../lib/money';
import { useSession } from '../lib/session';
import type { CatalogItem, EscrowMode, Importer, OrderView, QuoteRequest } from '../lib/types';

const STATUS: Record<string, string> = { PENDING: 'En revisión por Montuno', VERIFIED: 'Verificada', SUSPENDED: 'Suspendida' };

export function ImporterRegister() {
  const s = useSession();
  const nav = useNavigate();
  const a = useAction();
  const [name, setName] = useState('');
  const [nit, setNit] = useState('');
  if (s.me?.memberships.length) {
    nav('/importadora', { replace: true });
    return null;
  }
  return (
    <Page
      eyebrow="Importadoras"
      title="Cobra con la confianza ya resuelta."
      lead="Registra tu importadora. Montuno la revisa a mano antes de que puedas publicar cotizaciones. Seguirás vendiendo por WhatsApp."
      aside={
        <WalletGate reason="Entra con la wallet donde quieres cobrar.">
          <form
            className="panel stack"
            style={{ ['--gap' as string]: '18px' }}
            onSubmit={(e) => {
              e.preventDefault();
              void a.run(async () => {
                await api('/importers', { body: { publicName: name, ...(nit ? { nit } : {}) } });
                await s.refreshMe();
                nav('/importadora');
              });
            }}
          >
            <label className="field">
              <span>Nombre público</span>
              <input className="input" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field">
              <span>NIT (opcional)</span>
              <input className="input t-num" pattern="[0-9]{5,15}" value={nit} onChange={(e) => setNit(e.target.value)} />
            </label>
            <button className="btn btn-full" aria-busy={a.busy} disabled={a.busy}>Registrar importadora <Arrow /></button>
            <ErrorNote error={a.error} />
          </form>
        </WalletGate>
      }
    />
  );
}

type Tab = 'resumen' | 'solicitudes' | 'pedidos' | 'catalogo';

export function ImporterHome() {
  const s = useSession();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'resumen';
  const imp = useLoad(() => api<Importer>('/importers/me'), [s.me?.id]);
  if (!s.me) return <Page eyebrow="Importadora" title="Tu importadora."><WalletGate>{null}</WalletGate></Page>;
  if (!s.me.memberships.length)
    return <Page eyebrow="Importadora" title="Aún no tienes una importadora."><Link className="btn" to="/importadora/registro">Registrar mi importadora <Arrow /></Link></Page>;
  if (imp.loading) return <div className="wrap"><Loading /></div>;
  if (imp.error) return <div className="wrap" style={{ padding: 48 }}><ErrorNote error={imp.error} onRetry={imp.reload} /></div>;
  const i = imp.data!;
  const ready = i.status === 'VERIFIED' && !!i.walletAddress && BigInt(i.limits.maxOrderAmountAtomic) > 0n;
  return (
    <Page
      eyebrow={`Importadora · ${STATUS[i.status]}`}
      title={i.publicName}
      aside={
        <div className="stack" style={{ alignSelf: 'end' }}>
          {ready ? (
            <Link className="btn" to="/importadora/cotizar">Nueva cotización <Arrow /></Link>
          ) : (
            <p className="note note-muted">Para cotizar necesitas: verificación de Montuno, wallet de cobro y límites asignados.</p>
          )}
        </div>
      }
    >
      <div className="tabs" role="tablist" style={{ marginBottom: 32 }}>
        {(['resumen', 'solicitudes', 'pedidos', 'catalogo'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setParams({ tab: t })}>
            {{ resumen: 'Resumen', solicitudes: 'Solicitudes', pedidos: 'Pedidos', catalogo: 'Catálogo' }[t]}
          </button>
        ))}
      </div>
      {tab === 'resumen' && <Summary i={i} onChange={imp.reload} />}
      {tab === 'solicitudes' && <Requests />}
      {tab === 'pedidos' && <ImporterOrders />}
      {tab === 'catalogo' && <OwnCatalog />}
    </Page>
  );
}

function Summary({ i, onChange }: { i: Importer; onChange: () => Promise<void> }) {
  const s = useSession();
  const a = useAction();
  const wallet = s.me?.wallets.find((w) => w.verified && w.address === s.signer?.address);
  return (
    <div className="grid-2">
      <dl className="kv">
        <Row k="Estado" v={STATUS[i.status]} />
        <Row k="Wallet de cobro" v={i.walletAddress ? <Hash value={i.walletAddress} /> : 'Sin configurar'} />
        <Row k="Pedido máximo" v={BigInt(i.limits.maxOrderAmountAtomic) > 0n ? usdc(i.limits.maxOrderAmountAtomic) : 'Pendiente de asignar'} />
        <Row k="Modalidades" v={i.limits.allowedModes.map((m) => (m === 'FULL_ESCROW' ? 'Escrow completo' : 'Anticipo parcial')).join(' · ')} />
        <Row k="Anticipo máximo" v={i.limits.maxAdvanceBps ? pct(i.limits.maxAdvanceBps) : 'Deshabilitado'} />
      </dl>
      <div className="stack">
        {!i.walletAddress && (
          <WalletGate reason="Conecta la wallet donde cobrarás.">
            <p className="t-body">Cobrarás en {wallet ? <Hash value={wallet.address} /> : 'tu wallet activa'}. Solo el propietario puede cambiarla.</p>
            <button
              className="btn"
              aria-busy={a.busy}
              disabled={a.busy || !wallet}
              onClick={() => void a.run(async () => (await api('/importers/me/wallet/verify', { body: { walletId: wallet!.id } }), await onChange()))}
            >
              Usar esta wallet para cobrar <Arrow />
            </button>
          </WalletGate>
        )}
        {i.status === 'PENDING' && <p className="note note-muted">Montuno revisa tu importadora. Cuando te verifique podrás publicar cotizaciones.</p>}
        <ErrorNote error={a.error} />
      </div>
    </div>
  );
}

function Requests() {
  const r = useLoad(() => api<QuoteRequest[]>('/importers/me/quote-requests'), []);
  if (r.loading) return <Loading />;
  if (r.error) return <ErrorNote error={r.error} onRetry={r.reload} />;
  if (!r.data!.length) return <Empty title="Sin solicitudes todavía" detail="Cuando un comprador pida cotización desde tu catálogo, aparecerá aquí." />;
  return (
    <div className="ledger">
      {r.data!.map((q, i) => (
        <div key={q.id} className="ledger-row">
          <span className="t-mono t-muted">{String(i + 1).padStart(2, '0')}</span>
          <span className="stack" style={{ ['--gap' as string]: '4px' }}>
            <strong>{q.catalogItem?.title ?? q.productUrl}</strong>
            <span className="hint">{q.quantity} u. · {q.destinationCity} · «{q.details}»</span>
          </span>
          {q.status === 'OPEN' ? (
            <Link className="btn btn-sm" to={`/importadora/cotizar?solicitud=${q.id}`}>Cotizar →</Link>
          ) : (
            <span className="t-label">{q.status === 'QUOTED' ? 'Cotizada' : 'Cerrada'}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function ImporterOrders() {
  const o = useLoad(() => api<OrderView[]>('/importers/me/orders'), []);
  if (o.loading) return <Loading />;
  if (o.error) return <ErrorNote error={o.error} onRetry={o.reload} />;
  if (!o.data!.length) return <Empty title="Sin pedidos aún" detail="Cuando un comprador acepte una cotización, la verás aquí." />;
  return (
    <div className="ledger">
      {o.data!.map((x, i) => (
        <Link key={x.id} className="ledger-row" to={`/pedidos/${x.id}`}>
          <span className="t-mono t-muted">{String(i + 1).padStart(2, '0')}</span>
          <span className="stack" style={{ ['--gap' as string]: '4px' }}>
            <strong>{x.product?.name}</strong>
            <span className="hint">{x.summary.label}</span>
          </span>
          <span className="t-num">{usdc(x.escrow.amountAtomic)} <span className="ledger-go">→</span></span>
        </Link>
      ))}
    </div>
  );
}

const CATS = ['tecnologia', 'telefonia', 'audio', 'hogar', 'moda', 'deporte', 'belleza', 'juguetes', 'herramientas', 'otros'];

function OwnCatalog() {
  const list = useLoad(() => api<CatalogItem[]>('/importers/me/catalog'), []);
  const a = useAction();
  const [f, setF] = useState({ title: '', category: 'tecnologia', description: '', referencePriceFiat: '', referenceUrl: '', deliveryEstimateDays: 20 });
  const add = (e: FormEvent) => {
    e.preventDefault();
    void a.run(async () => {
      await api('/importers/me/catalog', { body: { ...f, fiatCurrency: 'BOB', referenceUrl: f.referenceUrl || undefined } });
      setF({ ...f, title: '', description: '', referencePriceFiat: '', referenceUrl: '' });
      await list.reload();
    });
  };
  return (
    <div className="grid-2">
      <form className="stack" onSubmit={add}>
        <span className="t-label">Publicar producto de referencia</span>
        <label className="field"><span>Producto</span><input className="input" required minLength={3} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label className="field"><span>Categoría</span><select className="select" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="field"><span>Descripción</span><textarea className="textarea" required minLength={10} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <div className="row">
          <label className="field" style={{ flex: 1 }}><span>Precio ref. (Bs)</span><input className="input t-num" required pattern="[0-9]+(\.[0-9]{1,2})?" value={f.referencePriceFiat} onChange={(e) => setF({ ...f, referencePriceFiat: e.target.value })} /></label>
          <label className="field" style={{ flex: 1 }}><span>Días</span><input className="input t-num" type="number" min={1} max={365} value={f.deliveryEstimateDays} onChange={(e) => setF({ ...f, deliveryEstimateDays: Number(e.target.value) })} /></label>
        </div>
        <label className="field"><span>Enlace de la tienda (https)</span><input className="input" type="url" value={f.referenceUrl} onChange={(e) => setF({ ...f, referenceUrl: e.target.value })} /></label>
        <button className="btn" aria-busy={a.busy} disabled={a.busy}>Publicar <Arrow /></button>
        <ErrorNote error={a.error} />
      </form>
      <div className="stack">
        <span className="t-label">Tus productos</span>
        {list.loading ? <Loading /> : !list.data?.length ? <p className="t-body">Aún no publicaste productos.</p> : (
          <div className="ledger">
            {list.data.map((it) => (
              <div key={it.id} className="ledger-row" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                <span className="stack" style={{ ['--gap' as string]: '4px' }}>
                  <strong style={{ opacity: it.active ? 1 : 0.45 }}>{it.title}</strong>
                  <span className="hint">{fiat(it.referencePrice.amount, it.referencePrice.currency)} · {it.deliveryEstimateDays} días</span>
                </span>
                <button className="btn-link" onClick={() => void api(`/importers/me/catalog/${it.id}`, { method: 'PATCH', body: { active: !it.active } }).then(list.reload)}>
                  {it.active ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Asistente guiado de cotización (no es un chat: una decisión por paso)
// ---------------------------------------------------------------------------

const STEPS = ['Producto', 'Precio', 'Protección', 'Plazos', 'Revisión'] as const;

export function QuoteWizard() {
  const s = useSession();
  const [params] = useSearchParams();
  const reqId = params.get('solicitud');
  const imp = useLoad(() => api<Importer>('/importers/me'), []);
  const reqs = useLoad(() => (reqId ? api<QuoteRequest[]>('/importers/me/quote-requests') : Promise.resolve([])), [reqId]);
  const req = reqs.data?.find((r) => r.id === reqId);
  const [step, setStep] = useState(0);
  const [f, setF] = useState({
    productUrl: '',
    productName: '',
    productVariant: '',
    quantity: 1,
    destinationCity: 'La Paz',
    deliveryEstimateDays: 20,
    purchaseTerms: 'Compra en la tienda oficial; envío por courier; entrega en mano.',
    fiatPrice: '',
    fxRate: '6.96',
    totalUsdc: '',
    serviceFeeUsdc: '0',
    escrowMode: 'FULL_ESCROW' as EscrowMode,
    advanceUsdc: '',
    engine: 'MONTUNO',
    expiresHours: 24,
    fulfillmentDays: 30,
  });
  const [prefilled, setPrefilled] = useState(false);
  if (req && !prefilled) {
    setPrefilled(true);
    setF((x) => ({ ...x, productName: req.catalogItem?.title ?? '', productUrl: req.productUrl ?? '', productVariant: req.details.slice(0, 200), quantity: req.quantity, destinationCity: req.destinationCity }));
  }
  const a = useAction();
  const [result, setResult] = useState<{ token: string; url: string } | null>(null);

  const calc = useMemo(() => {
    try {
      const total = toAtomic(f.totalUsdc || '0');
      const adv = f.escrowMode === 'PARTIAL_ADVANCE' ? toAtomic(f.advanceUsdc || '0') : 0n;
      const fee = toAtomic(f.serviceFeeUsdc || '0');
      return { total, adv, fee, bps: total > 0n ? Number((adv * 10000n) / total) : 0, ok: true };
    } catch {
      return { total: 0n, adv: 0n, fee: 0n, bps: 0, ok: false };
    }
  }, [f.totalUsdc, f.advanceUsdc, f.serviceFeeUsdc, f.escrowMode]);

  if (imp.loading) return <div className="wrap"><Loading /></div>;
  const i = imp.data;
  const engines = s.config?.escrowEngines ?? [];
  const maxBps = i?.limits.maxAdvanceBps ?? 0;
  const partialAllowed = !!i?.limits.allowedModes.includes('PARTIAL_ADVANCE') && maxBps > 0;
  const stepValid = [
    f.productName.length >= 2 && /^https:\/\//.test(f.productUrl) && f.destinationCity.length >= 2,
    calc.ok && calc.total > 0n && /^[0-9]+(\.[0-9]{1,2})?$/.test(f.fiatPrice) && calc.fee <= calc.total,
    f.escrowMode === 'FULL_ESCROW' || (calc.adv > 0n && calc.adv < calc.total && calc.bps <= maxBps),
    f.expiresHours >= 1 && f.fulfillmentDays >= 1,
    true,
  ];

  const publish = () =>
    a.run(async () => {
      const expiresAt = new Date(Date.now() + f.expiresHours * 3600e3).toISOString();
      const q = await api<{ id: string }>('/quotes', {
        idempotent: true,
        body: {
          productUrl: f.productUrl,
          productName: f.productName,
          productVariant: f.productVariant || undefined,
          quantity: f.quantity,
          destinationCity: f.destinationCity,
          deliveryEstimateDays: f.deliveryEstimateDays,
          purchaseTerms: f.purchaseTerms,
          fiatPrice: f.fiatPrice,
          fiatCurrency: 'BOB',
          amountAtomic: calc.total.toString(),
          serviceFeeAtomic: calc.fee.toString(),
          fx: { rate: f.fxRate, spreadBps: 0, source: 'importadora', expiresAt },
          escrowMode: f.escrowMode,
          escrowEngine: f.engine,
          advanceAmountAtomic: calc.adv.toString(),
          expiresAt,
          fulfillmentDeadline: new Date(Date.now() + f.fulfillmentDays * 86400e3).toISOString(),
          ...(reqId ? { quoteRequestId: reqId } : {}),
        },
      });
      const p = await api<{ checkout: { token: string } }>(`/quotes/${q.id}/publish`, { method: 'POST', idempotent: true });
      setResult({ token: p.checkout.token, url: `${location.origin}/c/${p.checkout.token}` });
    });

  if (result)
    return (
      <Page eyebrow="Cotización publicada" title="Listo. Envía el enlace por WhatsApp." lead="El enlace es privado y se muestra una sola vez. Guárdalo o compártelo ahora.">
        <div className="panel stack" style={{ maxWidth: 720 }}>
          <span className="t-label">Enlace de checkout</span>
          <Hash value={result.url} label={result.url} />
          <div className="row">
            <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(`Tu cotización de ${f.productName}: ${result.url}`)}`} target="_blank" rel="noreferrer">
              Compartir por WhatsApp <Arrow />
            </a>
            <Link className="btn btn-ghost" to={`/c/${result.token}`}>Ver como comprador</Link>
          </div>
          {reqId && <p className="hint">El comprador también la verá en «Mis pedidos».</p>}
        </div>
      </Page>
    );

  return (
    <div className="wrap enter" style={{ paddingTop: 'clamp(40px, 6vw, 80px)', paddingBottom: 96 }}>
      <div className="t-label" style={{ marginBottom: 20 }}>Asistente de cotización{req ? ` · solicitud de ${req.destinationCity}` : ''}</div>
      <div className="wizard-steps" aria-label="Progreso">
        {STEPS.map((st, k) => <span key={st} data-state={k < step ? 'done' : k === step ? 'current' : 'todo'}>{String(k + 1).padStart(2, '0')} {st}</span>)}
      </div>
      <form
        className="grid-2"
        style={{ marginTop: 'clamp(32px, 5vw, 56px)' }}
        onSubmit={(e) => {
          e.preventDefault();
          if (step < STEPS.length - 1) setStep(step + 1);
          else void publish();
        }}
      >
        <div className="stack">
          <h1 className="t-h1">
            {['¿Qué vas a traer?', '¿Cuánto cuesta en total?', '¿Cómo se protege el pago?', '¿Cuándo vence y cuándo entregas?', 'Revisa antes de publicar.'][step]}
          </h1>
          <p className="t-lead">
            {[
              'El producto exacto y a dónde lo entregas. El comprador lo verá tal cual.',
              'El precio final en bolivianos y los USDC exactos que entrarán al contrato. Incluye tus comisiones.',
              'Elige si cobras todo al final o un anticipo fijo para comprar.',
              'Si la cotización vence antes del pago, tendrás que emitir una nueva.',
              'Al publicar, los términos se congelan y se firma su huella. Cambiarlos exige una nueva cotización.',
            ][step]}
          </p>
        </div>
        <div className="stack" style={{ ['--gap' as string]: '18px' }}>
          {step === 0 && (
            <>
              <label className="field"><span>Producto</span><input className="input" required value={f.productName} onChange={(e) => setF({ ...f, productName: e.target.value })} /></label>
              <label className="field"><span>Variante / detalles</span><input className="input" value={f.productVariant} onChange={(e) => setF({ ...f, productVariant: e.target.value })} /></label>
              <label className="field"><span>Enlace de la tienda (https)</span><input className="input" type="url" required value={f.productUrl} onChange={(e) => setF({ ...f, productUrl: e.target.value })} /></label>
              <div className="row">
                <label className="field" style={{ flex: 1 }}><span>Cantidad</span><input className="input t-num" type="number" min={1} max={100} value={f.quantity} onChange={(e) => setF({ ...f, quantity: Number(e.target.value) })} /></label>
                <label className="field" style={{ flex: 2 }}><span>Ciudad</span><input className="input" required value={f.destinationCity} onChange={(e) => setF({ ...f, destinationCity: e.target.value })} /></label>
              </div>
              <label className="field"><span>Condiciones de compra</span><textarea className="textarea" required value={f.purchaseTerms} onChange={(e) => setF({ ...f, purchaseTerms: e.target.value })} /></label>
            </>
          )}
          {step === 1 && (
            <>
              <label className="field"><span>Precio final (Bs)</span><input className="input t-num" inputMode="decimal" required value={f.fiatPrice} onChange={(e) => setF({ ...f, fiatPrice: e.target.value })} placeholder="8352.00" /></label>
              <label className="field"><span>Total al contrato (USDC)</span><input className="input t-num" inputMode="decimal" required value={f.totalUsdc} onChange={(e) => setF({ ...f, totalUsdc: e.target.value })} placeholder="1200" /><span className="hint">Este monto exacto entra al escrow. No se asume tipo de cambio fijo.</span></label>
              <div className="row">
                <label className="field" style={{ flex: 1 }}><span>Tipo de cambio declarado</span><input className="input t-num" value={f.fxRate} onChange={(e) => setF({ ...f, fxRate: e.target.value })} /></label>
                <label className="field" style={{ flex: 1 }}><span>Tu comisión incluida (USDC)</span><input className="input t-num" value={f.serviceFeeUsdc} onChange={(e) => setF({ ...f, serviceFeeUsdc: e.target.value })} /></label>
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <div className="choice" role="radiogroup">
                <label>
                  <input type="radio" checked={f.escrowMode === 'FULL_ESCROW'} onChange={() => setF({ ...f, escrowMode: 'FULL_ESCROW' })} />
                  <span className="stack" style={{ ['--gap' as string]: '4px' }}><strong>Escrow completo</strong><span className="hint">Compras con tu capital; cobras todo al confirmar la entrega.</span></span>
                </label>
                <label style={{ opacity: partialAllowed ? 1 : 0.45 }}>
                  <input type="radio" disabled={!partialAllowed} checked={f.escrowMode === 'PARTIAL_ADVANCE'} onChange={() => setF({ ...f, escrowMode: 'PARTIAL_ADVANCE', engine: 'MONTUNO' })} />
                  <span className="stack" style={{ ['--gap' as string]: '4px' }}>
                    <strong>Anticipo parcial</strong>
                    <span className="hint">{partialAllowed ? `Cobras un anticipo fijo antes de comprar (máx. ${pct(maxBps)}).` : 'Montuno aún no habilitó el anticipo para tu importadora.'}</span>
                  </span>
                </label>
              </div>
              {f.escrowMode === 'PARTIAL_ADVANCE' && (
                <label className="field">
                  <span>Anticipo (USDC)</span>
                  <input className="input t-num" inputMode="decimal" value={f.advanceUsdc} onChange={(e) => setF({ ...f, advanceUsdc: e.target.value })} />
                  {calc.ok && calc.total > 0n && <span className="hint">{pct(calc.bps)} del total · protegido para el comprador: {usdc(calc.total - calc.adv)}</span>}
                </label>
              )}
              {engines.length > 1 && f.escrowMode === 'FULL_ESCROW' && (
                <label className="field">
                  <span>Motor de escrow</span>
                  <select className="select" value={f.engine} onChange={(e) => setF({ ...f, engine: e.target.value })}>
                    {engines.map((e) => <option key={e.id} value={e.id}>{e.label}{e.beta ? ' (beta)' : ''}</option>)}
                  </select>
                </label>
              )}
            </>
          )}
          {step === 3 && (
            <>
              <label className="field"><span>La cotización vence en (horas)</span><input className="input t-num" type="number" min={1} max={168} value={f.expiresHours} onChange={(e) => setF({ ...f, expiresHours: Number(e.target.value) })} /></label>
              <label className="field"><span>Entrega estimada (días)</span><input className="input t-num" type="number" min={1} max={365} value={f.deliveryEstimateDays} onChange={(e) => setF({ ...f, deliveryEstimateDays: Number(e.target.value) })} /></label>
              <label className="field"><span>Plazo máximo pactado (días)</span><input className="input t-num" type="number" min={1} max={365} value={f.fulfillmentDays} onChange={(e) => setF({ ...f, fulfillmentDays: Number(e.target.value) })} /><span className="hint">Un retraso permite abrir disputa; nunca libera fondos solo.</span></label>
            </>
          )}
          {step === 4 && (
            <dl className="kv">
              <Row k="Producto" v={`${f.productName}${f.productVariant ? ' · ' + f.productVariant : ''} × ${f.quantity}`} />
              <Row k="Precio" v={`Bs ${fmtDecimal(f.fiatPrice || '0')}`} />
              <Row k="Al contrato" v={usdc(calc.total)} />
              <Row k="Modalidad" v={f.escrowMode === 'FULL_ESCROW' ? 'Escrow completo' : `Anticipo ${usdc(calc.adv)} (${pct(calc.bps)})`} />
              <Row k="Protegido" v={usdc(calc.total - calc.adv)} />
              <Row k="Motor" v={engines.find((e) => e.id === f.engine)?.label ?? f.engine} />
              <Row k="Vence" v={`en ${f.expiresHours} h`} />
              <Row k="Plazo" v={`${f.fulfillmentDays} días`} />
              {i && <Row k="Tu límite" v={usdc(i.limits.maxOrderAmountAtomic)} />}
            </dl>
          )}
          <div className="row between" style={{ marginTop: 8 }}>
            {step > 0 ? <button type="button" className="btn-link" onClick={() => setStep(step - 1)}>← Atrás</button> : <Link className="btn-link" to="/importadora">Cancelar</Link>}
            <button className="btn" disabled={!stepValid[step] || a.busy} aria-busy={a.busy}>
              {step < STEPS.length - 1 ? 'Siguiente' : 'Publicar y obtener enlace'} <Arrow />
            </button>
          </div>
          <ErrorNote error={a.error} />
          {step === 1 && calc.ok && calc.total > 0n && <p className="hint t-mono">{fromAtomic(calc.total)} USDC = {calc.total.toString()} unidades atómicas</p>}
        </div>
      </form>
    </div>
  );
}
