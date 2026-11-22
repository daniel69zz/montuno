# Pollar: hallazgos verificados y límites

Fuentes leídas el 2026-11-22: `github.com/pollar-xyz/pollar` (README y `packages/core/README.md`, `@pollar/core` **0.12.1**), `github.com/pollar-xyz/pollar-docs` (solo una carpeta `docs` con un README vacío) y `github.com/pollar-xyz/demo-nextjs` (la URL resuelve a un repo `demo` cuyas rutas de servidor son proxies de Neko y Abroad, no de Pollar). **Nada** de lo siguiente se probó con credenciales reales: no se dispuso de ninguna.

| Tema | Documentado | Decisión en este repo |
|---|---|---|
| Paquete de servidor | No. El SDK es de cliente; en Next.js "server-side, the SDK degrades to a no-op". Solo hay API key pública `pk_...`. | No se instaló `@pollar/*` en el backend. |
| Login email OTP | `client.login({provider:'email'})` + `client.verifyEmailCode()`, con tokens DPoP en el **cliente**. | — |
| Verificar sesión en servidor | **No documentado** (sin JWT, JWKS ni endpoint de verificación). | El backend **no acepta** la sesión de Pollar como prueba. El login con Pollar se hace firmando SEP-53 con su wallet embebida (ver abajo). |
| Prueba de wallet | `client.stellar.sep53.signMessage(message)` y `client.stellar.sep10.sign(...)`. | Se implementa la verificación **SEP-53**, compatible por especificación y validada byte a byte contra `stellar message sign`. |
| Firmar Soroban | `client.signTx(xdr)` y `client.signAuthEntry(entryXdr,{validUntilLedger})`, con allowlist de contrato y función en el backend de Pollar para wallets embebidas. Las smart wallets no firman auth entries. | El flujo prepare/submit entrega un XDR estándar. **Gap:** falta verificar con Pollar que `signTx` firme nuestra invocación y registrar el contrato en su allowlist. |
| KYC | `getKycStatus`, `getKycProviders`, `startKyc` y `resolveKyc`, con estados `none/pending/approved/rejected/expired` y requisitos **por corredor**. | El puerto `KycProvider` mapea esos estados. `MockKycProvider` persiste en `KycRecord` con `simulated=true`. |
| Rampas | `getRampRoutes`, `quoteRamp`, `createRampOrder` y `pollRampOrder`. La ruta **BOB documentada va a Solana** (Stereum + CCTP), no a Stellar. El soporte de Testnet no está documentado y el bridging es solo Mainnet. | **No hay ruta BOB → Stellar Testnet.** `MockRampProvider` marca `SIMULATED` y no mueve dinero real. |
| Webhooks | **No documentados.** | `POST /webhooks/pollar` responde 404 a propósito. El patrón seguro (HMAC, timestamp, deduplicación) se prueba con `/webhooks/mock-ramp`, solo fuera de producción. |
| Red | `stellarNetwork: 'mainnet' \| 'testnet'`. | Solo Testnet. |

## Login con Pollar (patrón WorkVille) — soportado por el backend

Mismo diseño que `Cryptoville/apps/web/src/features/auth/pollar.ts`: Pollar es **la wallet con correo** de la persona, no el proveedor de identidad del servidor.

1. La UI pide `GET /api/v1/config`. Si `pollar` no es `null`, carga `@pollar/core` de forma diferida: `new PollarClient({ apiKey, stellarNetwork })` + `await client.ready()`.
2. La persona entra con su correo: `client.login({ provider: 'email', email })` → `client.verifyEmailCode(code)`, hasta que `getAuthState().step === 'authenticated'`. Pollar crea o recupera su wallet embebida (`client.getWallet().address`).
3. `POST /api/v1/auth/wallet/challenge { address }` devuelve un `message` de un solo uso.
4. Firma con Pollar: `const r = await client.stellar.sep53.signMessage(message)` (exigir `r.status === 'signed'`).
5. `POST /api/v1/auth/session { provider: 'stellar-wallet', walletProvider: 'pollar', challengeId, signature: r.signature }`. El backend verifica SEP-53 sin red y emite su propia sesión.
6. Transacciones: los `prepare-*` devuelven XDR estándar y la UI firma con `client.signTx(unsignedXdr)` → `signedXdr`, que luego envía a `/escrow/submit`.
   - Desde la 0.12, Pollar exige confirmar cada firma (`onConfirmationRequest`): confirmar **solo** la tx cuyo `unsignedXdr` coincida, como hace WorkVille.
   - Si la wallet es co-firmada, `status === 'cosign_pending'`.

Qué **no** se hace, a propósito:
- El correo que muestra Pollar (`getUserProfile().mail`) no se guarda como verificado, porque el servidor no puede comprobarlo. La cuenta queda identificada por la wallet.
- `walletProvider: 'pollar'` es solo informativo y no da permisos; cualquier wallet que firme correctamente entra igual.

Configuración: `POLLAR_API_KEY=pk_...` (llave **pública**, del dashboard de Pollar). Sin ella, `/config` no ofrece `pollar-email`. Está probado en `test/scenarios.e2e-spec.ts` con una keypair en el papel de la wallet embebida; **falta una prueba con una cuenta real de Pollar** (WorkVille la tiene marcada igual: "real, sin probar con cuentas reales").

## Rampa BOB → USDC
- Lo que en WorkVille funciona en Testnet es la rampa **simulada**: un QR falso y USDC de Circle real de Testnet enviado desde una wallet "caja" del servidor.
- La rampa con Pollar está programada allí, pero se probó solo con un cliente falso.
- Según su doc, la ruta boliviana de Pollar va por Stereum: BOB → USDT en Polygon → USDC → CCTP → Stellar. No está confirmado que exista en la app de Testnet; el sandbox de Pollar trae ARS, PEN y COP.

Aquí se replicó ese comportamiento con `RAMP_PROVIDER=caja-testnet` (`CajaTestnetRampProvider` + `SorobanCajaSender`):
- El pago en BOB es simulado: QR ficticio, confirmado con `POST /orders/:id/ramp/simulate-payment` (dev) o con el webhook firmado.
- La caja (`ie-caja`) entrega **USDC de Circle de Testnet real** a la wallet del comprador. La caja consigue ese USDC en el DEX de Testnet con XLM de friendbot (`deploy.sh`), sin pasar por el faucet web de Circle.
- La orden queda `WALLET_FUNDED` y el comprador luego firma `create_and_fund`.

Probado contra Testnet en `npm run e2e:testnet`. Cuando Pollar confirme un corredor BOB → Stellar, se reemplaza por un `PollarRampProvider` con el mismo puerto.

## Para activar Pollar real (pendiente externo)
1. Obtener credenciales y confirmar con Pollar si existe una API de servidor para verificar sesiones. Si existe, implementar `PollarIdentityProvider` (puerto `IdentityProvider`).
2. Confirmar un corredor BOB → **Stellar** (o aceptar BOB → Solana + puente, lo que exige rediseño) e implementar `PollarRampProvider` (puerto `RampProvider`).
3. Registrar el contrato y las funciones (`create_and_fund`, `confirm_delivery_and_release`, `open_dispute`, `claim_advance`) en la allowlist de Pollar y probar `signTx` con una wallet embebida en Testnet.
4. Si Pollar documenta webhooks firmados, implementarlos reutilizando `WebhookReceipt` y el patrón de `webhooks.controller.ts`.

KYC de persona física ≠ KYB de la importadora: la verificación de empresas sigue siendo revisión manual del admin. Pollar no resuelve la regulación local; se necesita revisión legal antes de Mainnet.
