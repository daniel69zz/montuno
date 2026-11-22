#!/usr/bin/env bash
# Smoke test en TESTNET contra el contrato desplegado (docs/deployments/testnet.json).
# Escenarios: FULL (fund -> confirm), PARTIAL (fund -> advance -> confirm), disputa tras anticipo.
# Cada invocación se firma con la identidad de CLI correspondiente (firma real ed25519).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEP="$ROOT/docs/deployments/testnet.json"
OUT="$ROOT/docs/deployments/testnet-smoke.json"
LOG="$ROOT/docs/deployments/testnet-smoke.log"; : > "$LOG"
j() { python3 -c "import json,sys;d=json.load(open('$DEP'));print(eval('d'+sys.argv[1]))" "$1"; }
NET=testnet
ESCROW=$(j '["escrowContractId"]'); TOKEN=$(j '["token"]["contractId"]')
B=$(j '["cliIdentities"]["buyer"]'); I=$(j '["cliIdentities"]["importer"]'); A=$(j '["cliIdentities"]["arbiter"]')
BA=$(j '["accounts"]["buyer"]'); IA=$(j '["accounts"]["importer"]'); AA=$(j '["accounts"]["arbiter"]')
UNIT=10000000
# Montos pequeños: el USDC de testnet viene de la caja (ver deploy.sh).
TOTAL=$((12*UNIT)); ADV=$((9*UNIT)); REM=$((3*UNIT))
NOW=$(date +%s)
RESULTS=""
rid() { openssl rand -hex 32; }
tx_status() { # espera hasta ~60 s a que la tx $1 quede SUCCESS
  for _ in $(seq 1 20); do
    st=$(curl -s -X POST https://soroban-testnet.stellar.org -H 'content-type: application/json' \
      -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getTransaction\",\"params\":{\"hash\":\"$1\"}}" | python3 -c "import json,sys;print(json.load(sys.stdin)['result']['status'])")
    [[ "$st" == "SUCCESS" ]] && return 0
    [[ "$st" == "FAILED" ]] && return 1
    sleep 3
  done; return 1
}
inv() { # $1=label $2=source ; resto = args de la función
  local label=$1 src=$2; shift 2
  echo "[smoke] $label" >&2
  local out before h
  before=$(grep -c 'Signing transaction:' "$LOG" || true)
  if ! out=$(stellar contract invoke --id "$ESCROW" --source "$src" --network $NET --send=yes -- "$@" 2> >(tee -a "$LOG" >&2)); then
    # El RPC de testnet a veces corta por timeout después de recibir la tx: se consulta su estado real.
    [[ $(grep -c 'Signing transaction:' "$LOG" || true) -gt $before ]] || { echo "[smoke] FALLO: $label" >&2; exit 1; }
    h=$(grep -oE 'Signing transaction: [0-9a-f]{64}' "$LOG" | tail -1 | awk '{print $3}')
    tx_status "$h" || { echo "[smoke] FALLO: $label ($h)" >&2; exit 1; }
    echo "[smoke] (timeout del RPC; la tx $h quedó SUCCESS)" >&2
  fi
  h=$(grep -oE 'Signing transaction: [0-9a-f]{64}' "$LOG" | tail -1 | awk '{print $3}')
  [[ -n "$RESULTS" ]] && RESULTS+=","
  RESULTS+="{\"step\":\"$label\",\"tx\":\"$h\"}"
  echo "$out"
}
expect_fail() { # $1=label ; resto = comando invoke
  local label=$1 src=$2; shift 2
  if stellar contract invoke --id "$ESCROW" --source "$src" --network $NET --send=yes -- "$@" >/dev/null 2>>"$LOG"; then
    echo "[smoke] FALLO: '$label' debería haber sido rechazado" >&2; exit 1
  fi
  echo "[smoke] ok (rechazado como se esperaba): $label" >&2
}
terms() { # $1 mode $2 advance
  echo "{\"importer\":\"$IA\",\"arbiter\":\"$AA\",\"token\":\"$TOKEN\",\"amount_total\":\"$TOTAL\",\"advance_amount\":\"$2\",\"mode\":$1,\"terms_hash\":\"$(rid)\",\"funding_deadline\":$((NOW+3600)),\"fulfillment_deadline\":$((NOW+86400*30))}"
}
bal() { stellar contract invoke --id "$TOKEN" --source "$B" --network $NET --send=no -- balance --id "$1" 2>/dev/null | tr -d '"'; }

E0=$(bal "$ESCROW"); I0=$(bal "$IA"); B0=$(bal "$BA")

# --- Escenario 1: FULL
O1=$(rid)
inv "full:create_and_fund" "$B" create_and_fund --order_id "$O1" --buyer "$BA" --terms "$(terms 0 0)" >/dev/null
expect_fail "full:claim_advance" "$I" claim_advance --order_id "$O1"
expect_fail "full:confirm por importadora" "$I" confirm_delivery_and_release --order_id "$O1"
inv "full:confirm_delivery_and_release" "$B" confirm_delivery_and_release --order_id "$O1" >/dev/null

# --- Escenario 2: PARTIAL
O2=$(rid)
inv "partial:create_and_fund" "$B" create_and_fund --order_id "$O2" --buyer "$BA" --terms "$(terms 1 $ADV)" >/dev/null
inv "partial:claim_advance" "$I" claim_advance --order_id "$O2" >/dev/null
expect_fail "partial:claim_advance x2" "$I" claim_advance --order_id "$O2"
inv "partial:confirm_delivery_and_release" "$B" confirm_delivery_and_release --order_id "$O2" >/dev/null

# --- Escenario 3: incumplimiento tras anticipo
O3=$(rid)
inv "dispute:create_and_fund" "$B" create_and_fund --order_id "$O3" --buyer "$BA" --terms "$(terms 1 $ADV)" >/dev/null
inv "dispute:claim_advance" "$I" claim_advance --order_id "$O3" >/dev/null
inv "dispute:open_dispute" "$B" open_dispute --order_id "$O3" --caller "$BA" --reason_hash "$(rid)" >/dev/null
expect_fail "dispute:resolve por no-árbitro" "$B" resolve_dispute --order_id "$O3" --refund_to_buyer "$REM" --release_to_importer 0 --resolution_hash "$(rid)"
expect_fail "dispute:confirm durante disputa" "$B" confirm_delivery_and_release --order_id "$O3"
expect_fail "dispute:reembolso del total (incluye anticipo)" "$A" resolve_dispute --order_id "$O3" --refund_to_buyer "$TOTAL" --release_to_importer 0 --resolution_hash "$(rid)"
inv "dispute:resolve_dispute(retenido->buyer)" "$A" resolve_dispute --order_id "$O3" --refund_to_buyer "$REM" --release_to_importer 0 --resolution_hash "$(rid)" >/dev/null
FINAL=$(stellar contract invoke --id "$ESCROW" --source "$B" --network $NET --send=no -- get_order --order_id "$O3" 2>/dev/null)

E1=$(bal "$ESCROW"); I1=$(bal "$IA"); B1=$(bal "$BA")
DI=$((I1-I0)); DB=$((B1-B0)); DE=$((E1-E0))
EXP_I=$((TOTAL+TOTAL+ADV)); EXP_B=$((-TOTAL*3+REM))
[[ $DI -eq $EXP_I && $DB -eq $EXP_B && $DE -eq 0 ]] || { echo "[smoke] FALLO de saldos: dI=$DI dB=$DB dE=$DE" >&2; exit 1; }
cat > "$OUT" <<JSON
{
  "ranAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "escrowContractId": "$ESCROW",
  "orders": { "full": "$O1", "partial": "$O2", "disputeAfterAdvance": "$O3" },
  "balanceDeltas": { "importer": $DI, "buyer": $DB, "escrow": $DE },
  "disputeOrderFinal": $FINAL,
  "steps": [$RESULTS]
}
JSON
echo "[smoke] OK. Resultados en docs/deployments/testnet-smoke.json" >&2
