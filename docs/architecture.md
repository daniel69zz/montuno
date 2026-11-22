# Arquitectura

> Montuno: backend y contratos. El crate `import_escrow` y los prefijos `import-escrow/*/v1` de los hashes son nombres heredados que se mantienen a propósito (ver README).

## Vista general

```text
WhatsApp (externo) ─► Importadora ─► API NestJS ─► PostgreSQL (proyección, auditoría, PII)
                                        │
             Comprador (wallet propia)  │  prepare-* → XDR sin firmar
             firma en el CLIENTE ◄──────┤
             submit (XDR firmado) ─────►│──► Soroban RPC (Testnet) ─► Contrato escrow ─► SAC token de prueba
                                        │
                          Jobs: indexador de eventos + conciliación + expiración
```

| Capa | Ubicación | Responsabilidad |
|---|---|---|
| Contrato | `contracts/import_escrow` | Términos monetarios inmutables, fondos, anticipo, disputas, eventos. **Fuente de verdad financiera.** |
| API | `apps/api` | Cuentas, importadoras, cotizaciones, checkout, consentimientos, logística, evidencias, disputas off-chain, auditoría, proyección on-chain. |
| Compartido | `packages/shared` | Enums, máquinas de estado, dinero en `bigint`, hash canónico de términos, avisos de riesgo versionados. |
| Scripts | `scripts/testnet`, `apps/api/scripts` | Despliegue, smoke test CLI, E2E por API contra Testnet. |

## Decisiones

- **Un contrato, un registro por orden** (`order_id = sha256("import-escrow/order/v1:" + uuid)`, sin PII). Más barato que una instancia por orden y con una sola auditoría de código.
- **`create_and_fund` atómico.** No existe estado on-chain "creado sin fondos", así que no hay estados imposibles. El comprador autoriza los términos y la sub-invocación `token.transfer` en una sola auth.
- **Source-account auth.** El firmante es la cuenta fuente de la transacción, y `require_auth()` queda satisfecho por la firma del sobre. El servidor ata la firma a lo preparado comparando el **hash del cuerpo** de la tx (firmar no lo cambia). Cualquier XDR con otros argumentos produce otro hash y se rechaza (`TX_MISMATCH`).
- **Puertos/adaptadores** (`src/stellar/escrow-gateway.ts`, `src/integrations/ports.ts`):
  - `SorobanEscrowGateway`: real, Testnet.
  - `SimulatedEscrowGateway`: en memoria, espejo de las reglas del contrato y con firmas ed25519 reales. Uso exclusivo en dev/tests, siempre marcado `simulated=true`.
  - `MockKycProvider`, `MockRampProvider`, `MockEmailOtpIdentityProvider`: simulados.
  - `StellarWalletIdentityProvider` (SEP-53): real.
- **Proyección única.** `EscrowService.syncFromChain` es la única ruta que deriva estados monetarios, siempre desde `get_order`. La usan el submit, el indexador y la conciliación. Antes de marcar `ESCROW_FUNDED` verifica buyer, importer, arbiter, token, monto, anticipo, modo y `termsHash`. Si los términos no coinciden, la orden pasa a `FAILED`.
- **Exactamente-una-vez lógico:** `EscrowTransaction.uniqueEventKey = txHash:evento` + `createMany(skipDuplicates)`, y actualización condicional de `Order` por `updatedAt` con reintento.
- **Jobs en proceso** con `pg_try_advisory_lock`, para que haya una sola instancia por job. Cada job es un método idempotente, listo para moverse a BullMQ cuando haya Redis (no se agregó la dependencia sin poder probarla).
- **Versiones fijadas:** NestJS 11 (la 12 es solo ESM y complica Jest), Prisma 6.19, TypeScript 5.9 (la 7.x es el compilador nativo y no es compatible con ts-jest), soroban-sdk 29.0.1 y @stellar/stellar-sdk 17.4.0.

## Estructura de `apps/api/src`

`auth/` sesiones y proveedores de identidad · `users/` `/me`, wallets y KYC · `importers/` · `admin/` · `quotes/` · `checkouts/` · `orders/` acceso anti-IDOR, consultas y logística · `escrow/` prepare/submit/sync · `disputes/` · `ramps/` · `evidence/` · `storage/` URLs prefirmadas · `stellar/` gateways · `integrations/` puertos y mocks · `jobs/` · `webhooks/` · `health/` · `common/` guard, idempotencia, auditoría, errores, logger JSON.

Los módulos de dominio comparten un único `AppModule` para reducir el boilerplate en el MVP. Las carpetas ya están separadas, así que dividirlos en módulos Nest más adelante es mecánico.

## Indexación, retención y recuperación

- El RPC de Soroban solo conserva una ventana de eventos (días, no histórico infinito). El checkpoint (`IndexerCheckpoint`) guarda cursor y ledger.
- Si el cursor sale de la ventana de retención, el indexador reinicia desde el ledger más antiguo disponible.
- **La conciliación no depende de eventos:** relee `get_order` de toda orden no terminal, así que un hueco de eventos nunca deja una orden mal proyectada. Solo se pierden filas de historial `EscrowTransaction`, que pueden reconstruirse con un indexador histórico externo si hiciera falta.
- **Reindexación:** borrar el checkpoint (`DELETE FROM "IndexerCheckpoint"`) y dejar correr el job. Es idempotente.
