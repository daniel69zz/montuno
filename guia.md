# Import Escrow MVP — Backend + Stellar Smart Contracts

> **Nombre del producto:** pendiente. `import-escrow-mvp` es únicamente un identificador técnico provisional para el repositorio; **no es una marca ni un nombre definitivo**.
>
> **Estado:** especificación de implementación para Claude Code. Alcance inicial: **backend + contratos inteligentes + pruebas + scripts de despliegue en Stellar Testnet**. No construir frontend de momento.

## 0. Instrucciones para Claude Code

Actúa como arquitecto y desarrollador backend/Web3 senior. **Implementa el proyecto**, no solo propongas una arquitectura. Trabaja por fases y deja cada una ejecutable y probada. Antes de escribir una integración con Pollar o Stellar, consulta la documentación oficial actual y verifica firmas de métodos, versiones, soporte de Testnet y limitaciones. **No inventes endpoints, SDK methods, direcciones de contratos, proveedores, rutas de rampa ni mecanismos de firma.**

Entregables obligatorios:

1. Monorepositorio funcional con API NestJS, contratos Rust/Soroban, migraciones, pruebas y configuración Docker local.
2. Contrato escrow implementado y cubierto por pruebas; scripts reproducibles de despliegue/invocación en Stellar **Testnet** y registro de direcciones/tx de despliegue cuando haya credenciales disponibles.
3. Integraciones por adaptadores: Pollar real **solo donde la documentación y credenciales lo permitan**; mocks de autenticación/rampas en desarrollo y tests.
4. Swagger/OpenAPI, colección de ejemplos HTTP, `.env.example`, comandos de ejecución, guía de transiciones y README actualizado con lo que realmente quedó implementado.
5. Reporte `IMPLEMENTATION_STATUS.md` con funcionalidad completada, tests ejecutados, limitaciones, pendientes externos y decisiones de seguridad.

**No** desarrollar UI, marketplace, buscador de productos, sistema de tarjetas, préstamo, custodia de claves privadas, producción/Mainnet, o procesamiento real de bolivianos. Si algún requisito depende de acceso externo, implementar interfaz/adapter + mock reproducible y señalarlo claramente; **nunca simular éxito real** en endpoints de producción.

---

## 1. Contexto y problema

En Bolivia, muchas importadoras pequeñas venden **por WhatsApp y bajo pedido**:

1. El comprador envía por privado un enlace de Amazon, eBay, Apple u otra tienda.
2. La importadora calcula y comunica un precio **total final**, plazo estimado y condiciones.
3. El comprador acepta y **paga el 100% por adelantado**.
4. La importadora compra con su propia tarjeta o medios de pago, aprovechando descuentos, promociones o puntos, y gestiona la importación.
5. Finalmente entrega el producto en Bolivia.

Problema: hoy el comprador debe confiar en que la importadora utilizará el dinero y entregará lo acordado. Esta plataforma permite **generar cotizaciones y enlaces de checkout con un escrow verificable en Stellar**, sin modificar el canal comercial existente (WhatsApp).

**No somos un marketplace.** No agregaremos catálogo, descubrimiento de importadoras, búsqueda en Amazon ni tarjetas virtuales para pagar compras. El método de compra internacional es responsabilidad de cada importadora.

## 2. Propuesta de valor y actores

- **Comprador:** recibe un enlace privado de cotización, verifica condiciones, se identifica, acepta riesgos y paga el 100%; luego sigue estados del pedido, confirma entrega o disputa.
- **Importadora:** registra su negocio, configura wallet de cobro, genera cotización, envía enlace por WhatsApp, administra pedidos, aporta evidencias y cobra según modalidad.
- **Administrador/árbitro:** valida empresas (en el MVP: revisión manual), atiende controversias y emite resoluciones limitadas a los fondos que **aún están en el contrato**.
- **Pollar/proveedor de rampa:** potencial autenticación con correo, wallets embebidas, KYC según ruta, ingreso BOB → USDC cuando haya corredor habilitado; no reemplaza el contrato ni es garantía automática de cumplimiento regulatorio.

**Principio de UX para futura UI:** mostrar cotización, precio, porcentaje protegido y seguimiento; no obligar al cliente a comprender Stellar, XLM o Soroban. Este repositorio solo expone API para una UI futura.

## 3. Modelos de escrow (ambos son obligatorios)

El cliente paga el **100%** de la cotización en **ambos** modelos. Lo que cambia es el momento en que los fondos son liberados a la importadora.

### A. `FULL_ESCROW` — importadora con capital propio

- El cliente acepta una cotización y deposita el monto total convertido a USDC en el contrato.
- La importadora compra usando **su capital y sus propias tarjetas/promociones**.
- Los fondos permanecen retenidos hasta confirmación de entrega por comprador o una resolución autorizada de disputa.
- No se permite liberación anticipada de capital.
- El contrato debe permitir reembolso bajo las reglas documentadas de cancelación/disputa.

### B. `PARTIAL_ADVANCE` — importadora necesita liquidez

- El comprador acepta expresamente un anticipo fijo **antes de pagar** (monto y porcentaje mostrados con claridad).
- El cliente igualmente deposita el 100% en el contrato.
- Una vez financiada la orden y cumplidas las condiciones previstas, la importadora puede recibir el **anticipo autorizado ANTES de realizar la compra**. Esto es esencial: la finalidad del anticipo es aportar liquidez para comprar; **no exigir comprobante de compra como condición previa del anticipo**.
- Después de comprar, la importadora registra comprobante; más adelante, tracking y entrega.
- El saldo permanece bloqueado hasta aceptación del comprador o resolución de disputa.
- **Riesgo no negociable:** el anticipo ya pagado no puede ser recuperado automáticamente por el smart contract. En caso de incumplimiento, la cobertura on-chain se limita al saldo no liberado, salvo garantías externas separadas.
- En el MVP configurar un límite de anticipo por empresa (`maxAdvanceBps`) y un límite máximo de orden; **por defecto anticipo deshabilitado hasta aprobación manual de la importadora**. El porcentaje autorizado es inmutable después de que el comprador acepta y financia la orden.

**Ejemplo exclusivamente ilustrativo:** precio final USD 1.200, coste del importador USD 1.000, anticipo USD 900 (75%), saldo retenido USD 300. El cliente deposita 1.200; puede recuperar como máximo el saldo aún bajo custodia si la importadora incumple, no los 900 ya liberados. Comisiones, FX y cantidades reales deben declararse y calcularse antes de la aceptación.

### Reglas económicas

- Cotización puede expresarse visualmente en BOB, pero **fijar explícitamente la cantidad exacta de unidades atómicas de USDC** que debe entrar al contrato para marcarla financiada; además conservar monto/cotización de la rampa, tipo de cambio, spread, cargos y vencimiento.
- **No asumir 1 BOB = 1 USD ni tasa fija USDC ↔ BOB.** Tampoco asumir que una rampa garantiza cantidad exacta en tiempo ilimitado. Si vence la cotización de conversión, el pedido vuelve a estado de recalcular precio **antes del depósito**.
- Usar `bigint`/`Decimal` o representación de enteros para dinero; **nunca `float` JS** para cálculos monetarios.
- Parametrizar la escala del token; para USDC Stellar usualmente 7 decimales, verificar activo/token de Testnet y no codificar direcciones sin confirmar.
- Las comisiones del servicio y de la rampa deben identificarse por separado y estar incluidas o explicitadas **antes de pagar**. Nunca cobrar comisiones on-chain no aceptadas.
- Fondos liberados a wallet de la importadora; **la importadora elige libremente cómo usarlos o convertirlos**. No es obligatorio integrar una tarjeta ni un off-ramp para completar el MVP.

---

## 4. Stack y arquitectura técnica

### Stack elegido

- **API:** Node.js LTS + TypeScript + NestJS.
- **BD:** PostgreSQL + Prisma ORM con migraciones.
- **Jobs:** Redis + BullMQ para reconciliación, reintentos, expiraciones y observación on-chain. Si agregan complejidad excesiva al primer commit, empezar con servicio modular y worker sencillo, pero dejar preparado el patrón.
- **Contratos:** Rust + `soroban-sdk`, compilación a WASM y ejecución en **Stellar Testnet**.
- **Cliente blockchain backend:** `@stellar/stellar-sdk` compatible con la red instalada; `stellar` CLI para despliegue.
- **Integración Pollar:** adaptador con versión del SDK **fijada tras verificar su documentación**; secretos solo en servidor. No asumir que `@pollar/react` pertenece al backend.
- **Pruebas:** Jest/Supertest para backend, pruebas unitarias del SDK Soroban en Rust, pruebas de integración API+Postgres, pruebas E2E Testnet opcionales.
- **Infra local:** Docker Compose (Postgres, Redis), validación de variables, Swagger, logs estructurados y healthchecks.

### Estructura sugerida

```text
import-escrow-mvp/
├── apps/
│   └── api/
│       ├── src/
│       │   ├── auth/
│       │   ├── users/
│       │   ├── importers/
│       │   ├── quotes/
│       │   ├── checkouts/
│       │   ├── orders/
│       │   ├── payments/
│       │   ├── ramps/
│       │   ├── kyc/
│       │   ├── escrow/
│       │   ├── evidence/
│       │   ├── disputes/
│       │   ├── stellar/
│       │   ├── notifications/
│       │   ├── jobs/
│       │   └── common/
│       ├── prisma/
│       └── test/
├── contracts/
│   └── import_escrow/
│       ├── src/
│       └── tests/
├── packages/
│   └── shared/             # esquemas, enums y DTOs compartibles
├── scripts/                # bootstrap, tests, deploy Testnet, smoke tests
├── docs/                   # API, arquitectura, modelos de riesgo, flujo de estados
├── docker-compose.yml
├── .env.example
├── IMPLEMENTATION_STATUS.md
└── README.md
```

Se permite ajustar la estructura si se explica la razón. Priorizar **modularidad, mínima complejidad y pruebas reproducibles**.

### Separación de responsabilidades

**Off-chain (API/BD):** cuentas, perfiles, KYC status cacheado, verificación de importadoras, URLs de cotizaciones, términos, tarifas, estados logísticos, evidencias, notificaciones, auditoría, integraciones fiat, indexación.

**On-chain (escrow):** términos monetarios críticos e inmutables, participantes y árbitro autorizados, fondos depositados, anticipo permitido, saldo retenido, liberaciones, reembolsos, disputa y eventos verificables.

Los datos privados (nombre, dirección, documentos, teléfono, comprobantes) **no van a blockchain**; solo identificadores técnicos y hashes de términos/evidencias si se necesita trazabilidad.

---

## 5. Flujo end-to-end del MVP

```text
WhatsApp (externo)
  ↓
Importadora crea cotización privada en nuestra API
  ↓
API genera URL opaca e impredecible /checkout/{token}
  ↓
Comprador ve términos → inicia sesión por correo → aceptación explícita
  ↓
Si la ruta lo exige: KYC con Pollar/proveedor externo
  ↓
On-ramp BOB → USDC (si disponible) o mock de Testnet
  ↓
Wallet del comprador recibe USDC Testnet
  ↓
Comprador firma funding del contrato (importe y condiciones exactas)
  ↓
API verifica la confirmación y fondos en Soroban
  ↓
FULL_ESCROW: importadora compra con capital propio
PARTIAL_ADVANCE: se libera anticipo previamente consentido; luego compra
  ↓
Importadora registra compra → tracking → entrega
  ↓
Comprador confirma entrega → saldo se libera
                 O abre disputa → árbitro decide saldo pendiente
```

**No es válido** marcar pedido `FUNDED` solo por confirmación del banco, captura de pantalla, webhook de rampa, hash declarado por cliente o saldo observado en wallet. Se necesita **confirmación válida en el contrato correcto, red correcta, token correcto, pedido correcto y monto requerido**. El paso rampa → wallet → contrato puede exigir dos transacciones distintas: documentarlo y no ocultarlo como si el dinero llegara necesariamente al contrato de forma directa.

### Historial y estados independientes

No utilizar un único `order.status` para todo. Modelar:

- **Cotización:** `DRAFT`, `SENT`, `ACCEPTED`, `EXPIRED`, `CANCELLED`.
- **Pago/funding:** `NOT_STARTED`, `RAMP_PENDING`, `WALLET_FUNDED`, `ESCROW_PENDING`, `ESCROW_FUNDED`, `FAILED`, `REFUNDED`, `PARTIALLY_REFUNDED`.
- **Logística:** `NOT_PURCHASED`, `PURCHASED`, `IN_TRANSIT`, `ARRIVED_BOLIVIA`, `READY_FOR_DELIVERY`, `DELIVERED`, `ACCEPTED`.
- **Disputa:** `NONE`, `OPEN`, `UNDER_REVIEW`, `RESOLVED`.
- **Contrato:** utilizar sus propios estados verificables (`CREATED/FUNDED`, `ADVANCE_PAID`, `DISPUTED`, `SETTLED`, `CANCELLED`) o una composición equivalente sin estados imposibles.

La API publica un estado resumido para la futura UI sin confundir envío con movimientos monetarios.

---

## 6. Especificación del smart contract (prioridad alta)

Crear **un contrato escrow Soroban** con un registro individual por `order_id` (bytes32/hash/identificador determinista) o instancias por orden si hay ventaja clara. El contrato acepta un token permitido (dirección de contrato token/SAC configurable de Testnet) y almacena valores monetarios en enteros atómicos `i128` positivos.

### Datos mínimos on-chain por orden

```text
order_id              identificador único
buyer                 Address del comprador
importer              Address de la importadora
arbiter               Address del árbitro designado
asset                 Address del token permitido
amount_total          monto que debe quedar financiado
advance_amount        0 en FULL_ESCROW; >0 en PARTIAL_ADVANCE
advance_released      cantidad efectivamente pagada por adelantado
seller_released       total histórico pagado a la importadora
buyer_refunded        total histórico devuelto al comprador
remaining_escrow      saldo exacto todavía retenido
terms_hash            hash canónico de cotización/condiciones
mode                  FULL_ESCROW | PARTIAL_ADVANCE
funding_deadline      fecha límite para financiar
fulfillment_deadline  fecha de cumplimiento pactada
status                estado del contrato
```

La fecha de cumplimiento no debe activar **liberaciones irreversibles automáticas** por sí sola. Un retraso puede habilitar disputa, pero no debe regalar fondos a una parte sin el procedimiento pactado.

### API de contrato propuesta (ajustar nombres a convenciones Rust)

- `initialize(admin, allowed_token, ...)`: configuración única, no reconfigurable sin controles y eventos.
- `create_and_fund(order_id, buyer, importer, arbiter, token, total, advance, terms_hash, deadlines, ...)`: el comprador **autoriza criptográficamente** términos y transferencia de los tokens en una operación atómica; impedir IDs duplicados, terceros no autorizados, tokens no permitidos, importes inválidos y plazos vencidos. **Revisar el modelo real de `require_auth()`** para cuentas Stellar y wallets de Pollar.
- `claim_advance(order_id)`: solo importadora; permitido únicamente si `PARTIAL_ADVANCE`, fondos confirmados, sin disputa y `advance_amount` fijado/autorizado en el checkout. El anticipo está disponible **antes de comprar el producto** y solo puede reclamarse una vez. Puede existir un control adicional off-chain de negocio/KYB **previo al funding**, pero no debe poder bloquear arbitrariamente un fondo ya financiado ni falsear protección contractual.
- `confirm_delivery_and_release(order_id)`: requiere autorización del comprador, entrega validada fuera de cadena y ninguna disputa activa; transfiere **únicamente el saldo retenido** a la importadora.
- `open_dispute(order_id, reason_hash)`: comprador o importadora; congela nuevas liberaciones mientras se resuelve. Guardar evidencia privada off-chain.
- `resolve_dispute(order_id, refund_to_buyer, release_to_importer, resolution_hash)`: solo árbitro autorizado, revisa que los importes sean no negativos y sumen **exactamente el saldo retenido** (o documentar un mecanismo seguro de distribuciones sucesivas). Emitir evento y cerrar. **Nunca permitir que arbitraje devuelva on-chain un anticipo ya transferido**.
- `cancel_by_agreement(order_id)`: cancelación con autorización **de ambas partes** si no hay disputa, respetando saldos y anticipos. Si se necesita cancelación unilateral antes de funding, definirla separadamente y sin acceso a fondos ajenos.
- `get_order(order_id)`: estado y datos críticos.

**No crear** función administrativa genérica para retirar saldo ajeno, cambiar arbitrariamente importadora/comprador, redefinir `advance_amount` después de la aceptación, o cambiar token/red mediante el backend. Los derechos del árbitro deben ser explícitos, limitados a cada pedido y auditables. En Testnet se admite un árbitro controlado para MVP, pero **documentar centralización** y futuro multisig/2-de-3 para producción.

### Invariantes de seguridad

1. `amount_total = seller_released + buyer_refunded + remaining_escrow` después de financiar, sin contar comisiones explícitas si existieran en un ledger separado; no doble contabilidad.
2. Nunca saldo negativo, overflow, liberación doble, anticipo mayor al total, múltiples depósitos accidentales o reclamación de orden inexistente.
3. Toda acción sensible tiene autorización por `Address.require_auth()` correcta: comprador para fund/aceptar entrega, importadora para reclamar anticipo, ambos para cancelación consensuada, árbitro para resolver disputa.
4. No liberar saldo si existe disputa activa; no refund y release simultáneos por carrera.
5. Transferencias con la API oficial de tokens compatibles con Soroban, sin custodiar secret keys en API.
6. Autorizaciones se aplican a los **argumentos económicos exactos**; no confiar en parámetros enviados por backend como autorización de cliente.
7. Usar eventos `escrow_created`, `funded`, `advance_released`, `delivery_confirmed`, `dispute_opened`, `dispute_resolved`, `refunded` con `order_id`, importes y tx hash cuando corresponda (el hash de transacción se conoce al indexar).
8. Considerar expiración/renovación del **TTL** de almacenamiento de Soroban y código WASM; no perder acceso a órdenes activas. Implementar renovación y procedimientos de restauración si aplica.
9. Contrato sin upgrades inseguros en el MVP; si es upgradeable, controles de aprobación y documentación explícita.
10. Cualquier cálculo de comisión es determinista, documentado, con redondeos y montos máximos comprobados por pruebas.

**Limitación fundamental del escrow:** el contrato no puede verificar por sí mismo que un paquete haya llegado o que una foto sea auténtica. El backend recopila evidencias, el comprador confirma o el árbitro resuelve. No presentar tracking/API de courier como oráculo infalible.

### Batería mínima de tests Rust

- FULL: fund → confirmación comprador → liberación 100%.
- PARTIAL: fund → anticipo una sola vez → confirmación → saldo restante.
- Orden sin funding; expiración de la cotización; IDs repetidos; fund con token incorrecto o monto cero.
- Anticipo mayor al total; intento de cambiar condiciones; anticipo repetido; intento de anticipo en FULL.
- Confirmación por tercero, vendedor o administrador no autorizado.
- Disputa antes/después de anticipo; disputa bloquea pago final.
- Árbitro reparte únicamente lo retenido; resolución por cuenta no autorizada falla.
- Reembolso total antes de anticipos; reembolso parcial después de anticipo; sumas exactas.
- Doble ejecución/replay; invariantes bajo secuencias aleatorias de operaciones.
- Tests de TTL/persistencia/recuperación cuando el SDK lo permita.

---

## 7. Backend: recursos y esquema de datos

### Modelos Prisma sugeridos

- `User`: id, email normalizado/verificado, phone, displayName, identityProvider, externalSubject, timestamps.
- `UserWallet`: id, userId, address, network, provider, verifiedAt; una wallet verificada no puede vincularse sin prueba de posesión/autenticación.
- `Importer`: id, ownerUserId, publicName, nit opcional, status (`PENDING/VERIFIED/SUSPENDED`), walletId, maxOrderAmountAtomic, maxAdvanceBps, allowedModes; revisión manual en MVP.
- `ImporterMember`: usuario, importadora, role (`OWNER/OPERATOR`), permisos y auditoría.
- `Quote`: id, importerId, productUrl, productName, productVariant, quantity, destinationCity, deliveryEstimate, purchaseTerms, fiatPrice, fiatCurrency, USDC amountAtomic, fees, fxQuoteExpiresAt, escrowMode, advanceAmountAtomic, termsHash, status, expiresAt, version.
- `CheckoutLink`: id, quoteId, opaqueTokenHash, expiresAt, redeemedAt/revokedAt; no IDs consecutivos como secretos.
- `Order`: id, quoteId, buyerId, importerId, buyerWallet, importerWallet, escrowId, onchainOrderId, termsHash, paidAt, paymentState, logisticState, disputeState.
- `RampTransaction`: id, orderId, provider, corridor, providerReference, amountFiat, asset, destinationWallet, status, webhookReference, rawSafeMetadata, timestamps.
- `EscrowTransaction`: id, orderId, txHash, ledger, eventType, amountAtomic, network, status, confirmationAt, uniqueEventKey.
- `PurchaseEvidence`: id, orderId, type (`RECEIPT/TRACKING/DELIVERY_PROOF/OTHER`), objectKey, sha256, mimeType, uploadedBy, createdAt; **almacenamiento privado**, URL firmada temporal.
- `Dispute`: id, orderId, openedBy, reason, status, resolution, resolutionHash, resolvedBy, timestamps.
- `AuditLog`: actor, acción, recurso, before/after sanitizado, correlationId, timestamp.
- `IdempotencyKey` / `WebhookReceipt`: deduplicación verificable de llamadas y callbacks.

Utilizar restricciones únicas, foreign keys, índices por orderId/importerId/userId, auditoría y políticas de eliminación/retención de datos. `termsHash` debe calcularse mediante una representación canónica y versionada de la cotización. No incluir PII en el hash público si hay riesgo de correlación.

### Endpoints REST mínimos (prefijo `/api/v1`)

**Autenticación y usuarios**

```http
POST   /auth/session             # intercambio de prueba verificada del proveedor; emite sesión propia
GET    /me
GET    /me/orders
```

**Importadoras**

```http
POST   /importers
GET    /importers/me
PATCH  /importers/me
POST   /importers/me/wallet/verify
GET    /importers/me/orders
```

**Cotizaciones y checkout**

```http
POST   /quotes                  # importadora autenticada
GET    /quotes/:id
PATCH  /quotes/:id              # solo DRAFT, versionado
POST   /quotes/:id/publish      # congela condiciones, crea enlace privado
GET    /checkout/:token         # vista pública mínima, sin datos sensibles
POST   /checkout/:token/accept  # comprador autenticado + consentimiento expreso
```

**Pago y escrow**

```http
GET    /orders/:id
POST   /orders/:id/ramp/quote
POST   /orders/:id/ramp/start
GET    /orders/:id/ramp/status
POST   /orders/:id/escrow/prepare-funding  # payload verificable de contrato
POST   /orders/:id/escrow/submit           # tx firmada, jamás private key
GET    /orders/:id/escrow
POST   /orders/:id/advance/prepare         # solo modo parcial y auth importadora
POST   /orders/:id/delivery/prepare-confirmation
POST   /orders/:id/disputes
POST   /orders/:id/disputes/:disputeId/prepare-resolution  # árbitro
```

**Logística y evidencia**

```http
POST   /orders/:id/evidence/upload-url
POST   /orders/:id/evidence/confirm-upload
GET    /orders/:id/evidence
PATCH  /orders/:id/logistics
```

**Operación e integraciones**

```http
POST   /webhooks/pollar         # solo si el proveedor documenta endpoint/firma; verificar autenticidad
GET    /health
GET    /ready
GET    /docs                    # Swagger
```

Los endpoints `prepare-*` **no ejecutan acciones por sí solos**: construyen transacciones con los argumentos validados que debe autorizar el usuario adecuado. Es válido separar `submit`/`status`; documentar exactamente qué firma ocurre en cliente, qué se verifica en servidor y quién paga fees. No custodiar claves del cliente/importadora. Usar `Idempotency-Key` en endpoints mutadores relevantes y protecciones contra spam.

### Controles de acceso

- RBAC: `BUYER`, `IMPORTER_OWNER`, `IMPORTER_OPERATOR`, `ADMIN`, `ARBITER` (una persona puede tener varios roles).
- Nadie consulta datos privados de una orden ajena, aunque conozca el enlace de checkout.
- La URL de checkout solo permite ver una cotización **sanitizada**, no direcciones, teléfonos ni evidencias.
- No permitir que un operador o admin modifique términos firmados ni actúe en nombre de wallet sin su firma.
- Transiciones de estados mediante servicios de dominio, no `PATCH status` genérico.

---

## 8. Pollar, autenticación, KYC y rampas

### Diseño por puertos/adaptadores

Crear interfaces independientes para no acoplar el negocio a Pollar:

```ts
interface IdentityProvider {
  verifySessionOrWalletProof(input: unknown): Promise<VerifiedIdentity>;
}
interface KycProvider {
  getRequirements(userId: string, corridorId?: string): Promise<KycRequirements>;
  getStatus(userId: string, corridorId?: string): Promise<KycState>;
  startVerification(userId: string, corridorId?: string): Promise<VerificationStart>;
}
interface RampProvider {
  listAvailableRoutes(input: RampRouteInput): Promise<RampRoute[]>;
  getQuote(input: RampQuoteInput): Promise<RampQuote>;
  start(input: StartRampInput): Promise<RampSession>;
  getStatus(externalId: string): Promise<RampState>;
}
interface StellarEscrowGateway {
  prepareFunding(input: FundingInput): Promise<UnsignedOrAuthRequiredTx>;
  getOrderOnChain(id: string): Promise<OnChainEscrowState>;
  getVerifiedTransaction(hash: string): Promise<VerifiedTransaction>;
}
```

Estas son **interfaces internas sugeridas**, no afirmaciones de que Pollar exponga métodos con esas firmas.

### Pollar: requisitos reales y límites

1. Revisar SDK oficial (`@pollar/core`, `@pollar/react` si la futura UI lo utiliza), versión fijada y endpoints de servidor actuales. Autenticación por email/OTP si está disponible; el backend verifica criptográficamente sesión/identidad o desafío de wallet según el flujo realmente soportado. **No confiar en un email, address o userId recibido del navegador sin prueba**.
2. Consultar requisitos KYC **por corredor/rampa**; KYC puede ser `none/pending/approved/rejected/expired` u otros estados documentados, mapearlos sin asumir que una aprobación es universal.
3. Para importadoras, contemplar **KYB o revisión empresarial separada**; KYC de persona física no equivale a verificación de la empresa. En MVP la aprobación de importadoras/limites puede ser manual.
4. Flujo BOB → USDC: descubrir rutas compatibles con **Bolivia + red Stellar + Testnet**; **no inventar** ruta ni asegurar disponibilidad. La documentación pública puede describir rampas o experiencias aún `coming soon`; usar `MockRampProvider` en pruebas mientras no haya corredor funcional y credenciales verificadas.
5. Si no se puede realizar KYC/rampa en Testnet, permitir **solo modo desarrollo** con `MockKycProvider`/`MockRampProvider` y tokens Testnet obtenidos por medios documentados; exhibir bandera `SIMULATED` en BD/API/logs.
6. Guardar referencias y estados de verificación, **no guardar imágenes de pasaporte/cédula** si las gestiona el proveedor.
7. Implementar idempotencia en callbacks, verificación de firma/secret o polling verificado (según documentación), timestamps, protección ante replays, y conciliación independiente de transacciones on-chain.
8. Si el SDK no soporta una transacción Soroban específica, documentar el gap y diseñar la composición de firma segura con Stellar SDK sin asumir que Pollar puede firmarla automáticamente.
9. No asumir que Pollar o su proveedor resuelven toda la regulación local; el diseño técnico debe contemplar revisión legal antes de Mainnet.

### Fondos en Testnet

- Usar exclusivamente Testnet y **activos sin valor real** para las pruebas.
- Configurar contrato token Testnet verificable (SAC de activo de prueba o token mock compatible), nunca incrustar USDC Mainnet ni XLM como si fueran USDC Testnet.
- Documentar provisioning de cuentas, trustlines cuando correspondan, sponsorship de fees y firmas con wallet. Si la disponibilidad de Pollar es insuficiente, habilitar wallet test de CLI para E2E sin afirmar que simula todo el login.

---

## 9. Procesamiento on-chain y conciliación

- Fuente de verdad financiera: contrato + operaciones verificadas de Stellar; PostgreSQL mantiene proyección materializada.
- Worker `EscrowIndexer`: lee estado/eventos por checkpoints (ledger/tx/event), valida contrato/red/token/orderId y persiste `uniqueEventKey` para exactamente-una-aplicación lógica, con reintentos idempotentes.
- Worker `Reconciliation`: detecta órdenes con funding pendiente, compare estado de BD vs blockchain y repara estados derivados **sin transferir fondos**.
- No depender de histórico infinito de RPC; documentar retención, checkpoints y recuperación/reindexación.
- Registrar hash de tx y enlace a explorador Testnet en respuestas (generado usando URL configurable y hash validado).
- Separar eventos de rampa (fiat) de eventos de escrow (USDC); si el primero tiene éxito y el segundo no, mostrar claramente `WALLET_FUNDED`/`ESCROW_PENDING` y proceso de reintento o recuperación.

## 10. Seguridad, privacidad y riesgo

- Nunca almacenar ni registrar seed phrases/private keys, credenciales de Pollar en frontend, tokens de acceso en logs ni números completos de tarjetas.
- Secrets solo en env/secret manager. Validación DTO con `class-validator`/Zod, sanitización, CORS restrictivo, Helmet, throttling, políticas de tamaño y MIME de archivos.
- Nombres de archivo aleatorios; subida a almacenamiento privado con URL presignada; escaneo/validación básica; hash SHA-256. No acceder a URLs arbitrarias de productos desde servidores si abren riesgo SSRF: validar esquema y hostname, no auto-scraping en MVP.
- Protección contra IDOR, duplicados, doble gasto/release, race conditions, webhooks falsos, firmas sobre argumentos distintos, expiración/reutilización de enlaces, replay de consentimientos.
- Congelar `termsHash`, importe, token, wallets y porcentaje antes del funding. Cambios en condiciones requieren **nueva cotización/nueva aceptación**, nunca editar una orden pagada.
- La confirmación logística no equivale automáticamente a entrega válida. Mantener proceso explícito comprador/árbitro.
- Respetar zona horaria/fechas; usar UTC en BD/contratos y presentar Bolivia en interfaz futura.
- Añadir límites de orden, límites de anticipo por importadora, suspensión de negocios y auditoría.
- Para el anticipo parcial, guardar evidencia auditable de aceptación del riesgo: mensaje y términos versionados + timestamp + hash + firma/autorización de funding.
- Las protecciones ofrecidas comercialmente no pueden superar el saldo realmente retenido ni implicar garantía que la plataforma no financia.

---

## 11. Escenarios de aceptación E2E

### Escenario 1 — capital propio

1. Importadora verificada crea cotización privada de MacBook, total 1.200 USDC de prueba, modo FULL.
2. Cliente crea o recupera cuenta, acepta y financia 1.200.
3. API valida saldo del contrato antes de registrar `ESCROW_FUNDED`.
4. Importadora adjunta comprobante y seguimiento.
5. Cliente confirma recepción con firma.
6. Contrato paga 1.200 a importadora y saldo final 0; eventos/BD consistentes.

### Escenario 2 — anticipo parcial

1. Importadora con permiso habilitado crea cotización de 1.200 y anticipo 900; el checkout revela riesgo.
2. Comprador consiente y financia 1.200.
3. Importadora reclama 900 **antes de comprar**; contrato guarda 300.
4. Importadora compra y entrega; comprador confirma.
5. Se liberan 300; cero saldo; imposible reclamar anticipos/release dos veces.

### Escenario 3 — incumplimiento tras anticipo

1. Orden PARTIAL de 1.200 con anticipo 900 ya pagado; saldo 300.
2. Comprador disputa falta de entrega.
3. Una cuenta no autorizada no puede resolver; importadora no puede liberar saldo durante disputa.
4. Árbitro decide devolver 300 al comprador; saldo final 0.
5. API explica que los 900 no están en escrow y **no** presenta reembolso ficticio de 1.200.

### Escenario 4 — falla de rampa o funding

1. Rampa mock indica fondos fiat recibidos pero token no llegó al contrato.
2. API mantiene `ESCROW_PENDING`, no permite considerar pagado ni ejecutar anticipo.
3. Cuando una transacción válida financia el contrato, conciliación actualiza estado una vez.

### Escenario 5 — acceso y condiciones

- Usuario ajeno no puede ver pedido privado ni operar contrato.
- Cotización vencida o modificada no permite financiar con términos viejos.
- Dos requests idénticos o dos webhooks no producen duplicación de fondos/eventos.

---

## 12. Desarrollo por fases (orden para Claude Code)

### Fase 1 — bootstrap + arquitectura

- Crear monorepo, Docker Compose, NestJS, Prisma, migraciones, healthchecks, Swagger y `.env.example`.
- Modelo de dominios y roles, tests básicos, lint/format, errores consistentes.
- Escribir `docs/architecture.md` y `docs/state-machines.md`.

### Fase 2 — contratos Soroban (antes de integraciones reales)

- Crear contrato Rust con las funciones e invariantes descritas.
- Pruebas unitarias exhaustivas, WASM compilable, scripts CLI Testnet.
- Registrar token elegido, deployment IDs, tx hashes y procedimiento para revalidar estado.

### Fase 3 — API de negocio y escrow

- Usuarios/sesiones verificables, importadoras, cotizaciones, links privados, orders, evidencia y disputas.
- Integración con contrato vía Stellar SDK, prepare/sign/submit, indexador/reconciliación.
- Tests API/DB y los cuatro escenarios E2E simulados.

### Fase 4 — adaptadores Pollar y pruebas end-to-end

- Implementar adapters con APIs verificadas y mocks intercambiables.
- KYC/rampa real solo si el corredor y credenciales existen; si no, reportar límite sin bloquear el resto del MVP.
- Documentar flujo para futuro frontend, colección HTTP y despliegue Testnet reproducible.

### Fase 5 — endurecimiento y entrega

- Auditoría manual, revisión de auth/race conditions, validación de consentimientos, manejo de errores y logs.
- Ejecución de suite completa, reporte de resultados y `IMPLEMENTATION_STATUS.md`.

**Definición de terminado:** el backend arranca con un comando documentado, migraciones aplican, `cargo test` y tests API pasan, un usuario de Testnet puede financiar contrato y completar FULL y PARTIAL con firmas válidas, y no hay dependencia de rampas reales para reproducir los tests. Si no se desplegó por falta de credenciales, marcarlo `NOT DEPLOYED` y conservar scripts.

---

## 13. Variables de entorno (ejemplo; no colocar secretos reales)

```dotenv
NODE_ENV=development
API_PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/import_escrow?schema=public
REDIS_URL=redis://localhost:6379
SESSION_SECRET=REPLACE_WITH_LONG_RANDOM_SECRET
FRONTEND_ORIGIN=http://localhost:3001

STELLAR_NETWORK=testnet
STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_ESCROW_CONTRACT_ID=
STELLAR_ESCROW_TOKEN_CONTRACT_ID=
STELLAR_EXPLORER_BASE_URL=https://stellar.expert/explorer/testnet

POLLAR_MODE=mock
POLLAR_API_URL=
POLLAR_API_KEY=
POLLAR_APP_ID=
POLLAR_KYC_MODE=mock
POLLAR_RAMP_MODE=mock

OBJECT_STORAGE_PROVIDER=local
OBJECT_STORAGE_BUCKET=import-escrow-dev
ADMIN_INITIAL_EMAIL=
```

Las variables exactas de Pollar pueden diferir según el SDK/API que se confirme: adaptar el `.env.example` final a la documentación verificada. **No incluir claves privadas ni usar cuentas reales en pruebas**.

## 14. Documentación oficial de referencia (verificar antes de implementar)

- Stellar Developers: https://developers.stellar.org/
- Soroban Rust SDK: https://docs.rs/soroban-sdk/
- Stellar JS SDK + autorización de contratos: https://stellar.github.io/js-stellar-sdk/guides/07-contract-auth/
- Soroban storage/TTL: https://developers.stellar.org/docs/learn/fundamentals/contract-development/storage
- Pollar (repositorio oficial): https://github.com/pollar-xyz/pollar
- Pollar Docs: https://github.com/pollar-xyz/pollar-docs
- Pollar demo oficial: https://github.com/pollar-xyz/demo-nextjs

> **Importante:** la existencia de interfaces KYC/rampas en el SDK no garantiza que un corredor BOB → USDC Stellar en Testnet funcione hoy ni que el producto esté habilitado comercialmente. Consultar disponibilidad real y respetar estados de `coming soon`.

## 15. Fuera de alcance hasta nueva indicación

- Diseño frontend / app móvil / notificaciones WhatsApp automáticas.
- Marketplace de importadoras y catálogo/scraping de tiendas.
- Tarjetas para importadoras o adquisición automática en Amazon/Apple/eBay.
- Financiamiento de terceros, créditos y fondos propios de la plataforma.
- Verificación automática perfecta de envíos (tracking no es una prueba definitiva).
- Custodia de fondos fiat por nuestra empresa o integración bancaria propia.
- Mainnet, dinero real o afirmación de cumplimiento regulatorio sin asesoría y aprobaciones correspondientes.

---

## Primer pedido de trabajo para Claude Code

**Comienza por Fase 1 y Fase 2**. Construye la API base y un contrato escrow que pase sus tests para FULL_ESCROW y PARTIAL_ADVANCE. Si puedes seguir en esta ejecución, continúa por las siguientes fases. Mantén los adapters de Pollar simulados hasta confirmar APIs/corredores y contar con credenciales. **Entrega código funcional, no pseudocódigo**, y registra comandos y evidencias de las pruebas realizadas. No asignes nombre comercial al proyecto.
