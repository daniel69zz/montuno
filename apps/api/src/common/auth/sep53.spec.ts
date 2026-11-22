import { Keypair } from '@stellar/stellar-sdk';
import { execFileSync } from 'child_process';
import { signSep53, verifySep53 } from './sep53';

const hasCli = (() => {
  try {
    execFileSync('stellar', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('SEP-53', () => {
  it('firma y verifica; rechaza mensaje/cuenta distintos', () => {
    const kp = Keypair.random();
    const msg = 'localhost solicita verificar\nNonce: abc';
    const sig = signSep53(kp, msg);
    expect(verifySep53(kp.publicKey(), msg, sig)).toBe(true);
    expect(verifySep53(kp.publicKey(), msg + 'x', sig)).toBe(false);
    expect(verifySep53(Keypair.random().publicKey(), msg, sig)).toBe(false);
    expect(verifySep53('GNOTVALID', msg, sig)).toBe(false);
    expect(verifySep53(kp.publicKey(), msg, 'AAAA')).toBe(false);
  });

  (hasCli ? it : it.skip)(
    'coincide byte a byte con `stellar message sign` (referencia independiente)',
    () => {
      const kp = Keypair.random(); // clave desechable, nunca fondeada
      const msg = 'Mensaje de prueba ñ áé\nlínea 2';
      const out = execFileSync('stellar', ['message', 'sign', msg], {
        env: { ...process.env, STELLAR_SIGN_WITH_KEY: kp.secret() },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      expect(out).toBe(signSep53(kp, msg));
      expect(verifySep53(kp.publicKey(), msg, out)).toBe(true);
    },
  );
});
