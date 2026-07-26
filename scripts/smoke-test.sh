#!/usr/bin/env bash
# Smoke test — Phase 7
# Verifies all endpoints respond correctly on a running facilitator instance.
# Usage: FACILITATOR_URL=http://localhost:3000 bash scripts/smoke-test.sh

set -euo pipefail

URL="${FACILITATOR_URL:-http://localhost:3000}"
PASS=0
FAIL=0

check() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if echo "$actual" | grep -q "$expected"; then
    echo "✅  $label"
    PASS=$((PASS + 1))
  else
    echo "❌  $label — expected '$expected', got: $actual"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "🔥 Smoke test — $URL"
echo ""

# GET /health
HEALTH=$(curl -sf "$URL/health")
check "GET /health → status healthy"      '"status":"healthy"'      "$HEALTH"
check "GET /health → db check present"    '"database"'              "$HEALTH"
check "GET /health → redis check present" '"redis"'                 "$HEALTH"
check "GET /health → rpc check present"   '"rpc"'                   "$HEALTH"

# GET /supported
SUPPORTED=$(curl -sf "$URL/supported")
check "GET /supported → versions"     '"versions"'    "$SUPPORTED"
check "GET /supported → networks"     '"networks"'    "$SUPPORTED"
check "GET /supported → assets"       '"assets"'      "$SUPPORTED"
check "GET /supported → base-mainnet" 'base-mainnet'  "$SUPPORTED"
check "GET /supported → USDC"         'USDC'          "$SUPPORTED"

# GET /metrics
METRICS=$(curl -sf "$URL/metrics")
check "GET /metrics → verify counter"  'facilitator_verify_total'  "$METRICS"
check "GET /metrics → settle counter"  'facilitator_settle_total'  "$METRICS"
check "GET /metrics → fee counter"     'facilitator_fee_collected' "$METRICS"

# POST /verify — missing body → 400
VERIFY_400=$(curl -sf -o /dev/null -w "%{http_code}" -X POST "$URL/verify" \
  -H 'Content-Type: application/json' -d '{}')
check "POST /verify empty body → 400" '400' "$VERIFY_400"

# POST /verify — unsupported network → rejected
VERIFY_REJ=$(curl -sf -X POST "$URL/verify" \
  -H 'Content-Type: application/json' \
  -d '{"version":"1","scheme":"exact","network":"unsupported-net","asset":"USDC","invoiceId":"smoke_01","requiredAmount":"1000000","recipient":"0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045","payload":{"signature":"0xabc","authorization":{"from":"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266","to":"0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045","value":"1000000","validAfter":0,"validBefore":9999999999,"nonce":"0x'$(openssl rand -hex 32)'"}}}')
check "POST /verify unsupported_network → error code" 'unsupported_network' "$VERIFY_REJ"

# POST /settle — unknown requestId → error
SETTLE_ERR=$(curl -sf -X POST "$URL/settle" \
  -H 'Content-Type: application/json' \
  -d '{"paymentRequestId":"smoke_nonexistent_001"}')
check "POST /settle unknown id → error code" '"code"' "$SETTLE_ERR"

# GET /receipts/:id — unknown → 404
RECEIPT_404=$(curl -sf -o /dev/null -w "%{http_code}" "$URL/receipts/smoke_nonexistent_receipt")
check "GET /receipts/:id unknown → 404" '404' "$RECEIPT_404"

echo ""
echo "—————————————————————————————"
echo "Results: $PASS passed, $FAIL failed"

if [ "$FAIL" -gt 0 ]; then
  echo "❌ Smoke test FAILED"
  exit 1
fi

echo "✅ All checks passed"
