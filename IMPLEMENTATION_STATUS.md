# IMPLEMENTATION_STATUS — Montuno

Fecha: 2026-11-22 · Alcance: Fases 1 a 5 de `guia.md` (backend + contrato + pruebas + Testnet). Sin frontend.

## Resumen

| Entregable | Estado |
|---|---|
| Contrato escrow Soroban (FULL y PARTIAL, disputa, cancelación consensuada, TTL) | ✅ Implementado y con 35 tests |
| Despliegue en Stellar **Testnet** con **USDC de Circle (testnet)** | ✅ **DEPLOYED** (ver abajo) |
| Smoke test vía CLI en Testnet (3 escenarios, firmas reales) | ✅ OK |
| API NestJS completa (auth, importadoras, cotizaciones, checkout, órdenes, escrow, disputas, logística, evidencias, rampas, jobs) | ✅ |
| E2E **a través de la API** contra Testnet real: rampa caja → FULL, PARTIAL, disputa tras anticipo + indexador | ✅ OK |
| Escenarios de aceptación (§11) con API + Postgres | ✅ 11 tests + 6 de la rampa caja |
| Rampa BOB → USDC | 🟡 Pago en BOB **SIMULADO**; entrega de **USDC de Circle de Testnet real** desde una caja (`RAMP_PROVIDER=caja-testnet`, patrón WorkVille). Prohibida en production |
| Login con Pollar (patrón WorkVille: correo en Pollar → firma SEP-53 de su wallet embebida) | ✅ Backend listo (`GET /config`, `walletProvider: 'pollar'`); ⚠️ sin probar con una cuenta real de Pollar ni UI |
| Pollar como verificador de sesión en servidor / rampa Pollar | ⛔ No documentado por Pollar / ruta BOB → Stellar en Testnet no confirmada |
| KYC | 🟡 Mock `SIMULATED` |
| BullMQ / Redis | ⚠️ Patrón preparado; jobs en proceso con lock asesor de Postgres (sin Redis en el entorno) |
| `cancel_by_agreement` vía API | ⚠️ Solo en el contrato (con tests); requiere dos firmas, la API no tiene endpoint |
| Docker Compose | ⚠️ Escrito pero **no ejecutado** (daemon de Docker apagado; se probó con un Postgres 18 local) |

## Despliegue Testnet (vigente)

- **Escrow:** `CA3CWIHORCCANE73NITO5T2I652SGR4SOUZDMHXVQUH5T4DGX7YJQCTR` ([explorador](https://stellar.expert/explorer/testnet/contract/CA3CWIHORCCANE73NITO5T2I652SGR4SOUZDMHXVQUH5T4DGX7YJQCTR))
- **Token:** USDC de Circle de **testnet** `USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`, SAC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`. Es el mismo que usa WorkVille; lo derivé con `stellar contract id asset` y coincide. 7 decimales. El token es **inmutable** en el contrato, por eso este es un escrow nuevo.
- **Caja de la rampa:** `GCSO4Z366IA37LNFB4DNSKKZ5HN73RKDL2RHERTF2NNEVDG76KKMQ3GV` (`ie-caja`). Consiguió su USDC en el **DEX de Testnet** pagando con XLM de friendbot (`path-payment-strict-receive`), sin faucet web. Se recarga volviendo a ejecutar `deploy.sh`.
- **WASM sha256:** `d369daf5820a9f1b44ba0bffba29389ff4ffdeea67554db442f6e3c3742a406d`. **Árbitro:** `GDTV2M5CAZ4E5AIXDHQARM7UUPJ4KGJVPXLU5S2D3ZVPTMETNXW6ACKQ` (centralizado). `max_advance_bps = 9000`.
- **Identidades de CLI** (`ie-admin`, `ie-arbiter`, `ie-buyer`, `ie-importer`, `ie-caja`, `ie-issuer`): están en el keystore local de la CLI y **no en el repo**.
- **Despliegue anterior** con `TESTUSD` (`CCFL2AIJNQ2O5NGXPJXZTJXYYBYIXP5SJSUKFMWEC7BEMORRRI45PXML`): queda como historial en `docs/deployments/testnet-testusd-2026-11-22.json` y no se usa más.

| Transacción de despliegue | Hash |
|---|---|
| trustline_ie-caja | `7ed270aa143c9e91b80309d86d8d7a1267b3dcbeed37e98dc751f9f8618773b3` |
| trustline_ie-buyer | `9915bf283e5210c5f61e3f4ead01b748a87532a25ed0926424668fadd4245f95` |
| trustline_ie-importer | `2214671fa07f7f7535e3e5ca5010188f7ce9f5ef525ac27ae3fa9248eb24d9da` |
| caja_buys_usdc_on_dex | `257e8ca03eb40efc17af6a8cf616828661df34d91f383cd218284f9b93e2bc7d` |
| buyer_topup_from_caja | `c501a5cfe69499fa1bcb96dbe2d834d9525179a071f32738023dc66af1d1a4fa` |
| escrow_deploy | `92b1b1998dab40bd5bd89a978603b3503dc28e88aca1934acc25f2f75ffa277a` |

### E2E a través de la API contra Testnet (`npm run e2e:testnet`, 2026-11-22T14:09:59.034Z)
Cada orden se financia con la rampa: pago BOB simulado → la caja entrega USDC real (`WALLET_FUNDED`) → el comprador firma `create_and_fund` en el cliente. El servidor solo recibe XDR firmados de los usuarios.

| Paso | Tx |
|---|---|
| FULL_ESCROW:ramp_delivery_from_caja | [`3e27777adb611fb4…`](https://stellar.expert/explorer/testnet/tx/3e27777adb611fb47e6e683098fb6f374491612db8f687394c76eed13c7fc15b) |
| full:create_and_fund | [`d4d0134d117d1fad…`](https://stellar.expert/explorer/testnet/tx/d4d0134d117d1fadc9422b2132ff78178b67eb58be68881c145330d1890a9d2d) |
| full:confirm_delivery_and_release | [`0a2ac6ea640a5916…`](https://stellar.expert/explorer/testnet/tx/0a2ac6ea640a5916fd441c091d8636a72b0024647486aa576d9c53ee84668442) |
| PARTIAL_ADVANCE:ramp_delivery_from_caja | [`94821a2f063d6c83…`](https://stellar.expert/explorer/testnet/tx/94821a2f063d6c83f4ab43e975536232abde0706c8559ba38f540bd3369070db) |
| partial:create_and_fund | [`0cad6a7eb4d8f52b…`](https://stellar.expert/explorer/testnet/tx/0cad6a7eb4d8f52b5a77596e3f603304edc094c1682bde06e7f7d1153b592d80) |
| partial:claim_advance | [`b47fdc01814d8df9…`](https://stellar.expert/explorer/testnet/tx/b47fdc01814d8df9db21cc2203135efa81cd7305026c0d3ae540d41e9807b409) |
| partial:confirm_delivery_and_release | [`a9801a1ded2cdc2c…`](https://stellar.expert/explorer/testnet/tx/a9801a1ded2cdc2cae8a3df3531c8a15b77f3d9dd2db9036b035828598c33643) |
| PARTIAL_ADVANCE:ramp_delivery_from_caja | [`4cabbdad9d951776…`](https://stellar.expert/explorer/testnet/tx/4cabbdad9d951776e1d65ea157b4522580aacead0e9763fe8dfdb05e05e2bb20) |
| dispute:create_and_fund | [`28f59bdab3ac2885…`](https://stellar.expert/explorer/testnet/tx/28f59bdab3ac288594c605407e79de0fa49d4018882ba553d27c3ebfd2ff2961) |
| dispute:claim_advance | [`927ac56475b0708a…`](https://stellar.expert/explorer/testnet/tx/927ac56475b0708a281f218748c4d9d73b841776bd720cadc3a0b0a1d492ac69) |
| dispute:open_dispute | [`fd4d69d38d51976a…`](https://stellar.expert/explorer/testnet/tx/fd4d69d38d51976ada69492004d347c1f8d9abf26e552a9758fdc6d65b0ea575) |
| dispute:resolve_dispute | [`7911055e0fb7ec6e…`](https://stellar.expert/explorer/testnet/tx/7911055e0fb7ec6e4d12cd75d5d36fb9b2b7edf5d98ba9765d15f30fa031c3cb) |

Verificado en Horizon: la entrega de la caja debita 12 USDC (emisor `GBBD47…`) de la caja y los acredita al comprador. El indexador registró 13 eventos para las 3 órdenes y no duplicó nada en la segunda pasada.

### Smoke test CLI (`scripts/testnet/smoke.sh`, 2026-11-22T14:04:57Z)
Rechazos verificados en red:
- anticipo en FULL;
- confirmación por la importadora;
- doble anticipo;
- resolución por una cuenta que no es el árbitro;
- confirmación durante una disputa;
- reembolso del total (incluiría el anticipo).

Deltas: importadora +33 USDC, comprador −33, contrato 0. Durante la corrida, un `RequestTimeout` del RPC se recuperó consultando la tx por hash.

| Paso | Tx |
|---|---|
| full:create_and_fund | `3a5111ff59971dba…` |
| full:confirm_delivery_and_release | `a85bde6c595afed5…` |
| partial:create_and_fund | `ed41daa45f55433d…` |
| partial:claim_advance | `47181264de340c82…` |
| partial:confirm_delivery_and_release | `cfa2b514e64f61d6…` |
| dispute:create_and_fund | `5aac740d926440dc…` |
| dispute:claim_advance | `4170a80d37b499f2…` |
| dispute:open_dispute | `849575250e1d02df…` |
| dispute:resolve_dispute(300->buyer) | `c4f0302d7fdd87be…` |

## Pruebas ejecutadas (2026-11-22)

| Suite | Comando | Resultado |
|---|---|---|
| Contrato Rust | `cd contracts && cargo test` | **35 passed** |
| WASM | `stellar contract build` | OK, 18.778 bytes |
| shared | `npm test -w packages/shared` | **6 passed** |
| API (unitarios + escenarios con Postgres + rampa caja) | `npm test -w apps/api` | **38 passed** |
| Tipos / build | `npm run lint`, `npm run build` | OK |
| Arranque real | `node dist/main.js` con `ESCROW_GATEWAY=soroban` | `/ready` muestra DB ok y Testnet ok; Swagger disponible |
| E2E Testnet vía API (con rampa caja) | `npm run e2e:testnet` | **OK** |

Cobertura de los tests del contrato (guía §6): FULL y PARTIAL completos; orden sin funding; cotización vencida; IDs repetidos; token incorrecto; monto cero o negativo; anticipo mayor o igual al total y sobre el tope; FULL con anticipo; intento de cambiar términos; anticipo repetido; terceros no autorizados (confirmar, anticipo, resolver); firma sobre términos distintos; disputa antes y después del anticipo; reparto exacto del retenido; overflow; reembolso total y parcial; cancelación con doble firma; replay; un retraso no libera fondos; rotación de árbitro; TTL; secuencias aleatorias con invariantes y conservación de fondos.

Rampa caja (emisor falso, `test/caja-ramp.e2e-spec.ts`):
- sin trustline no cotiza;
- una sola entrega aunque se repitan `simulate-payment` y el webhook;
- deja `WALLET_FUNDED`, nunca `ESCROW_FUNDED`;
- una entrega `PENDING` se cierra por hash sin re-pagar;
- una entrega fallida o rechazada deja la rampa y el pago en `FAILED`;
- con la caja sin fondos no cotiza;
- la validación de entorno la prohíbe en production y sin soroban.

## Decisiones de seguridad
Ver `docs/security-and-risk.md`:
- **Claves:** sin custodia de claves de usuarios. Única clave de servidor: la caja de testnet, que solo firma `transfer` desde sí misma, con tope por orden y prohibida en production.
- **Firmas:** atadas al hash de la tx preparada.
- **Funding:** `ESCROW_FUNDED` solo tras `get_order` con los términos exactos.
- **Rampa:** nunca marca funding y su entrega tiene reclamo atómico.
- **Timeouts del RPC:** se resuelven por hash, nunca reenviando.
- **Anticipo:** deshabilitado por defecto y con doble tope.
- **Consentimiento:** versionado y con hash.
- **Acceso:** anti-IDOR con respuesta 404.
- **Duplicados:** idempotencia y deduplicación de webhooks.
- **Evidencias:** privadas y verificadas.
- **Contrato:** inmutable.

## Limitaciones y pendientes externos
1. **Pollar.** El login con su wallet embebida está soportado, pero falta probarlo con una cuenta real y la UI. Su rampa BOB va por Stereum, Polygon y CCTP, y no está confirmada en Testnet. No documenta webhooks ni verificación de sesión en servidor. Detalle en `docs/pollar-integration.md`.
2. **Partes simuladas.** El pago en BOB de la rampa, el KYC y el OTP por correo están simulados (marcados `SIMULATED`). La entrega de USDC de testnet sí es real.
3. **Árbitro.** Es centralizado y no hay plazo máximo de disputa. Para producción: multisig 2-de-3.
4. **Fees.** Las paga el firmante; no hay sponsorship.
5. **Operación.** No hay endpoint de cancelación consensuada, job automático de TTL, BullMQ ni rate limiting distribuido.
6. **Entregas de rampa sin hash.** Una rampa que queda en `PROCESSING` sin hash (caída entre el reclamo y el envío) exige revisión manual.
7. **Infra no probada.** Docker Compose no se ejecutó, el almacenamiento de evidencias es solo local y no hay antivirus.
8. **Fuera de alcance** según la guía: frontend, marketplace, tarjetas, Mainnet, dinero real, cumplimiento regulatorio.
