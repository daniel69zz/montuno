import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Asset, BASE_FEE, Horizon, Keypair, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { api, getToken, setToken } from './api';
import {
  freighterSigner,
  loadTestSecret,
  pollarClient,
  pollarLogout,
  pollarSigner,
  saveTestSecret,
  Signer,
  SignerKind,
  testSigner,
} from './signers';
import type { AppConfig, Me } from './types';

const TOKEN_KEY = 'montuno.session';
const KIND_KEY = 'montuno.signerKind';
// USDC de Circle en testnet (el SAC que usa el escrow desplegado). Solo para preparar wallets de prueba.
const CIRCLE_USDC_TESTNET = { code: 'USDC', issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', sac: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA' };

interface Session {
  config: AppConfig | null;
  configError: string | null;
  me: Me | null;
  signer: Signer | null;
  ready: boolean;
  /** DEMO = ledger simulado; TESTNET = contrato real en Stellar Testnet. */
  mode: 'DEMO' | 'TESTNET' | null;
  refreshMe(): Promise<Me | null>;
  loginWithSigner(s: Signer): Promise<void>;
  requestMockOtp(email: string): Promise<string | undefined>;
  loginMockOtp(email: string, code: string): Promise<void>;
  startPollarEmail(email: string): Promise<void>;
  confirmPollarCode(code: string): Promise<void>;
  connectFreighter(): Promise<Signer>;
  useTestWallet(secret?: string): Promise<Signer>;
  linkWallet(s: Signer): Promise<void>;
  prepareTestnetWallet(s: Signer): Promise<string>;
  logout(): Promise<void>;
}

const Ctx = createContext<Session | null>(null);

function persist(token: string | null, kind: SignerKind | null) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
    if (kind) sessionStorage.setItem(KIND_KEY, kind);
    else sessionStorage.removeItem(KIND_KEY);
  } catch {
    /* sin almacenamiento */
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [signer, setSigner] = useState<Signer | null>(null);
  const [ready, setReady] = useState(false);

  const refreshMe = useCallback(async () => {
    if (!getToken()) {
      setMe(null);
      return null;
    }
    try {
      const m = await api<Me>('/me');
      setMe(m);
      return m;
    } catch {
      setToken(null);
      persist(null, null);
      setMe(null);
      return null;
    }
  }, []);

  // Arranque: config + rehidratar sesión y firmante.
  useEffect(() => {
    (async () => {
      let cfg: AppConfig | null = null;
      try {
        cfg = await api<AppConfig>('/config');
        setConfig(cfg);
      } catch {
        setConfigError('No pudimos conectar con la API de Montuno.');
      }
      let saved: string | null = null;
      let kind: SignerKind | null = null;
      try {
        saved = sessionStorage.getItem(TOKEN_KEY);
        kind = sessionStorage.getItem(KIND_KEY) as SignerKind | null;
      } catch {
        /* nada */
      }
      if (saved) {
        setToken(saved);
        await refreshMe();
      }
      try {
        if (kind === 'test') {
          const s = loadTestSecret();
          if (s) setSigner(testSigner(s));
        } else if (kind === 'pollar' && cfg?.pollar) {
          const c = await pollarClient(cfg.pollar.apiKey, cfg.pollar.stellarNetwork);
          if (c.getAuthState().step === 'authenticated') setSigner(await pollarSigner(c));
        }
        // Freighter se reconecta a pedido (requiere un gesto del usuario).
      } catch {
        /* firmante no disponible: se pedirá al firmar */
      }
      setReady(true);
    })();
  }, [refreshMe]);

  const sessionFromSignature = useCallback(
    async (s: Signer) => {
      const ch = await api<{ challengeId: string; message: string }>('/auth/wallet/challenge', { body: { address: s.address } });
      const signature = await s.signMessage(ch.message);
      const walletProvider = s.kind === 'pollar' ? 'pollar' : s.kind === 'test' ? 'cli-test' : 'self-custody';
      const res = await api<{ accessToken: string }>('/auth/session', {
        body: { provider: 'stellar-wallet', walletProvider, challengeId: ch.challengeId, signature },
      });
      setToken(res.accessToken);
      persist(res.accessToken, s.kind);
      setSigner(s);
      await refreshMe();
    },
    [refreshMe],
  );

  const linkWallet = useCallback(
    async (s: Signer) => {
      const ch = await api<{ challengeId: string; message: string }>('/me/wallets/challenge', { body: { address: s.address } });
      const signature = await s.signMessage(ch.message);
      const provider = s.kind === 'pollar' ? 'pollar' : s.kind === 'test' ? 'cli-test' : 'self-custody';
      await api('/me/wallets/verify', { body: { challengeId: ch.challengeId, signature, provider } });
      setSigner(s);
      persist(getToken(), s.kind);
      await refreshMe();
    },
    [refreshMe],
  );

  const value = useMemo<Session>(
    () => ({
      config,
      configError,
      me,
      signer,
      ready,
      mode: config ? (config.escrow.simulated ? 'DEMO' : 'TESTNET') : null,
      refreshMe,
      loginWithSigner: sessionFromSignature,
      async requestMockOtp(email) {
        const r = await api<{ devCode?: string }>('/auth/otp/request', { body: { email } });
        return r.devCode;
      },
      async loginMockOtp(email, code) {
        const res = await api<{ accessToken: string }>('/auth/session', { body: { provider: 'mock-email-otp', email, code } });
        setToken(res.accessToken);
        persist(res.accessToken, signer?.kind ?? null);
        await refreshMe();
      },
      async startPollarEmail(email) {
        if (!config?.pollar) throw new Error('El acceso con correo no está habilitado.');
        const c = await pollarClient(config.pollar.apiKey, config.pollar.stellarNetwork);
        if (c.getAuthState().step === 'authenticated') return;
        c.login({ provider: 'email', email: email.trim() });
      },
      async confirmPollarCode(code) {
        if (!config?.pollar) throw new Error('El acceso con correo no está habilitado.');
        const c = await pollarClient(config.pollar.apiKey, config.pollar.stellarNetwork);
        if (c.getAuthState().step !== 'authenticated') {
          await new Promise<void>((ok, fail) => {
            const off = c.onAuthStateChange((st) => {
              if (st.step === 'authenticated') {
                off();
                ok();
              } else if (st.step === 'error') {
                off();
                fail(new Error(/code|otp/i.test(st.message) ? 'El código no es correcto o venció.' : st.message));
              }
            });
            c.verifyEmailCode(code.trim());
          });
        }
        await sessionFromSignature(await pollarSigner(c));
      },
      async connectFreighter() {
        const s = await freighterSigner();
        setSigner(s);
        persist(getToken(), 'freighter');
        return s;
      },
      async useTestWallet(secret) {
        const sec = secret?.trim() || Keypair.random().secret();
        Keypair.fromSecret(sec); // valida
        saveTestSecret(sec);
        const s = testSigner(sec);
        setSigner(s);
        persist(getToken(), 'test');
        return s;
      },
      linkWallet,
      /** Testnet: fondea con friendbot y activa la trustline del USDC de Circle (firma local). */
      async prepareTestnetWallet(s) {
        if (config?.escrow.tokenContractId !== CIRCLE_USDC_TESTNET.sac) throw new Error('Esta red no usa el USDC de Circle de testnet.');
        const horizon = new Horizon.Server('https://horizon-testnet.stellar.org');
        let account;
        try {
          account = await horizon.loadAccount(s.address);
        } catch {
          const f = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(s.address)}`);
          if (!f.ok) throw new Error('Friendbot no pudo fondear la cuenta de prueba.');
          account = await horizon.loadAccount(s.address);
        }
        const has = account.balances.some((b) => 'asset_code' in b && b.asset_code === CIRCLE_USDC_TESTNET.code && b.asset_issuer === CIRCLE_USDC_TESTNET.issuer);
        if (has) return 'La wallet ya tiene XLM y USDC activado.';
        const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: config.networkPassphrase })
          .addOperation(Operation.changeTrust({ asset: new Asset(CIRCLE_USDC_TESTNET.code, CIRCLE_USDC_TESTNET.issuer) }))
          .setTimeout(120)
          .build();
        const signed = await s.signXdr(tx.toXDR(), config.networkPassphrase);
        await horizon.submitTransaction(TransactionBuilder.fromXDR(signed, config.networkPassphrase));
        return 'Wallet lista: con XLM de prueba y USDC activado.';
      },
      async logout() {
        if (signer?.kind === 'pollar') await pollarLogout();
        if (signer?.kind === 'test') saveTestSecret(null);
        setToken(null);
        persist(null, null);
        setMe(null);
        setSigner(null);
      },
    }),
    [config, configError, me, signer, ready, refreshMe, sessionFromSignature, linkWallet],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession fuera de SessionProvider');
  return s;
}
