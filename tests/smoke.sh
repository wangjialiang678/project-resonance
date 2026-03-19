#!/usr/bin/env bash
# Layer 0: Smoke Test — 每次部署后必跑
#
# 用法:
#   ./tests/smoke.sh                    # 测线上 production
#   ./tests/smoke.sh http://localhost:8080  # 测本地 dev server
#   ./tests/smoke.sh https://xxxx.project-resonance.pages.dev  # 测 preview
#
# 退出码: 0=全部通过, 1=有失败

set -euo pipefail

BASE="${1:-https://project-resonance.pages.dev}"
TOKEN="${VITE_APP_TOKEN:-resonance-2026}"
PASS=0
FAIL=0
RESULTS=()

# 生成一个 1 秒静音 WAV 用于 ASR 测试
WAV_FILE="/tmp/smoke-test-asr.wav"
python3 -c "
import wave, struct
f = wave.open('$WAV_FILE', 'w')
f.setnchannels(1); f.setsampwidth(2); f.setframerate(16000)
f.writeframes(b'\x00\x00' * 16000)
f.close()
" 2>/dev/null

record() {
  local name="$1" passed="$2" detail="${3:-}"
  if [ "$passed" = "1" ]; then
    RESULTS+=("[PASS] $name${detail:+ — $detail}")
    ((PASS++))
  else
    RESULTS+=("[FAIL] $name${detail:+ — $detail}")
    ((FAIL++))
  fi
}

echo "=========================================="
echo "  Smoke Test: $BASE"
echo "=========================================="
echo ""

# --- S0: 前端页面加载 ---
echo "--- S0: Frontend ---"

HTTP_CODE=$(curl -s -o /tmp/smoke-body.html -w "%{http_code}" "$BASE/" 2>/dev/null || echo "000")
BODY=$(cat /tmp/smoke-body.html 2>/dev/null || echo "")
HAS_TITLE=$(echo "$BODY" | grep -c "共鸣\|Project Resonance\|resonance" || true)

record "S0-1: Frontend loads (GET /)" \
  "$([ "$HTTP_CODE" = "200" ] && echo 1 || echo 0)" \
  "HTTP $HTTP_CODE"

record "S0-2: Frontend contains app content" \
  "$([ "$HAS_TITLE" -gt 0 ] && echo 1 || echo 0)" \
  "$([ "$HAS_TITLE" -gt 0 ] && echo 'Found app marker' || echo 'No app content in HTML')"

# Check no middleware/auth blocking static assets
JS_FILES=$(echo "$BODY" | grep -oE 'src="[^"]*\.js"' | head -1 | sed 's/src="//;s/"//')
if [ -n "$JS_FILES" ]; then
  JS_URL="$BASE$JS_FILES"
  JS_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$JS_URL" 2>/dev/null || echo "000")
  record "S0-3: JS assets loadable" "$([ "$JS_CODE" = "200" ] && echo 1 || echo 0)" "HTTP $JS_CODE for $JS_FILES"
else
  record "S0-3: JS assets loadable" "0" "No JS file found in HTML"
fi

echo ""

# --- S1: ASR API ---
echo "--- S1: ASR API ---"

ASR_CODE=$(curl -s -o /tmp/smoke-asr.json -w "%{http_code}" \
  "$BASE/dashscope-asr" \
  -X POST \
  -H "X-App-Token: $TOKEN" \
  -F "file=@$WAV_FILE;type=audio/wav" \
  2>/dev/null || echo "000")
ASR_BODY=$(cat /tmp/smoke-asr.json 2>/dev/null || echo "")

record "S1-1: ASR endpoint responds" \
  "$([ "$ASR_CODE" = "200" ] && echo 1 || echo 0)" \
  "HTTP $ASR_CODE"

HAS_TEXT=$(echo "$ASR_BODY" | grep -c '"text"' || true)
record "S1-2: ASR returns text field" \
  "$([ "$HAS_TEXT" -gt 0 ] && echo 1 || echo 0)" \
  "$ASR_BODY"

echo ""

# --- S2: TTS API ---
echo "--- S2: TTS API ---"

TTS_CODE=$(curl -s -o /tmp/smoke-tts.mp3 -w "%{http_code}" \
  "$BASE/cosyvoice-tts" \
  -X POST \
  -H "X-App-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"你好"}' \
  2>/dev/null || echo "000")
TTS_SIZE=$(wc -c < /tmp/smoke-tts.mp3 2>/dev/null | tr -d ' ' || echo "0")

record "S2-1: TTS endpoint responds" \
  "$([ "$TTS_CODE" = "200" ] && echo 1 || echo 0)" \
  "HTTP $TTS_CODE"

record "S2-2: TTS returns audio >1KB" \
  "$([ "$TTS_SIZE" -gt 1024 ] && echo 1 || echo 0)" \
  "${TTS_SIZE} bytes"

echo ""

# --- S3: Auth 验证 ---
echo "--- S3: Auth ---"

NO_TOKEN_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BASE/dashscope-asr" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{}' \
  2>/dev/null || echo "000")

record "S3-1: API rejects request without token" \
  "$([ "$NO_TOKEN_CODE" = "403" ] && echo 1 || echo 0)" \
  "HTTP $NO_TOKEN_CODE (expect 403)"

# CORS preflight
OPTIONS_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BASE/dashscope-asr" \
  -X OPTIONS \
  -H "Origin: https://project-resonance.pages.dev" \
  -H "Access-Control-Request-Method: POST" \
  2>/dev/null || echo "000")

record "S3-2: CORS preflight works" \
  "$([ "$OPTIONS_CODE" = "204" ] && echo 1 || echo 0)" \
  "HTTP $OPTIONS_CODE (expect 204)"

echo ""

# --- Summary ---
echo "=========================================="
echo "  Results: $PASS passed, $FAIL failed"
echo "=========================================="
for r in "${RESULTS[@]}"; do
  echo "  $r"
done

# Cleanup
rm -f /tmp/smoke-body.html /tmp/smoke-asr.json /tmp/smoke-tts.mp3 "$WAV_FILE"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "SMOKE TEST FAILED"
  exit 1
else
  echo ""
  echo "ALL SMOKE TESTS PASSED"
  exit 0
fi
