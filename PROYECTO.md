# Montuno: de qué trata el proyecto

## En una frase

Montuno permite que las importadoras pequeñas de Bolivia, que venden por WhatsApp y bajo pedido, cobren por adelantado **sin que el comprador tenga que confiar a ciegas**. El dinero queda guardado en un contrato inteligente en Stellar hasta que el pedido llega, o se libera una parte acordada de antemano.

## El problema

En Bolivia es muy común comprar productos del exterior (Amazon, eBay, Apple…) a través de importadoras pequeñas que trabajan por WhatsApp:

1. El comprador manda por chat el enlace del producto que quiere.
2. La importadora le responde con un precio final, un plazo estimado y sus condiciones.
3. El comprador acepta y **paga el 100% por adelantado**.
4. La importadora compra con su tarjeta (aprovechando descuentos, promociones o puntos) y gestiona el envío.
5. Semanas después entrega el producto en Bolivia.

En el paso 3 el comprador queda expuesto. Paga todo antes de recibir nada y solo puede confiar en que la importadora cumplirá. Si no cumple, casi no tiene cómo recuperar su dinero. Para las importadoras honestas también es un freno: los clientes nuevos desconfían y venden menos.

## La solución

Montuno se mete en el paso del pago, sin cambiar la forma de vender. La conversación sigue en WhatsApp. Lo único nuevo es que la importadora manda un **enlace de checkout** en lugar de pedir una transferencia:

```text
WhatsApp: "Te sale Bs 8.352, llega en 20 días"  →  la importadora genera una cotización en Montuno
        ↓
el comprador abre el enlace privado y ve precio, plazo, condiciones y cuánto queda protegido
        ↓
acepta y paga  →  el dinero entra a un contrato inteligente (escrow), no a la cuenta de la importadora
        ↓
la importadora compra, envía y registra comprobantes y tracking
        ↓
el comprador confirma que recibió  →  el contrato le paga a la importadora
        (o abre una disputa y un árbitro decide sobre lo que sigue retenido)
```

**Montuno no es un marketplace.** No tiene catálogo, no busca productos ni compra en tiendas extranjeras. Cada importadora sigue con sus clientes, sus precios y su forma de comprar. Montuno solo pone la garantía del pago.

## Las dos modalidades

El comprador siempre deposita el 100% del pedido. Lo que cambia es **cuándo** cobra la importadora.

### Escrow completo (`FULL_ESCROW`)
Pensada para importadoras con capital propio. Compran con su propio dinero y el pago del cliente queda **todo retenido** hasta que este confirma la entrega. Es la modalidad más segura para el comprador.

### Anticipo parcial (`PARTIAL_ADVANCE`)
Pensada para importadoras que necesitan liquidez para comprar. Antes de pagar, el comprador acepta expresamente que la importadora reciba un **anticipo fijo**, y esa parte se libera **antes de que compre el producto**. El resto queda retenido hasta la entrega.

> **Ejemplo:** pedido de 1.200 USDC con un anticipo de 900. La importadora cobra 900 para comprar y quedan 300 en el contrato. Si no cumple, el comprador puede recuperar **como máximo esos 300**. Los 900 ya pagados no se pueden devolver desde el contrato.

Ese riesgo se le muestra al comprador con claridad antes de pagar, y su aceptación queda registrada: el texto exacto que vio, un hash del texto y la fecha. Las importadoras no pueden usar esta modalidad hasta que el administrador lo autoriza, y siempre con un tope.

## Quién participa

| Actor | Qué hace |
|---|---|
| **Comprador** | Recibe el enlace, revisa las condiciones, paga, sigue su pedido, confirma la entrega o abre una disputa. |
| **Importadora** | Se registra, la plataforma la revisa, configura su wallet de cobro, crea cotizaciones, sube comprobantes y tracking, y cobra. |
| **Administrador** | Verifica a las importadoras y fija sus límites (monto máximo por pedido y anticipo permitido). |
| **Árbitro** | En una disputa, decide cómo repartir el dinero que **sigue retenido**. No puede tocar fondos fuera de una disputa ni un anticipo ya pagado. |
| **Pollar / rampa** | Proveedor externo para entrar con correo (wallet embebida) y, a futuro, convertir bolivianos a USDC. |

## Por qué usar blockchain (Stellar)

- **El dinero no lo tiene Montuno ni la importadora.** Lo guarda un contrato inteligente con reglas públicas que nadie puede cambiar a mitad de un pedido.
- **Las reglas se cumplen solas.** El contrato solo libera el saldo si el comprador firma la confirmación, solo paga el anticipo una vez y solo deja repartir al árbitro lo que sigue retenido.
- **Todo se puede verificar.** Cada depósito, anticipo, liberación o reembolso queda registrado en la red, con un enlace al explorador.
- **Stellar es rápido y barato,** y tiene USDC (un dólar digital). Así el precio no depende de la volatilidad de una criptomoneda.

**Qué no hace la blockchain:** no puede saber si un paquete llegó ni si una foto es real. Por eso la entrega la confirma el comprador y, si hay desacuerdo, decide el árbitro. El tracking del courier ayuda, pero no es prueba definitiva.

**Qué queda fuera de la blockchain:** los datos personales (nombre, teléfono, dirección, comprobantes). En la red solo quedan montos, direcciones de wallet y huellas digitales (hashes) de las condiciones y de las disputas.

## Cómo está construido

```text
Futuro frontend (apps/web)  ──►  API (NestJS + PostgreSQL)  ──►  Contrato escrow (Soroban, Stellar)
                                   │                                  │
                                   │  prepara las transacciones       │  guarda el dinero y aplica
                                   │  y verifica lo que pasó on-chain │  las reglas
                                   ▼                                  ▼
                       cotizaciones, pedidos, logística,         USDC de Circle
                       evidencias, disputas, auditoría
```

- **Contrato inteligente** (Rust, Soroban): guarda el dinero de cada pedido y aplica las reglas: depósito, anticipo, confirmación, disputa, resolución y cancelación de mutuo acuerdo. Tiene 35 pruebas automáticas, entre ellas secuencias aleatorias que comprueban que el dinero nunca se pierde ni se duplica.
- **API**: maneja todo lo que no va en la blockchain, como cuentas, importadoras, cotizaciones, enlaces de checkout, estados del pedido, evidencias, disputas y auditoría. Prepara cada transacción, que el usuario firma **en su propia wallet**; la API nunca tiene las claves de los usuarios.
- **Login**: con la wallet de Stellar, o con el correo a través de Pollar, que crea una wallet embebida. En los dos casos la wallet firma un desafío y el servidor verifica la firma.
- **Rampa BOB → USDC**: hoy el pago en bolivianos es simulado, pero el USDC de Testnet que recibe el comprador es real.

## En qué estado está

Es un **MVP funcional en Stellar Testnet**, la red de pruebas de Stellar, donde el dinero no tiene valor real.

**Funciona y está probado:**
- El contrato, desplegado en Testnet con USDC de Circle.
- Los dos flujos completos (escrow total y anticipo parcial) y el caso de incumplimiento después de un anticipo, ejecutados de punta a punta en la red real con firmas reales.
- La API completa, con 39 pruebas automáticas.

**Simulado o pendiente:**
- El pago en bolivianos (rampa).
- El KYC.
- El login con Pollar con una cuenta real.
- El frontend.

**Antes de usarlo con dinero real hace falta:**
- Una auditoría externa del contrato.
- Revisión legal y regulatoria en Bolivia.
- Un árbitro multisig en lugar de uno solo.
- Una rampa real BOB → USDC hacia Stellar.
- La interfaz de usuario.

El detalle técnico de cada punto está en [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md).

## Próximos pasos

1. **Frontend** (`apps/web`): la página de checkout para el comprador y el panel de la importadora.
2. **Probar Pollar con una cuenta real**, tanto el login con correo como la firma de transacciones.
3. **Confirmar una ruta real BOB → USDC en Stellar** con Pollar u otro proveedor.
4. **Endurecer para producción:** árbitro multisig, plazo máximo para resolver disputas, auditoría, almacenamiento en la nube y monitoreo.

## Para saber más

| Documento | Para quién |
|---|---|
| [README.md](README.md) | Desarrolladores: cómo correrlo y probarlo |
| [docs/architecture.md](docs/architecture.md) | Arquitectura y decisiones técnicas |
| [docs/contract.md](docs/contract.md) | El contrato: funciones, reglas y despliegue |
| [docs/state-machines.md](docs/state-machines.md) | Estados de cotizaciones, pagos, logística y disputas |
| [docs/security-and-risk.md](docs/security-and-risk.md) | Riesgos económicos y medidas de seguridad |
| [docs/pollar-integration.md](docs/pollar-integration.md) | Qué hace y qué no hace Pollar |
| [guia.md](guia.md) | La especificación original del MVP |
