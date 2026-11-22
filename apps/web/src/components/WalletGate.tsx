import { ReactNode, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useSession } from '../lib/session';
import { short } from '../lib/signers';
import { Arrow, ErrorNote, useAction } from './ui';

/**
 * Garantiza: sesión + firmante activo + wallet verificada (SEP-53). Si falta algo, pide UNA cosa.
 * `address` fuerza una wallet concreta (p. ej. la del pedido).
 */
export function WalletGate({ children, address, reason }: { children: ReactNode; address?: string; reason?: string }) {
  const s = useSession();
  const loc = useLocation();
  const a = useAction();
  const [secret, setSecret] = useState('');
  if (!s.me)
    return (
      <div className="stack">
        <p className="t-body">{reason ?? 'Necesitas entrar para continuar.'}</p>
        <Link className="btn" to={`/entrar?next=${encodeURIComponent(loc.pathname)}`}>
          Entrar <Arrow />
        </Link>
      </div>
    );
  const verified = s.me.wallets.filter((w) => w.verified).map((w) => w.address);
  const want = address;
  const signerOk = s.signer && (!want || s.signer.address === want);
  if (signerOk && verified.includes(s.signer!.address)) return <>{children}</>;

  if (signerOk && !verified.includes(s.signer!.address))
    return (
      <div className="stack">
        <p className="t-body">Verifica que la wallet {short(s.signer!.address)} es tuya: firmarás un mensaje, sin costo.</p>
        <button className="btn" aria-busy={a.busy} disabled={a.busy} onClick={() => void a.run(() => s.linkWallet(s.signer!))}>
          Verificar wallet <Arrow />
        </button>
        <ErrorNote error={a.error} />
      </div>
    );

  return (
    <div className="stack">
      <p className="t-body">
        {want ? `Esta operación la firma la wallet ${short(want)}. Conéctala:` : 'Conecta la wallet con la que vas a firmar:'}
      </p>
      <div className="row">
        <button className="btn" aria-busy={a.busy} disabled={a.busy} onClick={() => void a.run(() => s.connectFreighter())}>
          Freighter
        </button>
        <button className="btn btn-ghost" aria-busy={a.busy} disabled={a.busy} onClick={() => void a.run(() => s.useTestWallet(secret))}>
          Wallet de prueba
        </button>
      </div>
      <label className="field">
        <span>Clave de prueba (opcional)</span>
        <input className="input t-mono" placeholder="S…" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" spellCheck={false} />
      </label>
      {s.signer && want && s.signer.address !== want && <p className="hint">Tu wallet activa es {short(s.signer.address)}; no coincide.</p>}
      <ErrorNote error={a.error} />
    </div>
  );
}
