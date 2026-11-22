# Guion del pitch deck (9 diapositivas)

Solo usa hechos que están en el repo. Lo que todavía no existe queda como `[completar]`.

---

### 1. Montuno
- **Frase:** Compra afuera. Paga sin miedo.
- **Subtítulo:** Pagos protegidos con escrow en Stellar para compras por importación bajo pedido en Bolivia.
- **Visual:** la marca (macizo con corte vertical) sobre fondo negro.

### 2. El problema
- En Bolivia se compra por WhatsApp a importadoras pequeñas: el comprador manda un enlace, recibe un precio y **paga el 100% por adelantado**.
- Si la importadora no cumple, el comprador casi no tiene cómo recuperar su dinero.
- Las importadoras honestas venden menos porque los clientes nuevos desconfían.
- **Evidencia:** [completar con `docs/validacion.md`: "[n] de [N] compradores pagaron 100 % por adelantado", "[n] de [N] tuvieron problemas"].

### 3. La solución
- La venta sigue en WhatsApp. La importadora manda un **enlace de checkout privado** en lugar de pedir una transferencia.
- El pago entra a un **contrato inteligente (escrow)** y se libera cuando el comprador confirma la entrega, o según decida un árbitro si hay disputa.
- No es un marketplace de stock. Se está agregando un catálogo de referencia de importadoras verificadas (en construcción), pero el precio final siempre sale de una cotización.

### 4. Cómo funciona: dos modalidades
| | Escrow completo | Anticipo parcial |
|---|---|---|
| Para quién | Importadoras con capital propio | Importadoras que necesitan liquidez para comprar |
| Antes de la entrega | No se libera nada | Un anticipo fijo, aceptado por el comprador antes de pagar |
| Si hay incumplimiento | Se recupera todo lo retenido | Solo lo que sigue retenido (se muestra antes de pagar) |

### 5. Por qué Stellar
- Contrato **Soroban propio**, inmutable, sin función administrativa para mover fondos ajenos.
- **USDC de Circle** en Testnet: el precio no depende de una criptomoneda volátil.
- Login por **firma de wallet (SEP-53)**, compatible con Freighter y con la wallet embebida de Pollar (correo).
- Las firmas ocurren en la wallet del usuario; el servidor nunca tiene sus claves.

### 6. Evidencia on-chain (Testnet)
- Contrato `CA3CWIHORCCANE73NITO5T2I652SGR4SOUZDMHXVQUH5T4DGX7YJQCTR`.
- Escrow completo, anticipo parcial y disputa tras anticipo **ejecutados de punta a punta** con firmas reales: 12 transacciones por la API y 9 del smoke test por CLI.
- 35 tests del contrato (con secuencias aleatorias que verifican que el dinero no se pierde ni se duplica) y 45 de la API.
- **Visual:** captura de stellar.expert con la liberación y la resolución de la disputa (enlaces en `docs/demo-jueces.md`).

### 7. Modelo de negocio
- Hoy el contrato **no cobra comisión**; la cotización admite declarar una comisión de servicio antes de pagar.
- Propuesta de cobro: [completar con lo que digan las entrevistas, pregunta I7].
- Mercado inicial: [completar con `docs/mercado.md`].

### 8. Estado y próximos pasos
- **Hoy:** MVP funcional en Stellar Testnet. El escrow, las firmas y el USDC de Testnet son reales; el pago en bolivianos (rampa), el KYC y el OTP son simulados. Trustless Work se agrega como motor alternativo beta. El frontend está en construcción.
- **Próximo:** terminar la interfaz, probar Pollar con una cuenta real, confirmar una rampa BOB → USDC hacia Stellar, auditoría del contrato, árbitro multisig y revisión legal.
- **Tracción:** [completar].

### 9. Equipo
| Integrante | Rol | Qué construyó |
|---|---|---|
| Luis Daniel Rojas Caceres (GitHub daniel69zz) | [completar] | [completar] |
| [nombre] | [rol] | [qué construyó] |

**Cierre:** "Contrato propio, probado de punta a punta y verificable por cualquiera en stellar.expert."
