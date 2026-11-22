# Contrato escrow Soroban

Código: `contracts/import_escrow/src/lib.rs` · Tests: `contracts/import_escrow/tests/escrow.rs` (35).

## Funciones

| Función | Autoriza | Efecto |
|---|---|---|
| `__constructor(admin, token, arbiter, max_advance_bps)` | despliegue | Configuración única. El token es inmutable. `0 < bps < 10000` y `admin != arbiter`. |
| `create_and_fund(order_id, buyer, terms: OrderTerms)` | **buyer** | Valida y transfiere el 100% de forma atómica, verificando el delta real del saldo del contrato. |
| `claim_advance(order_id)` | **importer** | Solo PARTIAL, solo desde `Funded`, una vez, sin disputa. **No exige comprobante de compra.** |
| `confirm_delivery_and_release(order_id)` | **buyer** | Libera **solo** `remaining_escrow` y pasa a `Settled`. |
| `open_dispute(order_id, caller, reason_hash)` | buyer o importer | Pasa a `Disputed` y congela liberaciones y cancelaciones. |
| `resolve_dispute(order_id, refund, release, resolution_hash)` | **arbiter de la orden** | `refund + release == remaining_escrow` exacto, ambos ≥ 0. El anticipo pagado es intocable. |
| `cancel_by_agreement(order_id)` | **buyer y importer** | Devuelve el saldo retenido al comprador y pasa a `Cancelled`. |
| `get_order`, `has_order`, `get_config` | — | Lectura. |
| `extend_ttl(order_id)` | cualquiera (paga la fee) | Renueva el TTL de la orden y de la instancia sin cambiar estado. |
| `set_arbiter(new)` | admin | Solo afecta a órdenes **nuevas**; cada orden guarda su árbitro. |
| `set_admin(new)` | admin actual + nuevo | Rotación con doble firma. |

`OrderTerms { importer, arbiter, token, amount_total, advance_amount, mode, terms_hash, funding_deadline, fulfillment_deadline }`. `Mode`: `0=FullEscrow`, `1=PartialAdvance`. `Status`: `0=Funded`, `1=AdvancePaid`, `2=Disputed`, `3=Settled`, `4=Cancelled`.

**No existe:** retiro administrativo, cambio de participantes, token o anticipo de una orden, ni upgrade del WASM. El contrato es inmutable en el MVP.

## Validaciones de `create_and_fund`
ID no repetido · token == configurado · árbitro == configurado · buyer, importer y arbiter distintos entre sí y distintos del contrato · `amount_total > 0` · FULL ⇒ `advance == 0` · PARTIAL ⇒ `0 < advance < total` y `advance·10000 ≤ total·max_advance_bps` (sin división ni redondeo) · `now ≤ funding_deadline` · `fulfillment_deadline > now` y `≥ funding_deadline`.

El `fulfillment_deadline` **no** libera nada automáticamente; un retraso solo justifica abrir una disputa (está cubierto por un test).

## Invariantes (verificados antes de cada escritura)
`amount_total == seller_released + buyer_refunded + remaining_escrow`, sin negativos y con `advance_released ≤ advance_amount`. Todas las sumas usan `checked_*` y el perfil release compila con `overflow-checks = true`. Un test de secuencias aleatorias (25 semillas × 60 operaciones) comprueba además la conservación global de fondos y que `saldo del contrato == Σ remaining_escrow`.

## Errores (`#[contracterror]`)
1 OrderExists · 2 OrderNotFound · 3 TokenNotAllowed · 4 ArbiterNotAllowed · 5 InvalidAmount · 6 InvalidAdvance · 7 ModeMismatch · 8 FundingDeadlinePassed · 9 InvalidDeadline · 10 InvalidParticipants · 11 InvalidState · 12 AdvanceNotAllowed · 13 AdvanceAlreadyClaimed · 14 NotParticipant · 15 InvalidResolution · 16 DisputeActive · 17 TransferMismatch · 18 Overflow · 19 InvalidConfig · 20 InvariantViolated

## Eventos (`#[contractevent]`, topic[0] = nombre, topic[1] = order_id)
`escrow_created`, `funded`, `advance_released`, `delivery_confirmed`, `dispute_opened`, `dispute_resolved`, `refunded`, `cancelled`, `arbiter_changed`, `admin_changed`. El hash de la transacción se obtiene al indexar (`EventResponse.txHash`).

## TTL / almacenamiento
- Las órdenes viven en storage **persistent**. Cada escritura extiende el TTL a 120 días si queda por debajo de 30; la configuración (instance) se extiende a 30 días si baja de 7. Ambos valores se acotan a `max_ttl` de la red.
- `extend_ttl(order_id)` permite renovar órdenes inactivas largas. Es permisionless y está cubierto por un test.
- Si una entrada persistente llegara a archivarse, el RPC la restaura automáticamente en la simulación (los datos persistentes no se borran). El operador también puede ejecutar `stellar contract extend` o `stellar contract restore` con la key correspondiente.
- **Recomendación operativa:** un job semanal que llame a `extend_ttl` para las órdenes abiertas de más de 60 días. No está automatizado en el MVP.

## Despliegue y revalidación (Testnet)
```bash
./scripts/testnet/deploy.sh     # identidades ie-*, trustlines al USDC de Circle (testnet), caja que compra USDC en el DEX,
                                # escrow con token = SAC del USDC de Circle -> docs/deployments/testnet.json
TOKEN_MODE=testusd ./scripts/testnet/deploy.sh   # alternativa: activo propio TESTUSD
./scripts/testnet/smoke.sh      # FULL, PARTIAL, disputa tras anticipo vía CLI -> testnet-smoke.json
stellar contract invoke --id <ESCROW> --source ie-buyer --network testnet --send=no -- get_config
shasum -a 256 contracts/target/wasm32v1-none/release/import_escrow.wasm   # debe igualar wasmSha256
```

## Centralización (a resolver antes de producción)
- Hay un solo árbitro, controlado por la plataforma, que puede decidir el reparto del saldo retenido de una disputa. **No puede tocar** fondos fuera de disputa ni el anticipo ya pagado.
- Si el árbitro no responde, los fondos de una orden en disputa quedan bloqueados, porque `cancel_by_agreement` está deshabilitado durante la disputa.
- Para producción: árbitro multisig 2-de-3 (cuenta Stellar con umbrales o una cuenta de contrato) y un plazo máximo de resolución con salida pactada.
