# Web de Montuno (`apps/web`)

React 19 + Vite 8 + TypeScript, sin librerías de UI: sistema de diseño propio en `src/styles/montuno.css`. Habla con la API real por el mismo origen (en desarrollo, mediante el proxy de Vite hacia `:3000`). No hay datos simulados dentro de la UI: todo lo que se ve viene de la API.

```bash
npm run dev:web     # http://localhost:5173 (puerto fijo: es el origen que se autoriza en Pollar)
npm test -w apps/web
npm run build -w apps/web
```

## Diseño: «una montaña convertida en software»

- **Paleta:** `#0A0A0A` (roca), `#141414` (superficie), `#252525` (estratos y bordes), `#888888` (texto secundario) y `#F3F3F1` (cima y texto).
- **Restricciones:** sin gradientes, sombras, blur ni tarjetas genéricas.
- **Tipografía:** Archivo para los títulos, de peso arquitectónico, e IBM Plex Mono para datos, montos y hashes. Las dos van auto-alojadas con `@fontsource`.
- **Piezas propias:**
  - la marca (un macizo con un corte vertical);
  - *ledger*, filas con divisores en lugar de tarjetas;
  - **estratos**, los pasos del pedido como capas de roca;
  - la **barra del escrow**, con lo liberado en sólido, lo retenido rayado y lo devuelto en contorno;
  - una cordillera en líneas en la portada.
- **Uso:** una acción principal por pantalla y estados de carga, error y vacío en cada vista. Funciona en móvil, con foco visible, `aria-live` en las acciones y `prefers-reduced-motion`.

## Pantallas y endpoints conectados

| Pantalla | Ruta | Endpoints |
|---|---|---|
| Inicio | `/` | `GET /config` |
| Acceso | `/entrar` | `POST /auth/wallet/challenge`, `POST /auth/session` (SEP-53), `POST /auth/otp/request` (DEMO); Pollar en el navegador |
| Catálogo y ficha | `/catalogo`, `/catalogo/:id` | `GET /catalog`, `GET /catalog/categories`, `GET /catalog/:id`, `POST /quote-requests` |
| Proveedores | `/proveedores`, `/proveedores/:id` | `GET /providers`, `GET /providers/:id` |
| Checkout | `/c/:token` | `GET /checkout/:token`, `POST /checkout/:token/accept` |
| Mis pedidos | `/pedidos` | `GET /me/orders`, `GET /me/quote-requests` |
| Pedido | `/pedidos/:id` | `GET /orders/:id`, `GET /orders/:id/escrow`, `POST …/escrow/sync`, `…/ramp/quote`, `…/ramp/start`, `…/ramp/simulate-payment` (DEMO), `/me/kyc/start`, `…/escrow/prepare-funding`, `…/escrow/submit`, `…/advance/prepare`, `PATCH …/logistics`, `…/delivery/prepare-confirmation`, `…/disputes`, `…/disputes/:id/review`, `…/disputes/:id/prepare-resolution`, `…/evidence/*` |
| Importadora | `/importadora`, `/importadora/registro` | `GET/POST /importers…`, `POST /importers/me/wallet/verify`, `GET /importers/me/orders`, `GET/POST/PATCH /importers/me/catalog`, `GET /importers/me/quote-requests` |
| Asistente de cotización | `/importadora/cotizar` | `POST /quotes`, `POST /quotes/:id/publish` |
| Administración | `/admin` | `GET /admin/importers`, `POST …/verify`, `POST …/suspend`, `PATCH …/limits`, `POST /admin/users/:id/roles` |
| Cuenta | `/cuenta` | `GET /me`; Testnet: friendbot y trustline del USDC desde el navegador |

## Firmas

`src/lib/signers.ts` tiene tres firmantes. Ninguno envía claves al servidor:
- **Freighter** (`@stellar/freighter-api` 6).
- **Pollar** (`@pollar/core` 0.12.0): SEP-53 y `signTx`, confirmando solo la transacción que el usuario acaba de pedir.
- **Wallet de prueba:** la clave vive solo en `sessionStorage`.

`src/lib/escrow-runner.ts` ejecuta cada operación así: *prepare → firma en la wallet → submit*. Encadena los pasos que necesita Trustless Work (desplegar y depositar; aprobar y liberar). El modo DEMO usa el formato del ledger simulado; un test verifica que la firma de la web sea idéntica a la que espera el backend (`src/lib/signers.test.ts`).

## DEMO vs Testnet

La etiqueta de la cabecera lo indica siempre:
- **«Demo · simulado»:** `ESCROW_GATEWAY=simulated`; nada se envía a Stellar.
- **«Stellar Testnet»:** contrato real.

El pago en bolivianos de la rampa es siempre simulado (QR ficticio marcado como tal). Con `RAMP_PROVIDER=caja-testnet`, los USDC de Testnet sí llegan de verdad a la wallet.

## Limitaciones actuales

- **Login con Pollar:** no está probado con una cuenta real; requiere que `http://localhost:5173` esté autorizado en el panel de Pollar.
- **Freighter:** la integración sigue la API documentada del paquete 6.0.1, pero no se probó con la extensión instalada.
- **Árbitro:** no hay listado global de disputas, porque el backend no expone ese endpoint. El árbitro entra al pedido por su enlace.
- **Cancelación de mutuo acuerdo:** no está en la web, porque tampoco está en la API.
- **Pruebas:** el recorrido completo en el navegador no está automatizado; los tests de la web cubren la lógica (montos, acción principal, estratos) y la compatibilidad de firmas.
