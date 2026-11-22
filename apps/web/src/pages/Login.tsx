import { FormEvent, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Arrow, ErrorNote, Page, useAction } from '../components/ui';
import { useSession } from '../lib/session';

type Method = 'email' | 'freighter' | 'test';

export function Login() {
  const s = useSession();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/pedidos';
  const pollarOn = !!s.config?.pollar;
  const mockOn = !!s.config?.auth.methods.includes('mock-email-otp');
  const [method, setMethod] = useState<Method>(pollarOn ? 'email' : 'freighter');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [secret, setSecret] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [devCode, setDevCode] = useState<string>();
  const [usePollar, setUsePollar] = useState(pollarOn);
  const a = useAction();

  const done = () => nav(next, { replace: true });

  const onEmail = (e: FormEvent) => {
    e.preventDefault();
    void a.run(async () => {
      if (stage === 'email') {
        if (usePollar) await s.startPollarEmail(email);
        else setDevCode(await s.requestMockOtp(email));
        setStage('code');
        return;
      }
      if (usePollar) await s.confirmPollarCode(code);
      else await s.loginMockOtp(email, code);
      done();
    });
  };

  return (
    <Page
      eyebrow="Acceso"
      title="Entra con tu wallet."
      lead="Tu identidad es tu wallet de Stellar: firmas un mensaje de un solo uso y Montuno lo verifica. Nunca pedimos ni guardamos claves."
      aside={
        <div className="stack" style={{ ['--gap' as string]: '24px' }}>
          <div className="choice" role="radiogroup" aria-label="Método de acceso">
            {(pollarOn || mockOn) && (
              <label>
                <input type="radio" name="m" checked={method === 'email'} onChange={() => setMethod('email')} />
                <span className="stack" style={{ ['--gap' as string]: '4px' }}>
                  <strong>Con tu correo</strong>
                  <span className="hint">{pollarOn ? 'Pollar crea una wallet para ti. No anotas 24 palabras.' : 'Código simulado (DEMO). Después vinculas una wallet.'}</span>
                </span>
              </label>
            )}
            <label>
              <input type="radio" name="m" checked={method === 'freighter'} onChange={() => setMethod('freighter')} />
              <span className="stack" style={{ ['--gap' as string]: '4px' }}>
                <strong>Con Freighter</strong>
                <span className="hint">Extensión de wallet Stellar en tu navegador.</span>
              </span>
            </label>
            <label>
              <input type="radio" name="m" checked={method === 'test'} onChange={() => setMethod('test')} />
              <span className="stack" style={{ ['--gap' as string]: '4px' }}>
                <strong>Wallet de prueba</strong>
                <span className="hint">Para la demo. La clave vive solo en esta pestaña.</span>
              </span>
            </label>
          </div>

          {method === 'email' && (
            <form className="stack" onSubmit={onEmail}>
              {pollarOn && mockOn && (
                <label className="check">
                  <input type="checkbox" checked={!usePollar} onChange={(e) => setUsePollar(!e.target.checked)} />
                  <span>Usar código simulado (DEMO) en lugar de Pollar</span>
                </label>
              )}
              {stage === 'email' ? (
                <label className="field">
                  <span>Correo</span>
                  <input className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </label>
              ) : (
                <label className="field">
                  <span>Código de 6 dígitos</span>
                  <input className="input t-num" inputMode="numeric" pattern="[0-9]{6}" required autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
                  {devCode && <span className="hint">DEMO: tu código es <span className="t-mono t-snow">{devCode}</span></span>}
                  {usePollar && <span className="hint">Revisa tu correo. El código lo envía Pollar.</span>}
                </label>
              )}
              <button className="btn btn-full" aria-busy={a.busy} disabled={a.busy}>
                {stage === 'email' ? 'Enviarme el código' : 'Entrar'} <Arrow />
              </button>
              {stage === 'code' && (
                <button type="button" className="btn-link" onClick={() => setStage('email')}>
                  Cambiar correo
                </button>
              )}
            </form>
          )}

          {method === 'freighter' && (
            <button className="btn btn-full" aria-busy={a.busy} disabled={a.busy} onClick={() => void a.run(async () => (await s.loginWithSigner(await s.connectFreighter()), done()))}>
              Conectar y firmar con Freighter <Arrow />
            </button>
          )}

          {method === 'test' && (
            <div className="stack">
              <label className="field">
                <span>Clave secreta (opcional)</span>
                <input className="input t-mono" placeholder="S… — déjalo vacío para crear una nueva" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" spellCheck={false} />
                <span className="hint">Solo para cuentas de prueba sin valor. Se borra al cerrar la pestaña.</span>
              </label>
              <button className="btn btn-full" aria-busy={a.busy} disabled={a.busy} onClick={() => void a.run(async () => (await s.loginWithSigner(await s.useTestWallet(secret)), done()))}>
                Entrar con wallet de prueba <Arrow />
              </button>
            </div>
          )}
          <ErrorNote error={a.error} />
        </div>
      }
    />
  );
}
