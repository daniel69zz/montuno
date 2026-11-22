import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { Arrow, Empty, ErrorNote, Hash, Loading, Page, useAction, useLoad } from '../components/ui';
import { api } from '../lib/api';
import { pct, toAtomic, usdc } from '../lib/money';
import { useSession } from '../lib/session';
import type { EscrowMode, Importer } from '../lib/types';

const STATUS: Record<string, string> = { PENDING: 'En revisión', VERIFIED: 'Verificada', SUSPENDED: 'Suspendida' };

export function Admin() {
  const s = useSession();
  const list = useLoad(() => api<Importer[]>('/admin/importers'), [s.me?.id]);
  const [open, setOpen] = useState<string | null>(null);
  if (!s.me?.roles.includes('ADMIN'))
    return <Page eyebrow="Administración" title="Acceso restringido." lead="Entra con la cuenta de administración (en DEMO: admin@example.local con el código simulado)."><Link className="btn" to="/entrar?next=/admin">Entrar <Arrow /></Link></Page>;
  return (
    <Page eyebrow="Administración" title="Revisión de importadoras." lead="Verificación manual (KYB) y límites. Suspender detiene nuevas cotizaciones; nunca bloquea fondos ya depositados.">
      <div className="stack" style={{ ['--gap' as string]: '48px' }}>
        {list.loading ? <Loading /> : list.error ? <ErrorNote error={list.error} onRetry={list.reload} /> : !list.data!.length ? <Empty title="Sin importadoras registradas" /> : (
          <div className="ledger">
            {list.data!.map((i, k) => (
              <div key={i.id}>
                <div className="ledger-row" style={{ cursor: 'pointer' }} onClick={() => setOpen(open === i.id ? null : i.id)}>
                  <span className="t-mono t-muted">{String(k + 1).padStart(2, '0')}</span>
                  <span className="stack" style={{ ['--gap' as string]: '4px' }}>
                    <strong>{i.publicName}</strong>
                    <span className="hint">{STATUS[i.status]} · máx {usdc(i.limits.maxOrderAmountAtomic)} · anticipo {i.limits.maxAdvanceBps ? pct(i.limits.maxAdvanceBps) : 'no'}</span>
                  </span>
                  <span className="ledger-go">{open === i.id ? '−' : '+'}</span>
                </div>
                {open === i.id && <ImporterAdmin i={i} onChange={list.reload} />}
              </div>
            ))}
          </div>
        )}
        <GrantRole />
      </div>
    </Page>
  );
}

function ImporterAdmin({ i, onChange }: { i: Importer; onChange: () => Promise<void> }) {
  const a = useAction();
  const [max, setMax] = useState(String(Number(BigInt(i.limits.maxOrderAmountAtomic) / 10_000_000n) || 1000));
  const [bps, setBps] = useState(String(i.limits.maxAdvanceBps));
  const [modes, setModes] = useState<EscrowMode[]>(i.limits.allowedModes);
  const save = (e: FormEvent) => {
    e.preventDefault();
    void a.run(async () => {
      await api(`/admin/importers/${i.id}/limits`, { method: 'PATCH', body: { maxOrderAmountAtomic: toAtomic(max).toString(), maxAdvanceBps: Number(bps), allowedModes: modes } });
      await onChange();
    });
  };
  const toggle = (m: EscrowMode) => setModes(modes.includes(m) ? modes.filter((x) => x !== m) : [...modes, m]);
  return (
    <div className="panel stack" style={{ margin: '0 0 16px' }}>
      {i.walletAddress && <span className="hint">Wallet de cobro: <Hash value={i.walletAddress} /></span>}
      <div className="row">
        {i.status !== 'VERIFIED' && <button className="btn" aria-busy={a.busy} disabled={a.busy} onClick={() => void a.run(async () => (await api(`/admin/importers/${i.id}/verify`, { method: 'POST' }), await onChange()))}>Verificar</button>}
        {i.status !== 'SUSPENDED' && <button className="btn btn-ghost" aria-busy={a.busy} disabled={a.busy} onClick={() => void a.run(async () => (await api(`/admin/importers/${i.id}/suspend`, { method: 'POST' }), await onChange()))}>Suspender</button>}
      </div>
      <form className="stack" onSubmit={save}>
        <div className="row" style={{ alignItems: 'end' }}>
          <label className="field" style={{ flex: 1, minWidth: 160 }}><span>Pedido máximo (USDC)</span><input className="input t-num" value={max} onChange={(e) => setMax(e.target.value)} /></label>
          <label className="field" style={{ flex: 1, minWidth: 160 }}><span>Anticipo máx. (bps)</span><input className="input t-num" type="number" min={0} max={9000} value={bps} onChange={(e) => setBps(e.target.value)} /></label>
        </div>
        <label className="check"><input type="checkbox" checked={modes.includes('FULL_ESCROW')} onChange={() => toggle('FULL_ESCROW')} /><span>Escrow completo</span></label>
        <label className="check"><input type="checkbox" checked={modes.includes('PARTIAL_ADVANCE')} onChange={() => toggle('PARTIAL_ADVANCE')} /><span>Anticipo parcial (requiere bps &gt; 0)</span></label>
        <button className="btn btn-ghost" aria-busy={a.busy} disabled={a.busy || !modes.length}>Guardar límites</button>
      </form>
      <ErrorNote error={a.error} />
    </div>
  );
}

function GrantRole() {
  const a = useAction();
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<'ARBITER' | 'ADMIN'>('ARBITER');
  const [ok, setOk] = useState(false);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        setOk(false);
        void a.run(async () => (await api(`/admin/users/${userId}/roles`, { body: { role } }), setOk(true)));
      }}
    >
      <span className="t-label">Otorgar rol</span>
      <p className="t-body">El árbitro además necesita entrar con la wallet registrada como árbitro en el contrato.</p>
      <div className="row" style={{ alignItems: 'end' }}>
        <label className="field" style={{ flex: 2, minWidth: 240 }}><span>ID de usuario</span><input className="input t-mono" required value={userId} onChange={(e) => setUserId(e.target.value)} /></label>
        <label className="field" style={{ flex: 1, minWidth: 140 }}><span>Rol</span><select className="select" value={role} onChange={(e) => setRole(e.target.value as 'ARBITER' | 'ADMIN')}><option>ARBITER</option><option>ADMIN</option></select></label>
        <button className="btn btn-ghost" aria-busy={a.busy} disabled={a.busy}>Otorgar</button>
      </div>
      {ok && <p className="note note-muted">Rol otorgado.</p>}
      <ErrorNote error={a.error} />
    </form>
  );
}
