#!/usr/bin/env bash
# =============================================================================
# DataRefinery API - Curl Test Commands
# =============================================================================
# Usage:
#   1. Sửa BASE_URL / TENANT_ID / API_KEY cho phù hợp môi trường
#   2. chmod +x .claude/test-curl.sh && source .claude/test-curl.sh
#   3. Gọi từng function: test_platform, test_device, ...
#   Hoặc: source .claude/test-curl.sh && test_all
# =============================================================================

BASE_URL="${BASE_URL:-http://localhost:5001}"
TENANT_ID="${TENANT_ID:-tenant-001}"
API_KEY="${API_KEY:-dev-internal-api-key}"

# Common headers
AUTH_H=(-H "x-tenant-id: ${TENANT_ID}" -H "x-internal-api-key: ${API_KEY}")
JSON_H=(-H "Content-Type: application/json")

# =============================================================================
# Metrics API (GET)
# =============================================================================

# --- Platform Metrics ---
test_platform() {
  echo "=== GET /metrics/platform ==="
  curl -s "${BASE_URL}/metrics/platform?matchId=000000000000000000000000&from=2024-01-01T00:00:00Z&to=2024-01-02T00:00:00Z" \
    "${AUTH_H[@]}" | jq .
}

test_platform_with_timelines() {
  echo "=== GET /metrics/platform (with timelineIds) ==="
  curl -s "${BASE_URL}/metrics/platform?matchId=000000000000000000000000&timelineIds=timeline-001&timelineIds=timeline-002&from=2024-01-01T00:00:00Z&to=2024-01-02T00:00:00Z" \
    "${AUTH_H[@]}" | jq .
}

# --- Device Breakdown ---
test_device() {
  echo "=== GET /metrics/device ==="
  curl -s "${BASE_URL}/metrics/device?matchId=000000000000000000000000&from=2024-01-01T00:00:00Z&to=2024-01-02T00:00:00Z" \
    "${AUTH_H[@]}" | jq .
}

# --- Transport Comparison ---
test_transport() {
  echo "=== GET /metrics/transport ==="
  curl -s "${BASE_URL}/metrics/transport?matchId=000000000000000000000000&from=2024-01-01T00:00:00Z&to=2024-01-02T00:00:00Z" \
    "${AUTH_H[@]}" | jq .
}

# --- SDK Version ---
test_sdk() {
  echo "=== GET /metrics/sdk ==="
  curl -s "${BASE_URL}/metrics/sdk?matchId=000000000000000000000000&from=2024-01-01T00:00:00Z&to=2024-01-02T00:00:00Z" \
    "${AUTH_H[@]}" | jq .
}

# --- Failure Analysis ---
test_failures() {
  echo "=== GET /metrics/failures ==="
  curl -s "${BASE_URL}/metrics/failures?matchId=000000000000000000000000&from=2024-01-01T00:00:00Z&to=2024-01-02T00:00:00Z" \
    "${AUTH_H[@]}" | jq .
}

# --- Latency Percentiles ---
test_latency() {
  echo "=== GET /metrics/latency ==="
  curl -s "${BASE_URL}/metrics/latency?matchId=000000000000000000000000&from=2024-01-01T00:00:00Z&to=2024-01-02T00:00:00Z" \
    "${AUTH_H[@]}" | jq .
}

# --- Timeseries ---
test_timeseries() {
  echo "=== GET /metrics/timeseries (all metrics) ==="
  curl -s "${BASE_URL}/metrics/timeseries?matchId=000000000000000000000000&from=2024-01-01T00:00:00Z&to=2024-01-02T00:00:00Z" \
    "${AUTH_H[@]}" | jq .
}

test_timeseries_filtered() {
  echo "=== GET /metrics/timeseries?metric=sent ==="
  curl -s "${BASE_URL}/metrics/timeseries?matchId=000000000000000000000000&metric=sent&from=2024-01-01T00:00:00Z&to=2024-01-02T00:00:00Z" \
    "${AUTH_H[@]}" | jq .
}

# =============================================================================
# Metrics API (POST / PATCH)
# =============================================================================

# --- Backfill ---
test_backfill() {
  echo "=== POST /metrics/backfill ==="
  curl -s -X POST "${BASE_URL}/metrics/backfill" \
    "${AUTH_H[@]}" "${JSON_H[@]}" \
    -d '{
      "tenantId": "'"${TENANT_ID}"'",
      "matchId": "000000000000000000000000",
      "timelineIds": ["timeline-001", "timeline-002"],
      "intervalFrom": "2024-01-01T00:00:00Z",
      "intervalTo": "2024-01-01T01:00:00Z",
      "timeRangeMinutes": 5
    }' | jq .
}

test_backfill_minimal() {
  echo "=== POST /metrics/backfill (minimal - only required fields) ==="
  curl -s -X POST "${BASE_URL}/metrics/backfill" \
    "${AUTH_H[@]}" "${JSON_H[@]}" \
    -d '{
      "tenantId": "'"${TENANT_ID}"'",
      "matchId": "000000000000000000000000",
      "timelineIds": ["timeline-001"]
    }' | jq .
}

# --- Scheduler Targets ---
test_get_scheduler_targets() {
  echo "=== GET /metrics/scheduler-targets ==="
  curl -s "${BASE_URL}/metrics/scheduler-targets" \
    "${AUTH_H[@]}" | jq .
}

test_upsert_scheduler_target() {
  echo "=== POST /metrics/scheduler-targets (upsert) ==="
  curl -s -X POST "${BASE_URL}/metrics/scheduler-targets" \
    "${AUTH_H[@]}" "${JSON_H[@]}" \
    -d '{
      "tenantId": "'"${TENANT_ID}"'",
      "matchId": "000000000000000000000000",
      "timelineIds": ["timeline-001", "timeline-002"],
      "enabled": true
    }' | jq .
}

test_disable_scheduler_target() {
  echo "=== PATCH /metrics/scheduler-targets/:matchId/disable ==="
  curl -s -X PATCH "${BASE_URL}/metrics/scheduler-targets/000000000000000000000000/disable" \
    "${AUTH_H[@]}" | jq .
}

# =============================================================================
# Tenant Management
# =============================================================================

test_refresh_tenant_cache() {
  echo "=== POST /tenant-management/refresh-cache ==="
  curl -s -X POST "${BASE_URL}/tenant-management/refresh-cache" \
    "${AUTH_H[@]}" | jq .
}

# =============================================================================
# Error / Edge Cases
# =============================================================================

test_missing_auth() {
  echo "=== GET /metrics/platform (missing auth headers - expect 401) ==="
  curl -s "${BASE_URL}/metrics/platform?matchId=000000000000000000000000" | jq .
}

test_wrong_api_key() {
  echo "=== GET /metrics/platform (wrong API key - expect 401) ==="
  curl -s "${BASE_URL}/metrics/platform?matchId=000000000000000000000000" \
    -H "x-tenant-id: ${TENANT_ID}" -H "x-internal-api-key: wrong-key" | jq .
}

test_invalid_body() {
  echo "=== POST /metrics/backfill (invalid body - expect 400) ==="
  curl -s -X POST "${BASE_URL}/metrics/backfill" \
    "${AUTH_H[@]}" "${JSON_H[@]}" \
    -d '{"invalidField": true}' | jq .
}

test_missing_tenant() {
  echo "=== GET /metrics/platform (missing x-tenant-id - expect 401 or empty) ==="
  curl -s "${BASE_URL}/metrics/platform?matchId=000000000000000000000000" \
    -H "x-internal-api-key: ${API_KEY}" | jq .
}

# =============================================================================
# Run all tests
# =============================================================================

test_all() {
  echo ">>> Running all API tests against ${BASE_URL} ..."
  echo ""
  test_platform
  echo ""
  test_device
  echo ""
  test_transport
  echo ""
  test_sdk
  echo ""
  test_failures
  echo ""
  test_latency
  echo ""
  test_timeseries
  echo ""
  test_timeseries_filtered
  echo ""
  test_get_scheduler_targets
  echo ""
  test_refresh_tenant_cache
  echo ""
  echo ">>> Done. Run test_backfill / test_upsert_scheduler_target manually (they mutate data)."
}
