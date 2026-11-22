import { useNavigate } from 'react-router-dom';
import { WalletGate } from '../components/WalletGate';
import { ErrorNote, Hash, Page, Row, useAction } from '../components/ui';
import { useSession } from '../lib/session';

export function Account() {
  const s = useSession();
  const nav = useNavigate();
  const a = useAction();
  if (!s.me) return <Page eyebrow="Cuenta" title="Tu cuenta."><WalletGate>{null}</WalletGate></Page>;
  return (
    <Page eyebrow="Cuenta" title="Tu cuenta.">
      <div className="grid-2">
        <dl className="kv">
          <Row k="Correo" v={s.me.email ?? '—'} />
          <Row k="Roles" v={s.me.roles.join(' · ')} />
          <Row k="Firmante activo" v={s.signer ? <span>{s.signer.kind} · <Hash value={s.signer.address} /></span> : 'ninguno'} />
          {s.me.wallets.map((w) => (
            <Row key={w.id} k={`Wallet ${w.provider}`} v={<span><Hash value={w.address} href={s.mode === 'TESTNET' ? `${s.config?.explorerBaseUrl}/account/${w.address}` : undefined} /> {w.verified ? '· verificada' : ''}</span>} />
          ))}
        </dl>
        <div className="stack">
          {s.signer && s.mode === 'TESTNET' && s.signer.kind === 'test' && (
            <button className="btn btn-ghost" aria-busy={a.busy} disabled={a.busy} onClick={() => void a.run(async () => alert(await s.prepareTestnetWallet(s.signer!)))}>
              Preparar wallet de prueba en Testnet (XLM + USDC)
            </button>
          )}
          <WalletGate>
            <p className="hint">Tu wallet activa está verificada.</p>
          </WalletGate>
          <button className="btn btn-ghost" onClick={() => void s.logout().then(() => nav('/'))}>Salir</button>
          <ErrorNote error={a.error} />
        </div>
      </div>
    </Page>
  );
}
