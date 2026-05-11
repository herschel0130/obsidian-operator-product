#!/bin/bash
set -euo pipefail

AUDIO="$1"
LANG="${2:-Chinese and English mixed}"
CHUNK_SECS=1200  # 20 minutes per chunk

# Load API key from secrets (configurable via SECRETS_FILE env var)
SECRETS_FILE="${SECRETS_FILE:-$HOME/.secrets}"
[ -f "$SECRETS_FILE" ] && source "$SECRETS_FILE"

if [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "Error: GEMINI_API_KEY not set" >&2
  exit 1
fi

# Multi-model fallback. Robust by default — primary model gets retried on
# next-in-list when Gemini returns transient errors (503 UNAVAILABLE, 429
# RESOURCE_EXHAUSTED, 5xx). Override priority:
#   GEMINI_MODELS=foo,bar,baz   → exact list (full control, no implicit fallback)
#   GEMINI_MODEL=foo            → primary=foo, fallbacks=default tail (backward-compat)
#   neither                     → full default list
DEFAULT_MODELS="gemini-3.1-pro-preview,gemini-2.5-pro,gemini-2.5-flash"
if [ -n "${GEMINI_MODELS:-}" ]; then
  MODELS="$GEMINI_MODELS"
elif [ -n "${GEMINI_MODEL:-}" ]; then
  MODELS="$GEMINI_MODEL,gemini-2.5-pro,gemini-2.5-flash"
else
  MODELS="$DEFAULT_MODELS"
fi

MIME="audio/mp4"
PROMPT="Transcribe this audio recording verbatim. The language is $LANG. You MUST output in Simplified Chinese (简体中文), not Traditional Chinese. Format: use **Speaker N:** labels for different speakers. Insert timestamps like (M:SS) every 3 minutes. Output only the transcript, starting with **Transcript**. Preserve the original language exactly as spoken — do not translate English words to Chinese or vice versa."

# Get duration
DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$AUDIO" 2>/dev/null | cut -d. -f1)
if [ -z "$DURATION" ]; then
  echo "Error: Cannot read audio duration" >&2
  exit 1
fi

# Build the JSON payload for one chunk file (factored so we don't re-base64
# across model retries — base64 of a 20-min m4a chunk is ~25 MB of text).
build_payload() {
  local chunk_file="$1"
  local ts_prompt="$2"

  base64 -i "$chunk_file" | python3 -c "
import json, sys
print(json.dumps({
    'contents': [{
        'parts': [
            {'inline_data': {'mime_type': '$MIME', 'data': sys.stdin.read().strip()}},
            {'text': '''$ts_prompt'''}
        ]
    }],
    'generationConfig': {'temperature': 0.1}
}))
"
}

# Try a single (model, payload) call. Stdout = transcript text on success.
# Exit codes:
#   0  success
#   75 transient error (try next model)
#   76 fatal error (abort — auth, malformed input, etc.)
call_model() {
  local model="$1"
  local payload="$2"
  local chunk_idx="$3"

  local api_url="https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=$GEMINI_API_KEY"
  local response
  response=$(printf '%s' "$payload" | curl -sS --max-time 600 \
    -H "Content-Type: application/json" \
    -d @- \
    "$api_url" 2>&1) || {
    # curl-level failure (network, DNS, timeout). Treat as transient.
    echo "curl failed: $response" >&2
    return 75
  }

  printf '%s' "$response" | CHUNK_IDX="$chunk_idx" python3 -c "
import json, os, sys
try:
    r = json.loads(sys.stdin.read())
except json.JSONDecodeError as e:
    print(f'JSON parse error: {e}', file=sys.stderr)
    sys.exit(75)

if 'candidates' in r:
    try:
        text = r['candidates'][0]['content']['parts'][0]['text']
        if int(os.environ.get('CHUNK_IDX', '0')) > 0:
            import re
            text = re.sub(r'^\*\*Transcript\*\*\s*\n*', '', text)
        print(text)
        sys.exit(0)
    except (KeyError, IndexError):
        pass

err = r.get('error', {})
code = err.get('code', 0)
status = err.get('status', 'UNKNOWN')
msg = err.get('message', '')
print(f'API error {code} {status}: {msg}', file=sys.stderr)

# Transient set: HTTP 429/5xx + 404 (model not found — try next in fallback list)
# + Google's gRPC-style status codes.
# 401/403/400 stay fatal (auth/permission/malformed payload — won't recover by model swap).
transient_codes = {404, 429, 500, 502, 503, 504}
transient_statuses = {'UNAVAILABLE', 'RESOURCE_EXHAUSTED', 'INTERNAL', 'DEADLINE_EXCEEDED', 'ABORTED', 'NOT_FOUND'}
if code in transient_codes or status in transient_statuses:
    sys.exit(75)
sys.exit(76)
"
}

# Run one chunk through the model fallback chain.
transcribe_chunk() {
  local chunk_file="$1"
  local chunk_idx="$2"
  local offset_secs="$3"

  local offset_min=$((offset_secs / 60))
  local ts_prompt="$PROMPT Timestamps should start from approximately ${offset_min}:00 (this chunk starts at minute $offset_min of the full recording)."

  local payload
  payload=$(build_payload "$chunk_file" "$ts_prompt")

  local model rc
  IFS=',' read -ra MODEL_LIST <<< "$MODELS"
  for model in "${MODEL_LIST[@]}"; do
    # Trim leading/trailing whitespace from comma-separated tokens.
    model="$(echo -n "$model" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [ -z "$model" ] && continue

    echo "  → chunk $chunk_idx: trying $model" >&2
    # Capture rc via `|| rc=$?` rather than reading $? after `if … fi` — bash
    # resets $? after the `fi`, so the post-fi rc was always 0.
    rc=0
    call_model "$model" "$payload" "$chunk_idx" || rc=$?
    if [ "$rc" -eq 0 ]; then
      return 0
    elif [ "$rc" -eq 75 ]; then
      echo "  ⚠️  transient error from $model — falling back to next model" >&2
      continue
    fi
    echo "  ❌ fatal error from $model (rc=$rc) — aborting" >&2
    return 1
  done

  echo "Error: all models exhausted for chunk $chunk_idx" >&2
  return 1
}

if [ "$DURATION" -le "$CHUNK_SECS" ]; then
  # Short audio — single call
  transcribe_chunk "$AUDIO" 0 0
else
  # Split into chunks and transcribe sequentially
  TMPDIR=$(mktemp -d)
  trap "rm -rf $TMPDIR" EXIT

  NUM_CHUNKS=$(( (DURATION + CHUNK_SECS - 1) / CHUNK_SECS ))
  echo "Splitting into $NUM_CHUNKS chunks (~20 min each)..." >&2

  echo "**Transcript**"
  echo ""

  for ((i=0; i<NUM_CHUNKS; i++)); do
    OFFSET=$((i * CHUNK_SECS))
    CHUNK_FILE="$TMPDIR/chunk_${i}.m4a"

    ffmpeg -v error -i "$AUDIO" -ss "$OFFSET" -t "$CHUNK_SECS" -c copy "$CHUNK_FILE"

    echo "Transcribing chunk $((i+1))/$NUM_CHUNKS (offset ${OFFSET}s)..." >&2
    transcribe_chunk "$CHUNK_FILE" "$i" "$OFFSET"
    echo ""
  done
fi
