import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { humanError } from '../lib/api';
import { fmtDecimal, fromAtomic } from '../lib/money';
import { useSession } from '../lib/session';
import { short } from '../lib/signers';

/** Marca: macizo con un corte vertical (solidez + verticalidad). */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M2 28 L13 6 L19 18 L22.5 12 L30 28 Z" fill="currentColor" />
      <rect x="12.4" y="6" width="1.2" height="22" fill="var(--c-ink)" />
      <rect x="2" y="29" width="28" height="1" fill="currentColor" />
    </svg>
  );
}

export function NetBadge() {
  const { mode } = useSession();
  if (!mode) return null;
  return (
    <span className="net" data-kind={mode === 'DEMO' ? 'demo' : 'testnet'} title={mode === 'DEMO' ? 'Ledger simulado: nada se envía a Stellar' : 'Contrato real en Stellar Testnet (dinero de prueba)'}>
      {mode === 'DEMO' ? 'Demo · simulado' : 'Stellar Testnet'}
    </span>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const isImporter = !!me?.memberships.length;
  const isAdmin = !!me?.roles.includes('ADMIN');
  return (
    <>
      <a href="#main" className="sr-only">
        Saltar al contenido
      </a>
      <header className="hdr">
        <div className="wrap hdr-in">
          <Link to="/" className="brand" aria-label="Montuno, inicio">
            <Mark />
            MONTUNO
          </Link>
          <NetBadge />
          <button className="btn btn-ghost btn-sm menu-btn" aria-expanded={open} aria-controls="nav" onClick={() => setOpen((v) => !v)}>
            Menú
          </button>
          <nav id="nav" className="nav" data-open={open} aria-label="Principal">
            <NavLink to="/catalogo">Catálogo</NavLink>
            <NavLink to="/proveedores">Proveedores</NavLink>
            {me && <NavLink to="/pedidos">Mis pedidos</NavLink>}
            {isImporter && <NavLink to="/importadora">Mi importadora</NavLink>}
            {isAdmin && <NavLink to="/admin">Admin</NavLink>}
            {me ? <NavLink to="/cuenta">Cuenta</NavLink> : <NavLink to="/entrar">Entrar</NavLink>}
          </nav>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="ftr">
        <div className="wrap row between">
          <span>Montuno · pagos protegidos con escrow en Stellar</span>
          <span className="t-mono">MVP · Testnet · sin dinero real</span>
        </div>
      </footer>
    </>
  );
}

export function Page({ eyebrow, title, lead, children, aside }: { eyebrow?: string; title: ReactNode; lead?: ReactNode; children?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="wrap enter" style={{ paddingTop: 'clamp(40px, 7vw, 96px)', paddingBottom: 'clamp(56px, 8vw, 120px)' }}>
      <div className={aside ? 'grid-2' : undefined}>
        <div className="stack" style={{ ['--gap' as string]: '20px' }}>
          {eyebrow && <div className="t-label">{eyebrow}</div>}
          <h1 className="t-h1">{title}</h1>
          {lead && <p className="t-lead">{lead}</p>}
        </div>
        {aside}
      </div>
      {children && <div style={{ marginTop: 'clamp(32px, 5vw, 64px)' }}>{children}</div>}
    </div>
  );
}

export function Loading({ label = 'Cargando' }: { label?: string }) {
  return (
    <div className="row" role="status" aria-live="polite" style={{ padding: '24px 0' }}>
      <span className="loading" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="t-label">{label}</span>
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="note" role="alert">
      <div>{humanError(error)}</div>
      {onRetry && (
        <button className="btn-link" onClick={onRetry} style={{ marginTop: 8 }}>
          Reintentar
        </button>
      )}
    </div>
  );
}

export function Empty({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return (
    <div className="stack" style={{ padding: '48px 0', borderTop: 'var(--line)', borderBottom: 'var(--line)' }}>
      <Mark size={28} />
      <h2 className="t-h3">{title}</h2>
      {detail && <p className="t-body">{detail}</p>}
      {action}
    </div>
  );
}

export function Hash({ value, href, label }: { value: string; href?: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="row" style={{ ['--gap' as string]: '10px' }}>
      {href ? (
        <a className="hash" href={href} target="_blank" rel="noreferrer">
          {label ?? short(value)} ↗
        </a>
      ) : (
        <span className="hash" title={value}>
          {label ?? short(value)}
        </span>
      )}
      <button
        className="btn-link"
        style={{ fontSize: 12 }}
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        aria-label="Copiar"
      >
        {copied ? 'copiado' : 'copiar'}
      </button>
    </span>
  );
}

/**
 * Barra del escrow: muestra a dónde fue cada unidad del pago. Monocromo:
 * liberado = sólido, retenido = rayado, devuelto = contorno.
 */
export function EscrowBar({ total, released, retained, refunded }: { total: string; released: string; retained: string; refunded: string }) {
  const T = BigInt(total) || 1n;
  const w = (v: string) => Number((BigInt(v) * 10000n) / T) / 100;
  const parts = [
    { k: 'Liberado a la importadora', v: released, w: w(released), fill: 'var(--c-snow)' },
    { k: 'Retenido en el contrato', v: retained, w: w(retained), fill: 'url(#hatch)' },
    { k: 'Devuelto al comprador', v: refunded, w: w(refunded), fill: 'transparent' },
  ];
  let x = 0;
  return (
    <figure style={{ margin: 0 }} className="stack">
      <svg viewBox="0 0 100 10" preserveAspectRatio="none" width="100%" height="28" role="img" aria-label="Distribución del pago">
        <defs>
          <pattern id="hatch" width="1.6" height="10" patternUnits="userSpaceOnUse" patternTransform="skewX(-30)">
            <rect width="0.6" height="10" fill="var(--c-snow)" />
          </pattern>
        </defs>
        <rect x="0" y="0" width="100" height="10" fill="var(--c-ink)" stroke="var(--c-line)" strokeWidth="0.2" vectorEffect="non-scaling-stroke" />
        {parts.map((p) => {
          const r = (
            <rect key={p.k} x={x} y="0" width={p.w} height="10" fill={p.fill} stroke={p.fill === 'transparent' ? 'var(--c-muted)' : 'none'} strokeWidth="1" vectorEffect="non-scaling-stroke" />
          );
          x += p.w;
          return r;
        })}
      </svg>
      <figcaption>
        <dl className="kv">
          {parts.map((p) => (
            <Row key={p.k} k={p.k} v={<span className="t-num t-snow">{fmtDecimal(fromAtomic(p.v))} USDC</span>} />
          ))}
        </dl>
      </figcaption>
    </figure>
  );
}

export function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}

/** Carga de datos con estados de carga/error/reintento. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const n = ++seq.current;
    setLoading(true);
    setError(undefined);
    try {
      const d = await fn();
      if (n === seq.current) setData(d);
    } catch (e) {
      if (n === seq.current) setError(e);
    } finally {
      if (n === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

/** Acción con estado ocupado/error (evita doble envío). */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(undefined);
    try {
      return await fn();
    } catch (e) {
      setError(e);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, setError };
}

export function Arrow() {
  return (
    <span className="arw" aria-hidden="true">
      →
    </span>
  );
}
