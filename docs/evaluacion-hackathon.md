# Montuno frente a la evaluación de la hackathon

**Contexto.** La IA del sitio de la hackathon evaluó **Moontuno**, el proyecto de un amigo (repo `ozioziel/Jukora`, README "Jucumari"), y le dio **51/100 ("Necesita trabajo")**. Este documento revisa, punto por punto, si **Montuno** (`github.com/daniel69zz/montuno`) cumple cada crítica. Toda la evidencia sale de archivos reales del repositorio.

Leyenda: ✅ cubierto · 🟡 parcial · ❌ no cubierto · ➖ no aplica.

> **Resumen:** Montuno ya resuelve la crítica más pesada, que el escrow no esté probado. El contrato Soroban propio se ejecutó en Testnet de punta a punta, con firmas reales y hashes publicados. El equipo reporta entrevistas exploratorias con recepción positiva en La Paz y El Alto, pero falta sistematizar respuestas y métricas. También faltan tamaño de mercado, video y pitch deck.

---

## 1. Las 6 acciones de "Qué hacer ahora"

| # | Recomendación | Montuno | Evidencia o qué falta |
|---|---|---|---|
| 1 | Ejecutar el escrow de punta a punta en Testnet y publicar la evidencia | ✅ | Contrato propio `CA3CWIHORCCANE73NITO5T2I652SGR4SOUZDMHXVQUH5T4DGX7YJQCTR`, con el USDC de Circle de Testnet (`CBIELTK6…DAMA`). La prueba de punta a punta por la API (`docs/deployments/testnet-api-e2e.json`, 2026-11-22T14:09Z) tiene 12 transacciones con firmas reales: FULL (`d4d0134d…` fund, `0a2ac6ea…` release), PARTIAL (`0cad6a7e…` fund, `b47fdc01…` anticipo, `a9801a1d…` release) y una disputa resuelta por el árbitro (`fd4d69d3…` abre, `7911055e…` resuelve). Además, un smoke test por CLI con 9 pasos (`testnet-smoke.json`). La evidencia está enlazada desde el README. |
| 2 | Validar el problema con usuarios y proveedores reales | 🟡 | El equipo reporta entrevistas exploratorias con recepción positiva en La Paz y El Alto. `docs/validacion.md` aún no contiene cantidad de participantes ni respuestas individuales que permitan revisar la evidencia. |
| 3 | Demo verificable sin JavaScript, video y cuenta de prueba | 🟡 | Hay una guía reproducible (`README.md` → Testnet; `scripts/testnet/*.sh`) y una colección HTTP (`docs/http/requests.http`). Pero el frontend (`apps/web`) **está en construcción** y no hay video, ni landing estática, ni credenciales de prueba para jueces. |
| 4 | Etapa honesta y nombre único | 🟡 | El nombre está unificado: "Montuno" en el repo (`daniel69zz/montuno`) y el README. Los nombres técnicos heredados (`import_escrow`, prefijos `import-escrow/*/v1`) están explicados en el README. La etapa es "MVP funcional en Stellar Testnet", así que el formulario debe declarar **MVP en Testnet**, no "producto en vivo". El formulario no se puede revisar desde el repo. |
| 5 | Mostrar el aporte de cada integrante | ❌ | No hay sección "Equipo" en el README. `git log` muestra 3 commits, todos de Luis Daniel (`bed1802`, `36fc8ac`, `b356ce8`, del 22-11-2026). |
| 6 | Ponerle un número al mercado inicial | ❌ | No hay ninguna estimación de mercado en el repo. |

## 2. Criterios con puntaje (cómo saldría Montuno)

| Criterio (peso) | Nota del otro proyecto | Montuno | Por qué |
|---|---|---|---|
| Problema y usuario (30%) | 4/10 | 🟡 | El problema está descrito en el README y hay una señal cualitativa inicial de entrevistas reportadas en La Paz y El Alto. **Faltan notas sistematizadas y cifras de mercado**, la misma debilidad que en Moontuno. |
| Producto funcionando (25%) | 6/10 | 🟡 a ✅ | El backend y el contrato están probados: 35 tests del contrato, 45 de la API y E2E en Testnet. Falta la interfaz (en construcción) y el video. |
| Uso de Stellar (25%) | 5,5/10 | ✅ | Tiene **contrato Soroban propio** desplegado e inmutable, con hash de WASM publicado (`d369daf5…`). Usa USDC de Circle de Testnet, login SEP-53 verificado byte a byte contra `stellar message sign`, ID del contrato y hashes publicados, y un indexador de eventos sobre el RPC real. Trustless Work se está agregando como motor alternativo beta, que es un extra y no el núcleo. |
| Equipo y compromiso (20%) | 5/10 | ❌ | No hay sección de equipo y el historial es muy corto: 3 commits grandes de un solo autor, el mismo patrón de "importado en bloque" que se le criticó al otro proyecto. |

## 3. Incongruencias detectadas

| Incongruencia (severidad) | Montuno | Detalle |
|---|---|---|
| Escrow presentado como funcional pero sin probar (alta) | ✅ | En Montuno está probado en Testnet y documentado así en el README → "Estado". |
| Etapa "producto en vivo" sin respaldo (media) | 🟡 | El README dice "MVP funcional en Stellar Testnet" y es coherente. Hay que verificar que el formulario diga lo mismo; desde el repo no se puede. |
| Historial de commits en bloque y de un solo autor (media) | ❌ | Mismo riesgo: 3 commits del 22-11-2026, todos del mismo autor. Conviene trabajar en commits pequeños desde ahora (frontend, Trustless Work, docs) y, si hay más integrantes, que hagan PRs desde sus propias cuentas. |
| Tres nombres para el mismo producto (baja) | ✅ | Un solo nombre, Montuno. Los identificadores técnicos heredados están justificados en el README ("Nombres heredados"). |
| Estado de la IA desactualizado (baja) | ➖ | Montuno no tiene IA ni la promete en el README. |

## 4. Información que falta

| Ítem | Montuno | Evidencia o qué hacer |
|---|---|---|
| Pitch deck | ❌ | No existe. |
| Video de la demo | ❌ | No existe. |
| Evidencia de validación (entrevistas, cartas, métricas) | 🟡 | Hay un resumen cualitativo reportado por el equipo; faltan cantidad de participantes, notas anonimizadas y métricas. |
| IDs de contrato y hashes de escrow en Testnet | ✅ | `docs/deployments/testnet.json`, `testnet-api-e2e.json` y `testnet-smoke.json`, enlazados desde el README. |
| Estimación numérica del mercado | ❌ | No existe. |
| Rol y aporte de cada integrante | ❌ | No hay sección "Equipo". |
| Enlaces de tracción verificables | ❌ | Ninguno. |
| Plan de rampa real BOB → USDC | 🟡 | `docs/pollar-integration.md` documenta qué falta. La ruta BOB de Pollar va por Stereum → Polygon → CCTP, sin confirmar en Testnet. Hoy la rampa es **simulada en el pago en BOB**, pero la entrega del USDC de Testnet es real (caja `ie-caja`). Falta un plan concreto con un anchor o SEP-24, con plazos. |
| Origen del código | 🟡 | El repo público nació el 22-11-2026 con un commit inicial grande. Explicarlo en el README: se desarrolló localmente según `guia.md` y luego se publicó. |

## 5. Dónde Montuno ya supera las críticas

- **El escrow está probado de verdad**, no solo descrito: FULL, PARTIAL y la disputa tras anticipo se ejecutaron en Testnet con firmas reales, y hay 12 hashes publicados en la prueba de punta a punta por la API más los 9 del smoke test por CLI.
- **Tiene contrato Soroban propio** (no delega en terceros), inmutable, con 35 tests (incluidas secuencias aleatorias) y hash del WASM publicado.
- **Es honesto con el estado:** la tabla de "real o simulado" del README resume lo implementado.
- **La rampa entrega USDC de Testnet real** desde una caja, y el pago en BOB está marcado claramente como simulado.
- **Tiene un nombre único** y el README reúne la descripción y las instrucciones para desarrolladores.

## 6. Plan priorizado antes del cierre

| Prioridad | Acción | Esfuerzo | Mueve |
|---|---|---|---|
| 1 | **Validación (`docs/validacion.md`):** sistematizar las entrevistas exploratorias ya realizadas en La Paz y El Alto, y ampliar la muestra a 5–10 importadoras y 5–10 compradores. Registrar respuestas reales; no completar con supuestos. | Medio | Problema y usuario (30%) |
| 2 | **Video de 2–3 min:** cotización → checkout → depósito al escrow → anticipo → entrega → liberación, con la transacción abierta en stellar.expert. Mostrar también una disputa. | Bajo | Producto y Stellar |
| 3 | **Terminar el frontend** (en construcción) y agregar al README un **recorrido para jueces de menos de 2 minutos**: URL de la demo, modo DEMO y la wallet de prueba. | Medio | Producto funcionando |
| 4 | **Sección "Equipo"** en el README (rol y módulos de cada uno), y commits o PRs pequeños desde la cuenta de cada integrante. | Bajo | Equipo (20%) |
| 5 | **Mercado inicial** con fuentes públicas (ver la plantilla de abajo). | Bajo | Problema y usuario |
| 6 | **Plan de rampa real:** anchor candidato, SEP-24 o SEP-6, requisitos de KYC, y la ruta Pollar/Stereum con su estado. | Bajo | Uso de Stellar |
| 7 | **Licencia** (hoy el README dice que no hay) y **pitch deck** de 6–8 láminas. | Bajo | Presentación |

### Preguntas para importadoras (5–10)
1. ¿Cuántos pedidos bajo pedido cierras al mes por WhatsApp? ¿Cuál es el ticket promedio, en BOB o USD?
2. ¿Cobras el 100% por adelantado? ¿Cuántos clientes no compran porque no confían?
3. ¿Compras con tu propio capital o necesitas parte del pago antes de comprar? ¿Qué porcentaje?
4. ¿Aceptarías que el pago quede retenido hasta la entrega, o con un anticipo fijo?
5. ¿Cuánto pagarías por ese servicio (porcentaje o monto fijo por pedido)?
6. ¿Tienes una wallet o USDC? ¿Cómo convertirías de USDC a BOB?

### Preguntas para compradores (5–10)
1. ¿Compraste alguna vez a una importadora por WhatsApp? ¿Cuánto pagaste por adelantado?
2. ¿Tuviste algún problema (retraso, producto distinto, no entrega)? ¿Recuperaste el dinero?
3. ¿Pagarías algo más, o elegirías a una importadora, si el pago quedara protegido hasta la entrega?
4. ¿Aceptarías el riesgo de un anticipo si te muestran cuánto queda protegido?

Formato del resumen: "X de Y importadoras cobran el 100% adelantado", "X de Y compradores tuvieron un problema". **Usar solo datos de entrevistas reales.**

### Plantilla de mercado (completar con fuentes)
| Dato | Valor | Fuente |
|---|---|---|
| Importadoras o tiendas de importación bajo pedido activas en La Paz, El Alto, Cochabamba y Santa Cruz | [completar] | SEPREC (registro de comercio), INE, conteo de páginas o grupos de Facebook y WhatsApp |
| Pedidos promedio al mes por importadora | [completar] | Entrevistas |
| Ticket promedio por pedido | [completar] | Entrevistas |
| Comisión que aceptarían | [completar] | Entrevistas |
| **Mercado inicial ≈ importadoras × pedidos/mes × 12 × ticket × comisión** | [completar] | — |

---

## Avance

### Lo que ya quedó preparado (solo documentación, sin datos inventados)

| Acción del plan | Archivo | Qué contiene |
|---|---|---|
| 1 · Validación | [`docs/validacion.md`](validacion.md) | Guía de entrevistas, preguntas para importadoras (I1–I9) y compradores (C1–C8), resumen cualitativo de la primera ronda en La Paz y El Alto, y tablas pendientes de sistematizar |
| 2 · Video | [`docs/demo-jueces.md`](demo-jueces.md) | Guion de 2–3 minutos con escenas, qué mostrar y qué decir, basado en las transacciones reales |
| 3 · Demo verificable | [`docs/demo-jueces.md`](demo-jueces.md) | Recorrido de menos de 2 minutos con enlaces a stellar.expert (contrato, 12 transacciones del E2E por API y 9 del smoke por CLI), verificación en 3 clics y comandos local/Testnet |
| 4 · Equipo | `README.md` → "Equipo" | Tabla con tu fila (Luis Daniel Rojas Caceres, daniel69zz) y placeholders de rol y aporte |
| 5 · Mercado | [`docs/mercado.md`](mercado.md) | Fórmula, fuentes públicas a consultar (SEPREC, INE, Aduana Nacional, Cámara Nacional de Comercio, conteo propio) y tabla con `[completar]` |
| 7 · Pitch deck | [`docs/pitch.md`](pitch.md) | Guion de 9 diapositivas con hechos del repo y `[completar]` en tracción, mercado y equipo |

El README enlaza los cuatro documentos nuevos en "Documentación".

### Lo que requiere al usuario

| Pendiente | Por qué no lo puede hacer un agente |
|---|---|
| Sistematizar las entrevistas ya realizadas y ampliar la muestra | Requiere recuperar notas y seguir hablando con personas reales |
| Conseguir las cifras de `docs/mercado.md` | Requiere consultar las fuentes y citar datos verificables |
| Grabar el video y armar el deck | Requiere grabar pantalla y voz y diseñar las láminas |
| Completar la sección "Equipo" (roles, otros integrantes) | Solo tú sabes quién participa y qué hizo |
| Revisar el formulario de la hackathon (etapa "MVP en Testnet", nombre Montuno, enlaces) | No es accesible desde el repo |
| Commits pequeños y PRs desde la cuenta de cada integrante | Depende de cada persona y de su cuenta |
| Plan de rampa real (acción 6) y licencia | Decisiones de negocio y legales |
| Terminar el frontend | En construcción en otra parte de esta sesión |
