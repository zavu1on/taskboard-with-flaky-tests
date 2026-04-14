#!/usr/bin/env bash
# scripts/fast-experiments.sh
set -euo pipefail

SPECS="tests/e2e/01-async-race.spec.ts tests/e2e/04-optimistic-rollback.spec.ts tests/e2e/05-drag-and-drop.spec.ts"
REPEAT=10

echo "=== Среда B: CPU Throttle ==="
TEST_ENV=B_cpu_throttle \
CPU_FAKE_DELAY_MS=150 \
  npx playwright test \
    --config playwright.env-b.config.ts \
    --repeat-each $REPEAT --retries 0 \
    $SPECS

echo "=== Среда C: Network Delay ==="
TEST_ENV=C_network_delay \
API_DELAY_MS=300 \
API_JITTER_MS=200 \
  npx playwright test \
    --config playwright.env-c.config.ts \
    --repeat-each $REPEAT --retries 0 \
    $SPECS

echo "=== Готово. Запускаем анализ ==="
python3 scripts/analyze-results.py
