# Máquinas de estado

Los estados son **independientes** y se modifican solo desde servicios de dominio. No hay `PATCH status` genérico. Definiciones en `packages/shared/src/state-machines.ts`.

## Cotización (`Quote.status`)
```
DRAFT ──publish──► SENT ──accept──► ACCEPTED
  │                 │                  └─(cotización/FX vence antes del depósito)─► EXPIRED
  └─cancel─► CANCELLED   └─vence─► EXPIRED / cancel ─► CANCELLED
```
- Solo `DRAFT` se edita, con control optimista `expectedVersion`. `publish` congela términos y calcula `termsHash`.
- Cambiar condiciones = **nueva cotización y nueva aceptación**.

## Pago (`Order.paymentState`)
```
NOT_STARTED ─ramp/start─► RAMP_PENDING ─webhook OK─► WALLET_FUNDED
     │                         └─webhook FAIL─► FAILED
     └───────────── prepare-funding ──────────────► ESCROW_PENDING ─submit + get_order verificado─► ESCROW_FUNDED
                                                          └─tx falla / términos on-chain distintos─► FAILED (reintentable)
ESCROW_FUNDED ─resolución con reembolso total─► REFUNDED | parcial ─► PARTIALLY_REFUNDED
```
**Nunca** se pasa a `ESCROW_FUNDED` por una rampa, un webhook, un hash declarado por el cliente o un saldo en wallet. Solo cuenta `get_order` en el contrato configurado y con los términos exactos.

Rampa (`RampTransaction.status`): `QUOTED → PENDING → PROCESSING → COMPLETED | FAILED` (o `EXPIRED`).
- `PROCESSING` es el reclamo atómico antes de entregar tokens: un segundo webhook o un reintento nunca pagan dos veces.
- Si la entrega queda sin respuesta, la conciliación la cierra por `deliveryTxHash`.
- Si se cae justo entre el reclamo y el envío, la rampa queda para revisión manual y no se re-paga.

La rampa y el contrato son **dos transacciones distintas**. Si la rampa termina bien y el depósito no, la orden queda en `WALLET_FUNDED` o `ESCROW_PENDING`, y el comprador reintenta `prepare-funding`.

## Logística (`Order.logisticState`)
`NOT_PURCHASED → PURCHASED → IN_TRANSIT → ARRIVED_BOLIVIA → READY_FOR_DELIVERY → DELIVERED → ACCEPTED`
- La importadora solo avanza (puede saltar etapas) y únicamente con la orden `ESCROW_FUNDED` y abierta on-chain.
- `ACCEPTED` solo se alcanza por `confirm_delivery_and_release` confirmado on-chain.
- El tracking **no** es prueba de entrega.

## Disputa (`Order.disputeState`)
`NONE → OPEN → UNDER_REVIEW → RESOLVED` (también puede ir de `OPEN` directo a `RESOLVED`).
- `OPEN` se fija cuando el contrato está en `Disputed`.
- `UNDER_REVIEW` lo marca el árbitro asignado.
- `RESOLVED` llega cuando el contrato liquida con `resolution_hash`.

## Contrato (`Status` en Rust, `OnchainStatus` en la API)
```
(no existe) ─create_and_fund─► FUNDED ─claim_advance (solo PARTIAL, 1 vez)─► ADVANCE_PAID
FUNDED | ADVANCE_PAID ─confirm_delivery_and_release─► SETTLED
FUNDED | ADVANCE_PAID ─open_dispute─► DISPUTED ─resolve_dispute─► SETTLED
FUNDED | ADVANCE_PAID ─cancel_by_agreement (ambas firmas)─► CANCELLED
```
`SETTLED` y `CANCELLED` son terminales y tienen `remaining_escrow = 0`.

## Estado resumido para la UI
`summary.code` en `GET /orders/:id`: `AWAITING_PAYMENT`, `RAMP_PENDING`, `WALLET_FUNDED`, `AWAITING_ESCROW_FUNDING`, `FUNDED_AWAITING_PURCHASE`, `ADVANCE_PAID_AWAITING_PURCHASE`, `LOGISTICS_*`, `IN_DISPUTE`, `COMPLETED`, `RESOLVED`, `CANCELLED`, `PAYMENT_FAILED`.
