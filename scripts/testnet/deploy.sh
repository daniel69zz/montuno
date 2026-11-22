#!/usr/bin/env bash
# Despliegue reproducible en Stellar TESTNET (nunca Mainnet).
#
# TOKEN_MODE=circle-usdc (por defecto): el escrow acepta el USDC de Circle de TESTNET
#   (USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5, SAC derivado con la CLI).
#   Una cuenta "caja" (ie-caja) compra USDC de testnet en el DEX de testnet pagando con XLM de friendbot
#   (sin faucet web) y financia al comprador de prueba. La caja es la que usa la rampa simulada de la API.
# TOKEN_MODE=testusd: activo propio de prueba TESTUSD emitido por ie-issuer (modo anterior).
#
# Las claves quedan en el keystore local de la CLI de Stellar (~/.config/stellar), jamás en el repo.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NET="testnet"
P="${IE_PREFIX:-ie}"
TOKEN_MODE="${TOKEN_MODE:-circle-usdc}"
ADMIN="$P-admin"; ARBITER="$P-arbiter"; BUYER="$P-buyer"; IMPORTER="$P-importer"; ISSUER="$P-issuer"; CAJA="$P-caja"
MAX_ADVANCE_BPS="${MAX_ADVANCE_BPS:-9000}"
CIRCLE_USDC_ISSUER="GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
CAJA_USDC_STROOPS="${CAJA_USDC_STROOPS:-3000000000}"     # 300 USDC que compra la caja
BUYER_TOPUP_STROOPS="${BUYER_TOPUP_STROOPS:-600000000}"  # 60 USDC para el smoke test por CLI
OUT="$ROOT/docs/deployments/testnet.json"
LOG="$ROOT/docs/deployments/testnet-deploy.log"
: > "$LOG"

log() { echo "[deploy] $*" | tee -a "$LOG" >&2; }
run() { local out; out="$("$@" 2> >(tee -a "$LOG" >&2))"; echo "$out" >> "$LOG"; echo "$out"; }
last_hash() { grep -oE 'Signing transaction: [0-9a-f]{64}' "$LOG" | tail -1 | awk '{print $3}'; }
TXJSON=""
addtx() { [[ -n "$TXJSON" ]] && TXJSON+=","; TXJSON+="\"$1\":\"$2\""; }

ensure_key() {
  if stellar keys address "$1" >/dev/null 2>&1; then
    log "identidad $1 existe: $(stellar keys address "$1")"
    stellar keys fund "$1" --network "$NET" >/dev/null 2>&1 || true
  else
    log "creando identidad $1"
    stellar keys generate "$1" --network "$NET" --fund >/dev/null
  fi
}
has_trustline() { # $1 address  $2 code  $3 issuer
  curl -s "https://horizon-testnet.stellar.org/accounts/$1" | python3 -c "import json,sys;d=json.load(sys.stdin);print(any(b.get('asset_code')=='$2' and b.get('asset_issuer')=='$3' for b in d.get('balances',[])))"
}
trustline() { # $1 identity $2 code $3 issuer
  local addr; addr=$(stellar keys address "$1")
  if [[ "$(has_trustline "$addr" "$2" "$3")" == "True" ]]; then log "trustline $1 -> $2 ya existe"; return; fi
  log "trustline $1 -> $2:$3"
  run stellar tx new change-trust --source "$1" --line "$2:$3" --network "$NET" >/dev/null
  addtx "trustline_$1" "$(last_hash)"
}

IDS=("$ADMIN" "$ARBITER" "$BUYER" "$IMPORTER")
[[ "$TOKEN_MODE" == "testusd" ]] && IDS+=("$ISSUER") || IDS+=("$CAJA")
for k in "${IDS[@]}"; do ensure_key "$k"; done
ADMIN_ADDR=$(stellar keys address "$ADMIN"); ARBITER_ADDR=$(stellar keys address "$ARBITER")
BUYER_ADDR=$(stellar keys address "$BUYER"); IMPORTER_ADDR=$(stellar keys address "$IMPORTER")

if [[ "$TOKEN_MODE" == "testusd" ]]; then
  ISSUER_ADDR=$(stellar keys address "$ISSUER"); CODE="TESTUSD"; ASSET="$CODE:$ISSUER_ADDR"
  TOKEN_CONTRACT_ID=$(stellar contract id asset --asset "$ASSET" --network "$NET")
  if ! stellar contract info interface --id "$TOKEN_CONTRACT_ID" --network "$NET" >/dev/null 2>&1; then
    log "desplegando SAC de $ASSET"
    run stellar contract asset deploy --asset "$ASSET" --source "$ISSUER" --network "$NET" >/dev/null
    addtx "sac_deploy" "$(last_hash)"
  fi
  for who in "$BUYER" "$IMPORTER"; do trustline "$who" "$CODE" "$ISSUER_ADDR"; done
  run stellar tx new payment --source "$ISSUER" --destination "$BUYER_ADDR" --asset "$ASSET" --amount 100000000000 --network "$NET" >/dev/null
  addtx "buyer_topup" "$(last_hash)"
  TOKEN_NOTE="Activo de prueba sin valor emitido por $ISSUER"; CAJA_JSON="null"
else
  CODE="USDC"; ASSET="$CODE:$CIRCLE_USDC_ISSUER"
  TOKEN_CONTRACT_ID=$(stellar contract id asset --asset "$ASSET" --network "$NET")
  log "USDC de Circle (testnet), SAC $TOKEN_CONTRACT_ID"
  for who in "$CAJA" "$BUYER" "$IMPORTER"; do trustline "$who" "$CODE" "$CIRCLE_USDC_ISSUER"; done
  CAJA_ADDR=$(stellar keys address "$CAJA")
  log "la caja compra $CAJA_USDC_STROOPS stroops de USDC en el DEX de testnet (pagando XLM de friendbot)"
  run stellar tx new path-payment-strict-receive --source "$CAJA" --send-asset native --send-max 80000000000 \
    --destination "$CAJA_ADDR" --dest-asset "$ASSET" --dest-amount "$CAJA_USDC_STROOPS" --network "$NET" >/dev/null
  addtx "caja_buys_usdc_on_dex" "$(last_hash)"
  log "la caja entrega $BUYER_TOPUP_STROOPS stroops de USDC al comprador (para el smoke por CLI)"
  run stellar tx new payment --source "$CAJA" --destination "$BUYER_ADDR" --asset "$ASSET" --amount "$BUYER_TOPUP_STROOPS" --network "$NET" >/dev/null
  addtx "buyer_topup_from_caja" "$(last_hash)"
  TOKEN_NOTE="USDC de Circle de TESTNET (sin valor real); obtenido en el DEX de testnet con XLM de friendbot"
  CAJA_JSON="\"$CAJA_ADDR\""
fi

log "compilando contrato"
(cd "$ROOT/contracts" && stellar contract build >/dev/null 2>>"$LOG")
WASM="$ROOT/contracts/target/wasm32v1-none/release/import_escrow.wasm"
WASM_HASH=$(shasum -a 256 "$WASM" | cut -d' ' -f1)

log "desplegando escrow (token inmutable: $TOKEN_CONTRACT_ID)"
ESCROW_ID=$(run stellar contract deploy --wasm "$WASM" --source "$ADMIN" --network "$NET" --alias "$P-escrow" -- \
  --admin "$ADMIN_ADDR" --token "$TOKEN_CONTRACT_ID" --arbiter "$ARBITER_ADDR" --max_advance_bps "$MAX_ADVANCE_BPS" | tail -1)
addtx "escrow_deploy" "$(last_hash)"
log "escrow: $ESCROW_ID"

cat > "$OUT" <<JSON
{
  "network": "testnet",
  "networkPassphrase": "Test SDF Network ; September 2015",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "tokenMode": "$TOKEN_MODE",
  "escrowContractId": "$ESCROW_ID",
  "wasmSha256": "$WASM_HASH",
  "token": { "asset": "$ASSET", "contractId": "$TOKEN_CONTRACT_ID", "decimals": 7, "note": "$TOKEN_NOTE" },
  "maxAdvanceBps": $MAX_ADVANCE_BPS,
  "accounts": { "admin": "$ADMIN_ADDR", "arbiter": "$ARBITER_ADDR", "buyer": "$BUYER_ADDR", "importer": "$IMPORTER_ADDR", "caja": $CAJA_JSON },
  "cliIdentities": { "admin": "$ADMIN", "arbiter": "$ARBITER", "buyer": "$BUYER", "importer": "$IMPORTER", "caja": "$CAJA" },
  "transactions": {$TXJSON}
}
JSON
log "registro escrito en docs/deployments/testnet.json"
cat "$OUT"
