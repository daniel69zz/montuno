import { Link } from 'react-router-dom';
import { Arrow, Mark } from '../components/ui';
import { useSession } from '../lib/session';

/** Silueta de cordillera en líneas: el único elemento gráfico de la portada. */
function Ridge() {
  return (
    <svg viewBox="0 0 600 220" width="100%" aria-hidden="true" style={{ display: 'block' }}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <polyline
          key={i}
          fill="none"
          stroke={i === 0 ? 'var(--c-snow)' : 'var(--c-line)'}
          strokeWidth={i === 0 ? 1.5 : 1}
          points={`0,${220 - i * 4} 110,${150 - i * 4} 170,${178 - i * 4} 290,${40 + i * 8} 360,${120 - i * 2} 420,${92 + i * 3} 600,${220 - i * 4}`}
        />
      ))}
      <line x1="290" y1="40" x2="290" y2="220" stroke="var(--c-snow)" strokeWidth="1" />
    </svg>
  );
}

const STEPS = [
  { n: '01', t: 'Recibes un enlace', d: 'La importadora te cotiza por WhatsApp y te manda un enlace privado con el precio final, el plazo y las condiciones.' },
  { n: '02', t: 'Pagas al escrow, no a la persona', d: 'Tu pago entra a un contrato inteligente en Stellar. Nadie puede moverlo fuera de las reglas que aceptaste.' },
  { n: '03', t: 'Confirmas y se libera', d: 'Cuando recibes tu pedido, confirmas y el contrato le paga a la importadora. Si algo sale mal, decide un árbitro.' },
];

export function Home() {
  const { me, mode } = useSession();
  return (
    <>
      <section className="wrap enter" style={{ paddingTop: 'clamp(48px, 9vw, 128px)', paddingBottom: 'clamp(48px, 7vw, 96px)' }}>
        <div className="t-label" style={{ marginBottom: 28 }}>
          Importaciones bajo pedido · Bolivia
        </div>
        <h1 className="t-display" style={{ maxWidth: '11ch' }}>
          Compra afuera. Paga sin miedo.
        </h1>
        <div className="grid-2" style={{ marginTop: 'clamp(32px, 5vw, 64px)', alignItems: 'end' }}>
          <div className="stack" style={{ ['--gap' as string]: '28px' }}>
            <p className="t-lead">
              Montuno guarda tu pago en un contrato inteligente hasta que recibes lo que pediste. La importadora sabe que el dinero existe; tú sabes que
              no se va sin tu confirmación.
            </p>
            <div className="row">
              <Link className="btn" to="/catalogo">
                Explorar el catálogo <Arrow />
              </Link>
              <Link className="btn btn-ghost" to={me?.memberships.length ? '/importadora' : '/importadora/registro'}>
                Soy importadora
              </Link>
            </div>
            <p className="hint">
              ¿Ya te mandaron un enlace de cotización? Ábrelo directamente: te trae aquí. {mode === 'DEMO' && 'Estás en modo DEMO: nada sale a Stellar.'}
            </p>
          </div>
          <Ridge />
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="grid-2">
            <div className="stack">
              <div className="t-label">Cómo funciona</div>
              <h2 className="t-h1">Tres pasos. Ninguno a ciegas.</h2>
            </div>
            <ol className="ledger" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {STEPS.map((s) => (
                <li key={s.n} className="ledger-row" style={{ gridTemplateColumns: '56px minmax(0,1fr)' }}>
                  <span className="t-mono t-muted">{s.n}</span>
                  <div className="stack" style={{ ['--gap' as string]: '6px' }}>
                    <h3 className="t-h3">{s.t}</h3>
                    <p className="t-body">{s.d}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap grid-2">
          <div className="stack">
            <div className="t-label">Dos formas de proteger</div>
            <h2 className="t-h1">Tú eliges cuánto queda guardado.</h2>
          </div>
          <dl className="kv">
            <dt>Escrow completo</dt>
            <dd className="stack" style={{ ['--gap' as string]: '6px' }}>
              <strong>El 100% queda retenido</strong>
              <span className="t-muted">Para importadoras con capital propio. Nada se libera hasta que confirmes la entrega.</span>
            </dd>
            <dt>Anticipo parcial</dt>
            <dd className="stack" style={{ ['--gap' as string]: '6px' }}>
              <strong>Un anticipo fijo, aceptado por ti, antes de comprar</strong>
              <span className="t-muted">
                La importadora cobra una parte para poder comprar. Si incumple, solo recuperas lo que sigue retenido: te lo mostramos con claridad antes de
                pagar.
              </span>
            </dd>
            <dt>Siempre</dt>
            <dd className="t-muted">Tus datos personales no van a la blockchain. Solo montos, wallets y la huella de las condiciones.</dd>
          </dl>
        </div>
      </section>

      <section className="section">
        <div className="wrap row between" style={{ alignItems: 'flex-end' }}>
          <div className="stack">
            <Mark size={32} />
            <h2 className="t-h2" style={{ maxWidth: '22ch' }}>
              Hecho sobre Stellar. Verificable en cada paso.
            </h2>
          </div>
          <Link className="btn btn-ghost" to="/proveedores">
            Ver importadoras verificadas <Arrow />
          </Link>
        </div>
      </section>
    </>
  );
}
