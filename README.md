# Montuno

> ⚠️ **MVP en Stellar Testnet.** El contrato no está auditado. No lo uses con dinero real ni en Mainnet.

Montuno permite que las importadoras pequeñas de Bolivia, que venden por WhatsApp y bajo pedido, cobren por adelantado **sin que el comprador tenga que confiar a ciegas**. La importadora manda un **enlace de checkout privado** y el pago queda en un **contrato inteligente (escrow) en Stellar** hasta que el pedido llega. No es un marketplace: la conversación y la venta siguen en WhatsApp.

¿Qué problema resuelve, quién participa y por qué usa blockchain? Explicado sin tecnicismos en **[PROYECTO.md](PROYECTO.md)**.

Este es el monorepo del proyecto. Hoy contiene la **API** y los **contratos inteligentes**; el frontend se agregará aquí mismo (en `apps/web`).

## Cómo funciona

El comprador siempre deposita el **100%** del pedido en el contrato. Lo que cambia es **cuándo** cobra la importadora:

| Modalidad | Para quién | Qué recibe la importadora antes de la entrega | Si la importadora incumple, el comprador recupera |
|---|---|---|---|
| **Escrow completo** (`FULL_ESCROW`) | Importadoras con capital propio | Nada | Todo lo retenido, según decida el árbitro |
| **Anticipo parcial** (`PARTIAL_ADVANCE`) | Importadoras que necesitan liquidez para comprar | Un anticipo fijo, aceptado expresamente por el comprador antes de pagar | **Solo el saldo que sigue retenido**; el anticipo pagado no se recupera desde el contrato |

Ejemplo: en un pedido de 1.200 USDC con 900 de anticipo, quedan 300 retenidos. Ese es el máximo que el comprador puede recuperar si la importadora no cumple, y se le muestra antes de pagar. El anticipo está deshabilitado hasta que el administrador lo autoriza para cada importadora, siempre con un tope.

Cuando el comprador confirma la entrega, el contrato libera el saldo a la importadora. Si algo sale mal, el comprador o la importadora abren una disputa y el árbitro reparte **solo lo que sigue retenido**.

Límites honestos:
- El contrato no puede saber si un paquete llegó. La entrega la confirma el comprador y, si hay desacuerdo, decide el árbitro; el tracking ayuda, pero no es prueba.
- Los datos personales nunca van a la blockchain: allí solo quedan montos, wallets y hashes de las condiciones.

## Contrato desplegado (Testnet)

| | |
|---|---|
| Escrow | [`CA3CWIHORCCANE73NITO5T2I652SGR4SOUZDMHXVQUH5T4DGX7YJQCTR`](https://stellar.expert/explorer/testnet/contract/CA3CWIHORCCANE73NITO5T2I652SGR4SOUZDMHXVQUH5T4DGX7YJQCTR) |
| Token | USDC de Circle de Testnet, SAC [`CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`](https://stellar.expert/explorer/testnet/contract/CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA) |
| Registro completo | [`docs/deployments/`](docs/deployments/): transacciones de despliegue, smoke test y E2E |

## Estado: qué es real y qué está simulado

Es un **MVP funcional en Stellar Testnet**, la red de pruebas, donde el dinero no tiene valor real. Los dos flujos y el caso de incumplimiento tras un anticipo se ejecutaron de punta a punta en la red, con firmas reales.

| Componente | Estado |
|---|---|
| Contrato escrow, firmas de usuarios y USDC de Testnet | ✅ Real (Testnet) |
| API (cotizaciones, checkout, pedidos, disputas, evidencias) | ✅ Implementada y probada |
| Login con firma de wallet (SEP-53) | ✅ Real |
| Login con correo vía Pollar (Pollar crea una wallet embebida que firma el desafío) | 🟠 Soportado por la API, sin probar con una cuenta real de Pollar |
| Rampa BOB → USDC | 🟡 El pago en bolivianos es **simulado**; con `RAMP_PROVIDER=caja-testnet`, la entrega de USDC de Testnet es real |
| KYC y OTP por correo | 🟡 Simulados (marcados `simulated: true`) |
| Frontend (`apps/web`) | ⏳ Pendiente |

**Antes de usarlo con dinero real hace falta:**
- una auditoría externa del contrato;
- revisión legal y regulatoria en Bolivia;
- un árbitro multisig en lugar de uno solo;
- una rampa real BOB → USDC hacia Stellar;
- la interfaz de usuario.

Próximos pasos y detalle en [PROYECTO.md](PROYECTO.md#próximos-pasos). Evidencia de pruebas y pendientes técnicos en **[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)**.

## Requisitos

- Node ≥ 22.12 (probado con 26.5) y npm 11
- Docker, para Postgres; o un PostgreSQL propio
- Solo para trabajar con los contratos o con Testnet: Rust con el target `wasm32v1-none` y la CLI `stellar` (probada con la 28.0.0)

## Arranque local

La API funciona sin red con un ledger simulado (`ESCROW_GATEWAY=simulated`, el valor por defecto).

```bash
npm install
docker compose up -d               # Postgres con las BD montuno y montuno_test (Redis queda reservado)
cp .env.example apps/api/.env
```

En `apps/api/.env`, reemplaza `SESSION_SECRET` y `MOCK_WEBHOOK_SECRET` por valores generados con `openssl rand -hex 32`. La API no arranca con los valores de ejemplo. Luego:

```bash
npm run db:migrate                 # prisma migrate deploy
npm run dev                        # API en http://localhost:3000 con recarga automática
```

- Swagger en http://localhost:3000/docs (el JSON está en `/docs/openapi.json`).
- Salud en `/health` y `/ready`.

### Variables que cambian el comportamiento

| Variable | Valores | Efecto |
|---|---|---|
| `ESCROW_GATEWAY` | `simulated` (defecto) · `soroban` | Ledger en memoria, o el contrato real en Testnet. Con `soroban` hacen falta `STELLAR_ESCROW_CONTRACT_ID`, `STELLAR_ESCROW_TOKEN_CONTRACT_ID` y `STELLAR_ARBITER_ADDRESS` |
| `RAMP_PROVIDER` | `mock` (defecto) · `caja-testnet` | Rampa que no mueve tokens, o una caja del servidor que entrega USDC de Testnet real. `caja-testnet` exige `ESCROW_GATEWAY=soroban` y `RAMP_CAJA_SECRET` |
| `RAMP_CAJA_SECRET` | clave `S…` | Única clave del servidor. Solo firma transferencias desde la caja; queda prohibida en producción |
| `POLLAR_API_KEY` | `pk_…` | Llave **pública** de Pollar. Si está, `GET /api/v1/config` ofrece el login con correo |

La lista completa está comentada en [`.env.example`](.env.example).

> La validación del entorno rechaza los mocks, el ledger simulado y la caja cuando `NODE_ENV=production`. Por eso hoy la API **no puede arrancar en producción**, a propósito: primero faltan integraciones reales.

## Pruebas

```bash
npm test                 # shared + API: unitarios y escenarios E2E contra Postgres (BD montuno_test)
npm run test:contracts   # cargo test del contrato
npm run lint             # chequeo de tipos
```

Si tu BD de pruebas no es la de Docker Compose, define `TEST_DATABASE_URL`.

## Testnet

Los scripts usan identidades de la CLI de Stellar con prefijo `ie-` (`ie-admin`, `ie-arbiter`, `ie-buyer`, `ie-importer`, `ie-caja`). Las claves viven solo en tu keystore local (`~/.config/stellar`), nunca en el repo.

```bash
./scripts/testnet/deploy.sh   # crea y fondea las identidades, compra USDC de Testnet para la caja y despliega un escrow
./scripts/testnet/smoke.sh    # FULL, PARTIAL y disputa tras anticipo, por CLI y con firmas reales
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/montuno?schema=public \
  npm run e2e:testnet         # los mismos escenarios a través de la API, financiando con la rampa caja
```

- **Si clonaste el repo,** las identidades `ie-*` no existen en tu máquina. Corre primero `deploy.sh`: crea las tuyas y **tu propio** escrow.
- **Cada `deploy.sh` despliega un escrow nuevo** y sobrescribe `docs/deployments/testnet.json`. Después, copia los IDs nuevos a tu `apps/api/.env`; los de `.env.example` corresponden al despliegue publicado arriba.
- **La caja consigue su USDC en el DEX de Testnet** pagando con XLM de friendbot, sin usar el faucet web de Circle.

## Uso de la API

El flujo completo, paso a paso:

1. **Sesión.** Firma SEP-53 de un desafío con la wallet (Freighter, la CLI o la wallet embebida de Pollar), o un OTP simulado en desarrollo. `GET /config` le dice a la UI qué métodos hay.
2. **Wallet del usuario.** `POST /me/wallets/challenge` + `POST /me/wallets/verify` (prueba de posesión).
3. **Alta de la importadora.** `POST /importers`. El admin la aprueba (`verify`) y le fija límites (`limits`); el anticipo está deshabilitado por defecto. La importadora vincula su wallet de cobro.
4. **Cotización.** `POST /quotes` y luego `POST /quotes/:id/publish`, que congela los términos y devuelve el token del checkout **una sola vez**.
5. **Checkout del comprador.** `GET /checkout/:token` (vista pública sanitizada) y `POST /checkout/:token/accept` (términos más aviso de riesgo versionado).
6. **Rampa, opcional.** `POST /orders/:id/ramp/quote` y `…/start`; en desarrollo, `…/simulate-payment`. Deja los fondos en la **wallet** del comprador, nunca en el contrato.
7. **Depósito en el contrato.** `POST /orders/:id/escrow/prepare-funding` devuelve un XDR sin firmar. La wallet lo firma en el cliente y se envía con `POST /orders/:id/escrow/submit`.
8. **Anticipo, solo en modo parcial.** `POST /orders/:id/advance/prepare`, firmado por la importadora.
9. **Logística y evidencias.** `PATCH /orders/:id/logistics`; las evidencias se suben con URLs prefirmadas.
10. **Cierre.** `POST /orders/:id/delivery/prepare-confirmation` libera el saldo. Si hay problemas, `POST /orders/:id/disputes` y luego el árbitro usa `…/prepare-resolution`.

**El servidor nunca recibe claves de usuarios:** solo transacciones firmadas cuyo hash coincide con la preparada.

Ejemplos de cada paso en [`docs/http/requests.http`](docs/http/requests.http). Firma en el cliente en [`docs/signing-flow.md`](docs/signing-flow.md).

## Estructura

```text
apps/api/                  API NestJS 11 + Prisma 6 (PostgreSQL)
  prisma/                  esquema y migraciones
  src/                     módulos de dominio (ver docs/architecture.md)
  test/                    escenarios E2E de integración (API + Postgres)
  scripts/e2e-testnet.ts   E2E contra Testnet a través de la API
contracts/import_escrow/   contrato Rust/Soroban (soroban-sdk 29.0.1) y sus tests
packages/shared/           enums, máquinas de estado, dinero en bigint, hash de términos
scripts/testnet/           deploy.sh y smoke.sh (CLI de Stellar)
docs/                      arquitectura, estados, contrato, firma, Pollar, seguridad, ejemplos HTTP, despliegues
guia.md                    especificación original del MVP
(apps/web/)                frontend: pendiente
```

## Documentación

[De qué trata el proyecto](PROYECTO.md) · [Arquitectura](docs/architecture.md) · [Máquinas de estado](docs/state-machines.md) · [Contrato](docs/contract.md) · [Flujo de firma](docs/signing-flow.md) · [Pollar](docs/pollar-integration.md) · [Seguridad y riesgo](docs/security-and-risk.md)

## Nombres heredados

Montuno empezó con el nombre técnico `import-escrow`, y dos nombres se conservan a propósito:

- **El crate del contrato, `import_escrow`:** renombrarlo cambiaría el hash del WASM desplegado.
- **Los prefijos de los hashes de dominio** (`import-escrow/terms/v1`, `import-escrow/order/v1`, …): son constantes versionadas del protocolo y de ellos se derivan el `termsHash` y el `order_id` on-chain. Cambiarán solo con una nueva versión de esquema.

## Licencia

Todavía no tiene licencia. Hasta que la tenga, no se concede permiso para reutilizar el código.
