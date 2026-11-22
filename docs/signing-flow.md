# Flujo de firma para la futura UI

El backend **nunca** recibe ni custodia claves privadas o seeds. Todas las acciones on-chain siguen este patrón:

```text
UI ──POST /orders/:id/<acción>/prepare*──► API valida reglas de negocio + estado on-chain
                                            construye la tx Soroban y la simula (prepareTransaction)
UI ◄── { preparedId, unsignedXdr, txHash, signer, networkPassphrase, fees, args } ──┘
UI muestra args legibles → la WALLET del firmante firma el sobre (source account)
UI ──POST /orders/:id/escrow/submit { preparedId, signedXdr }──► API verifica:
     · hash(tx) == txHash preparado  (mismos argumentos exactos; si no: TX_MISMATCH)
     · firma válida de la cuenta fuente esperada
     · el usuario autenticado es quien preparó la acción
   ──► sendTransaction + pollTransaction ──► get_order ──► proyección en BD
```

| Acción | Endpoint prepare | Firmante (fuente y paga fees) |
|---|---|---|
| Financiar | `POST /orders/:id/escrow/prepare-funding` | comprador |
| Anticipo | `POST /orders/:id/advance/prepare` | importadora |
| Confirmar entrega | `POST /orders/:id/delivery/prepare-confirmation` | comprador |
| Abrir disputa | `POST /orders/:id/disputes` (incluye `prepared`) | quien abre |
| Resolver | `POST /orders/:id/disputes/:id/prepare-resolution` | árbitro de la orden |

- **Fees:** las paga la cuenta firmante (`fees.payer`, `fees.maxFeeStroops`). No hay sponsorship en el MVP; una fee-bump de la plataforma es una extensión futura que no cambia el hash interno.
- **Vigencia:** el XDR expira según `expiresAt` (time bounds de 5 min). Al preparar de nuevo se invalida la preparación anterior de la misma acción.
- **Reintentos:** `submit` es idempotente. Una tx ya confirmada devuelve el mismo resultado y, si la red respondió `PENDING`, la conciliación la resuelve sin reenviar.
- **Dos pasos de dinero:** la rampa (fiat → token en la wallet) y `create_and_fund` (wallet → contrato) son transacciones separadas, y la UI debe mostrarlas así.

## Firmar en el cliente
```ts
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
const tx = TransactionBuilder.fromXDR(prepared.unsignedXdr, prepared.networkPassphrase);
tx.sign(keypair);            // o la wallet del usuario (Freighter, Pollar, etc.)
const signedXdr = tx.toXDR();
```
Prueba de posesión de wallet: `POST /me/wallets/challenge` devuelve un `message`, que el cliente firma con SEP-53. Con la CLI es `stellar message sign "<message>" --sign-with-key <id>` y en Pollar `client.stellar.sep53.signMessage(message)`, según su README. Luego se envía `POST /me/wallets/verify`.

## Con Pollar (pendiente de validar con credenciales)
Su README documenta `client.signTx(unsignedXdr)` y `client.signAuthEntry(entryXdr, { validUntilLedger })`. No se verificó si una wallet embebida de Pollar firma una invocación Soroban arbitraria de nuestro contrato. El README menciona además una allowlist de contrato y función del lado de Pollar para las wallets embebidas, así que **probablemente haya que registrar el contrato en Pollar**. Las smart wallets (passkey) **no** pueden firmar auth entries según el README, y ese modo no sería compatible con `require_auth` vía auth entry. Ver `pollar-integration.md`.
