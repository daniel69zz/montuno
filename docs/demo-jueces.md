# Recorrido para jueces (menos de 2 minutos)

Todo lo de esta página se puede verificar **sin ejecutar nada y sin JavaScript de Montuno**: son enlaces al explorador público de Stellar Testnet. El frontend web (`apps/web`) **está en construcción** y no forma parte de esta verificación.

## 1. El contrato (20 s)

| | |
|---|---|
| Contrato escrow (Soroban, propio) | [`CA3CWIHORCCANE73NITO5T2I652SGR4SOUZDMHXVQUH5T4DGX7YJQCTR`](https://stellar.expert/explorer/testnet/contract/CA3CWIHORCCANE73NITO5T2I652SGR4SOUZDMHXVQUH5T4DGX7YJQCTR) |
| Token | USDC de Circle de Testnet, SAC [`CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`](https://stellar.expert/explorer/testnet/contract/CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA) |
| Hash del WASM desplegado | `d369daf5820a9f1b44ba0bffba29389ff4ffdeea67554db442f6e3c3742a406d` |
| Desplegado | 2026-11-22T14:01:56Z · registro en [`docs/deployments/testnet.json`](deployments/testnet.json) |

## 2. Verificar en 3 clics que el escrow funcionó (60 s)

1. Abre la **[liberación del pedido FULL](https://stellar.expert/explorer/testnet/tx/0a2ac6ea640a5916fd441c091d8636a72b0024647486aa576d9c53ee84668442)**: es una invocación de `confirm_delivery_and_release` sobre el contrato `CA3CWIHO…`, firmada por el comprador.
2. En esa transacción, mira los **eventos / efectos**: el contrato transfiere 12 USDC a la importadora (`GCHEQI…`).
3. Abre la **[resolución de la disputa](https://stellar.expert/explorer/testnet/tx/7911055e0fb7ec6e4d12cd75d5d36fb9b2b7edf5d98ba9765d15f30fa031c3cb)**: el árbitro (`GDTV2M…`) devuelve al comprador **solo los 3 USDC retenidos**. Los 9 del anticipo ya se habían pagado y el contrato no puede devolverlos: es la regla de la modalidad parcial.

## 3. Todas las transacciones del E2E por la API (2026-11-22 14:09 UTC)

Cada pedido se financió con la rampa (pago en BOB **simulado**, USDC de Testnet **real** entregado por la caja). Las firmas se hicieron del lado del cliente; el servidor solo recibió XDR firmados.

| Paso | Transacción |
|---|---|
| FULL · la caja entrega 12 USDC al comprador (rampa) | [`3e27777adb61…`](https://stellar.expert/explorer/testnet/tx/3e27777adb611fb47e6e683098fb6f374491612db8f687394c76eed13c7fc15b) |
| FULL · el comprador deposita 12 USDC en el escrow | [`d4d0134d117d…`](https://stellar.expert/explorer/testnet/tx/d4d0134d117d1fadc9422b2132ff78178b67eb58be68881c145330d1890a9d2d) |
| FULL · el comprador confirma y se liberan 12 USDC | [`0a2ac6ea640a…`](https://stellar.expert/explorer/testnet/tx/0a2ac6ea640a5916fd441c091d8636a72b0024647486aa576d9c53ee84668442) |
| PARTIAL · la caja entrega 12 USDC al comprador (rampa) | [`94821a2f063d…`](https://stellar.expert/explorer/testnet/tx/94821a2f063d6c83f4ab43e975536232abde0706c8559ba38f540bd3369070db) |
| PARTIAL · depósito de 12 USDC | [`0cad6a7eb4d8…`](https://stellar.expert/explorer/testnet/tx/0cad6a7eb4d8f52b5a77596e3f603304edc094c1682bde06e7f7d1153b592d80) |
| PARTIAL · la importadora cobra el anticipo de 9 USDC | [`b47fdc01814d…`](https://stellar.expert/explorer/testnet/tx/b47fdc01814d8df9db21cc2203135efa81cd7305026c0d3ae540d41e9807b409) |
| PARTIAL · confirmación y liberación de los 3 USDC retenidos | [`a9801a1ded2c…`](https://stellar.expert/explorer/testnet/tx/a9801a1ded2cdc2cae8a3df3531c8a15b77f3d9dd2db9036b035828598c33643) |
| DISPUTA · la caja entrega 12 USDC al comprador (rampa) | [`4cabbdad9d95…`](https://stellar.expert/explorer/testnet/tx/4cabbdad9d951776e1d65ea157b4522580aacead0e9763fe8dfdb05e05e2bb20) |
| DISPUTA · depósito de 12 USDC | [`28f59bdab3ac…`](https://stellar.expert/explorer/testnet/tx/28f59bdab3ac288594c605407e79de0fa49d4018882ba553d27c3ebfd2ff2961) |
| DISPUTA · anticipo de 9 USDC | [`927ac56475b0…`](https://stellar.expert/explorer/testnet/tx/927ac56475b0708a281f218748c4d9d73b841776bd720cadc3a0b0a1d492ac69) |
| DISPUTA · el comprador abre la disputa | [`fd4d69d38d51…`](https://stellar.expert/explorer/testnet/tx/fd4d69d38d51976ada69492004d347c1f8d9abf26e552a9758fdc6d65b0ea575) |
| DISPUTA · el árbitro devuelve los 3 USDC retenidos | [`7911055e0fb7…`](https://stellar.expert/explorer/testnet/tx/7911055e0fb7ec6e4d12cd75d5d36fb9b2b7edf5d98ba9765d15f30fa031c3cb) |

## 4. Smoke test por CLI (2026-11-22 14:04 UTC)

Los mismos tres escenarios, ejecutados con la CLI de Stellar. Además se verificó en la red que se rechazan: anticipo en FULL, confirmación por la importadora, doble anticipo, resolución por quien no es árbitro, confirmación durante la disputa y reembolso del total. Saldos finales: importadora +33 USDC, comprador −33, contrato 0.

| Paso | Transacción |
|---|---|
| FULL · depósito | [`3a5111ff5997…`](https://stellar.expert/explorer/testnet/tx/3a5111ff59971dba79aff41ec1bfdab677f695bf6148bc8866167ae3a92274d4) |
| FULL · liberación | [`a85bde6c595a…`](https://stellar.expert/explorer/testnet/tx/a85bde6c595afed5bbe69f965eb6912c00b700157d3bef67c9205a11e5b968d1) |
| PARTIAL · depósito | [`ed41daa45f55…`](https://stellar.expert/explorer/testnet/tx/ed41daa45f55433deb81e5d82b9a72e97a685d9f0e5ea158bda0aa4c8ef00b6a) |
| PARTIAL · anticipo | [`47181264de34…`](https://stellar.expert/explorer/testnet/tx/47181264de340c8285bac64fc4c735c69c55740a48419f5972e5aacb87261f18) |
| PARTIAL · liberación del saldo | [`cfa2b514e64f…`](https://stellar.expert/explorer/testnet/tx/cfa2b514e64f61d6e9bce5a5e0749521affec428d015a10aad0b31e155c3c6dc) |
| DISPUTA · depósito | [`5aac740d9264…`](https://stellar.expert/explorer/testnet/tx/5aac740d926440dce09186738254919a77b62e46249c94ce3d5fa70fe82613a6) |
| DISPUTA · anticipo | [`4170a80d37b4…`](https://stellar.expert/explorer/testnet/tx/4170a80d37b499f2eec51bc3b699a60de7bc47e2ae85c0b38da268f888ae2d1b) |
| DISPUTA · apertura | [`849575250e1d…`](https://stellar.expert/explorer/testnet/tx/849575250e1d02df40062cb64e7d36be8bf8e02962b3b9af1376fe3b032e16ab) |
| DISPUTA · resolución del árbitro (devuelve el retenido) | [`c4f0302d7fdd…`](https://stellar.expert/explorer/testnet/tx/c4f0302d7fdd87bee513caafd6279dab030b99bc3aebc6222bf4c43f015962b7) |

## 5. Correrlo uno mismo (opcional)

**Local, sin red (modo DEMO, ledger simulado):**

```bash
npm install
docker compose up -d
cp .env.example apps/api/.env      # cambia SESSION_SECRET y MOCK_WEBHOOK_SECRET (openssl rand -hex 32)
npm run db:migrate
npm test                           # contrato, shared y API (incluye los escenarios de aceptación)
npm run dev                        # API en http://localhost:3000, Swagger en /docs
```

**Contra Stellar Testnet** (crea tus propias identidades de prueba y **tu propio** escrow):

```bash
./scripts/testnet/deploy.sh        # identidades ie-*, USDC de Testnet para la caja, despliegue del escrow
./scripts/testnet/smoke.sh         # FULL, PARTIAL y disputa por CLI
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/montuno?schema=public npm run e2e:testnet
```

No hay una cuenta compartida para jueces: los scripts crean cuentas de prueba nuevas con friendbot.

## 6. Guion del video (2–3 minutos)

| Tiempo | Escena | Qué se muestra | Qué se dice |
|---|---|---|---|
| 0:00–0:20 | Problema | Un chat de WhatsApp con una cotización y "págame el 100% por adelantado" | "En Bolivia se compra afuera por importadoras de WhatsApp y se paga todo antes de recibir nada." |
| 0:20–0:40 | Solución | README o la portada: enlace de checkout → escrow → confirmación | "Montuno pone el pago en un contrato en Stellar hasta que el pedido llega." |
| 0:40–1:20 | Pago protegido real | Terminal con `npm run e2e:testnet` (o el smoke test) avanzando; luego el contrato en stellar.expert | "Esto corre en Testnet: el comprador deposita 12 USDC y el contrato los retiene." |
| 1:20–1:50 | Anticipo y liberación | Las transacciones `claim_advance` y `confirm_delivery_and_release` en el explorador | "En modo parcial la importadora cobra un anticipo para comprar; el saldo se libera cuando el comprador confirma." |
| 1:50–2:20 | Disputa | `open_dispute` y `resolve_dispute` en el explorador | "Si algo sale mal, el árbitro reparte solo lo que sigue retenido. El anticipo pagado no vuelve, y se le avisa al comprador antes de pagar." |
| 2:20–2:40 | Estado honesto | Tabla "real o simulado" del README | "El escrow y el USDC de Testnet son reales; el pago en bolivianos todavía es simulado." |
| 2:40–3:00 | Cierre | Contrato y repo | "Contrato propio, probado de punta a punta y verificable por cualquiera." |

Si el frontend está listo al grabar, se puede reemplazar la escena 0:40–1:20 por el flujo en la web. Si no, no se lo debe mostrar como terminado.
