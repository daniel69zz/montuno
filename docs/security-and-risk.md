# Seguridad, privacidad y modelo de riesgo

## Riesgo económico por modalidad
| | FULL_ESCROW | PARTIAL_ADVANCE |
|---|---|---|
| Comprador deposita | 100% | 100% |
| Liberación anticipada | nunca | anticipo fijo, una vez, **antes de comprar** |
| Máximo recuperable si la importadora incumple | 100% del saldo retenido | **solo el saldo retenido**; el anticipo pagado NO es recuperable on-chain |
| Exposición del comprador | arbitraje centralizado | arbitraje + `advance_amount` |

- **Mitigaciones:** el anticipo está deshabilitado por defecto (`maxAdvanceBps=0`, modo solo FULL) hasta la aprobación manual. Hay tope por importadora, tope global del contrato (`max_advance_bps=9000`), límite por orden y un aviso de riesgo versionado `partial/v1`. El comprador acepta el texto exacto, que se guarda con su hash, timestamp y `termsHash` (`ConsentRecord`).
- La API expone `maxRecoverableByBuyerAtomic = remaining_escrow` y `protection.note`, que dice explícitamente que el anticipo no está en el escrow. **Nunca promete un reembolso ficticio del 100%.**
- El contrato no verifica entregas: el tracking y las fotos son evidencia off-chain, y la decisión es del comprador o del árbitro.

## Controles implementados
- **Claves:** el servidor no custodia claves de usuarios, solo recibe XDR firmados. **Única excepción:** con `RAMP_PROVIDER=caja-testnet`, la API tiene la clave de su propia caja de Testnet y solo firma `transfer` del USDC desde esa caja hacia la wallet del comprador, con tope por orden. Está prohibida en `production` y fuera de Testnet, igual que en WorkVille. Hay un logger con redacción de campos (`secret|token|signature|xdr|otp|...`).
- **Firmas atadas a los argumentos:** se compara el hash de la tx preparada contra la enviada y se verifica la firma de la cuenta fuente esperada. On-chain, `require_auth()` cubre los argumentos exactos (está probado: una firma sobre otros términos falla).
- **Autenticación:** sesión propia JWT HS256 corta (aud/iss). Los roles se recalculan desde la BD en cada request, sin confiar en los claims.
  - **OTP:** hash, 10 min, 5 intentos y consumo atómico.
  - **SEP-53:** desafío con dominio, propósito, red, nonce y expiración, de un solo uso.
- **Anti-IDOR:** `OrderAccessService` responde 404 a quien no es participante. El checkout público está sanitizado (sin wallets, emails, teléfonos ni evidencias). El árbitro requiere rol `ARBITER` **y** una wallet verificada igual a la registrada on-chain.
- **Carreras:** hay updates condicionales (`updateMany where status/version`) en checkout, publish, logística, submit y proyección, y un índice único en `Order.quoteId`. Además el contrato rechaza IDs duplicados.
- **Idempotencia** con `Idempotency-Key` en los mutadores relevantes: una clave reutilizada con otro cuerpo devuelve 422 y una solicitud en curso devuelve 409. Los webhooks se deduplican por `eventId` (`WebhookReceipt`).
- **Validación de entrada:** DTOs con `class-validator` (`whitelist` + `forbidNonWhitelisted`), env con zod (Mainnet y mocks quedan rechazados en `production`), Helmet, CORS restrictivo, throttling global y uno más estricto en `/auth`, y límite de 100 KB para JSON.
- **Evidencias:** almacenamiento privado, nombres aleatorios y URLs prefirmadas HMAC con expiración. Se verifica tamaño, SHA-256 declarado y MIME real por magic bytes, y las descargas van con `attachment` + `nosniff`.
- **SSRF:** la URL de producto solo se valida (https y dominio público) y nunca se descarga.
- **Fechas:** todo en UTC (BD y contrato en segundos Unix).
- **Auditoría:** `AuditLog` con before/after sanitizado y `correlationId`.

## Pendientes de seguridad antes de producción
- Árbitro multisig y plazo máximo de disputa (riesgo de bloqueo por árbitro inactivo).
- Revisión legal y regulatoria en Bolivia; KYB formal de importadoras.
- Auditoría externa del contrato.
- Antivirus en evidencias.
- Almacenamiento S3 real con políticas de retención y borrado.
- Rotación de `SESSION_SECRET`.
- Revocación de sesiones (hoy el JWT dura 1 h).
- Rate limiting distribuido (Redis).
