# Montuno — backend y contratos

Este repositorio contiene **solo el backend (API) y los contratos inteligentes** de Montuno. El frontend vivirá en un repositorio aparte.

Backend y contrato inteligente para que importadoras bolivianas que venden por WhatsApp emitan **cotizaciones con enlace de checkout privado**, donde el pago del comprador queda en un **escrow verificable en Stellar (Soroban)**. Dos modalidades:

- **`FULL_ESCROW`:** el 100% queda retenido hasta que el comprador confirma la entrega o un árbitro resuelve.
- **`PARTIAL_ADVANCE`:** la importadora puede cobrar un anticipo fijo, aceptado expresamente por el comprador, **antes de comprar**. El anticipo pagado no es recuperable on-chain.

Solo **Stellar Testnet** con **USDC de Circle de Testnet** (sin valor real). No es un marketplace. No hay frontend.

Estado detallado, evidencia de pruebas y límites: **[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)**.

## Estructura
```text
apps/api/              API NestJS 11 + Prisma 6 (PostgreSQL)
  prisma/              esquema y migraciones
  src/                 módulos de dominio (ver docs/architecture.md)
  test/                escenarios E2E de integración (API + Postgres)
  scripts/e2e-testnet.ts   E2E real contra Testnet a través de la API
contracts/import_escrow/   contrato Rust/Soroban (soroban-sdk 29.0.1) + tests
packages/shared/       enums, máquinas de estado, dinero bigint, hash de términos
scripts/testnet/       deploy.sh y smoke.sh (CLI de Stellar)
docs/                  arquitectura, estados, contrato, firma, Pollar, seguridad, HTTP, despliegues
```

## Requisitos
Node ≥ 22.12 (probado con 26.5) · npm 11 · Rust + target `wasm32v1-none` · `stellar` CLI (probado 28.0.0) · PostgreSQL (Docker Compose o local).

## Arranque local
```bash
npm install                      # npm 11 pide aprobar scripts: ya están permitidos los de Prisma (allowScripts)
docker compose up -d             # Postgres (+ BD montuno_test) y Redis (reservado)
cp .env.example apps/api/.env    # ajusta SESSION_SECRET y MOCK_WEBHOOK_SECRET
npm run db:migrate               # prisma migrate deploy
npm run dev                      # compila shared y levanta la API con watch en :3000
```
- Swagger: http://localhost:3000/docs (JSON en `/docs/openapi.json`) · Salud: `/health`, `/ready`.
- Con `ESCROW_GATEWAY=simulated` (por defecto) todo funciona sin red; las órdenes quedan marcadas `simulated: true`.
- Con `ESCROW_GATEWAY=soroban` se usa el contrato desplegado en Testnet (IDs en `.env.example` y `docs/deployments/testnet.json`).
- Producción: `npm run build && npm start -w apps/api`. La validación de entorno rechaza mocks y Mainnet en `NODE_ENV=production`, de modo que hoy la API **no arranca en producción a propósito**.

## Pruebas
```bash
npm run test:contracts          # cargo test: 35 tests del contrato
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/montuno_test?schema=public \
  npm test                      # shared (6) + API: unitarios y escenarios E2E con Postgres (38)
npm run lint                    # tsc --noEmit
```

## Testnet
```bash
./scripts/testnet/deploy.sh      # identidades ie-*, trustlines USDC de Circle, caja (USDC vía DEX de testnet), escrow
./scripts/testnet/smoke.sh       # FULL, PARTIAL y disputa vía CLI con firmas reales
DATABASE_URL=postgresql://... npm run e2e:testnet   # mismos escenarios por la API, financiando con la rampa caja
```
Los resultados (IDs, hashes y enlaces a stellar.expert) quedan en `docs/deployments/`.

## Flujo de la API (resumen)
1. Login: wallet SEP-53 (con Freighter o con la **wallet embebida de Pollar**, patrón WorkVille: `docs/pollar-integration.md`) u OTP simulado en dev. La UI lee `GET /config`.
2. `POST /me/wallets/challenge|verify` (prueba de posesión).
3. Importadora: `POST /importers` → admin `verify` + `limits` → `POST /importers/me/wallet/verify`.
4. `POST /quotes` → `POST /quotes/:id/publish` (devuelve el token del checkout una sola vez).
5. Comprador: `GET /checkout/:token` → `POST /checkout/:token/accept` (términos + aviso de riesgo).
6. Rampa: `POST /orders/:id/ramp/quote|start` + `simulate-payment` (dev). Con `RAMP_PROVIDER=caja-testnet`, la caja entrega USDC de Circle de Testnet real a la wallet.
7. `POST /orders/:id/escrow/prepare-funding` → la wallet firma → `POST /orders/:id/escrow/submit`.
8. PARTIAL: `POST /orders/:id/advance/prepare` → firma de la importadora → submit.
9. `PATCH /orders/:id/logistics`, evidencias con URLs prefirmadas.
10. `POST /orders/:id/delivery/prepare-confirmation` o `POST /orders/:id/disputes` → árbitro `prepare-resolution`.

Ejemplos completos: [`docs/http/requests.http`](docs/http/requests.http) · Firma en cliente: [`docs/signing-flow.md`](docs/signing-flow.md).

## Nombres heredados
- El crate del contrato se llama `import_escrow`; renombrarlo cambiaría el hash del WASM desplegado.
- Los prefijos de dominio de los hashes (`import-escrow/terms/v1`, `import-escrow/order/v1`, …) son constantes versionadas del protocolo, porque de ellos se derivan `termsHash` y `order_id` on-chain. Solo cambiarán con una nueva versión de esquema.

## Documentación
[Arquitectura](docs/architecture.md) · [Máquinas de estado](docs/state-machines.md) · [Contrato](docs/contract.md) · [Flujo de firma](docs/signing-flow.md) · [Pollar](docs/pollar-integration.md) · [Seguridad y riesgo](docs/security-and-risk.md)
