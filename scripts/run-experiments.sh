#!/usr/bin/env bash
# scripts/run-experiments.sh
# ─────────────────────────────────────────────────────────────────────────────
# Оркестратор экспериментов для НИР: запускает тесты в средах A, B, C
# и собирает результаты в stress-results/*.ndjson
#
# ИСПОЛЬЗОВАНИЕ:
#   chmod +x scripts/run-experiments.sh
#   ./scripts/run-experiments.sh
#
# ПАРАМЕТРЫ (через env):
#   REPEAT=30           — кол-во повторений каждого теста
#   SPECS="01 02 03"    — какие spec'и запускать (default: все)
#   SKIP_ENV_A=1        — пропустить среду A
#   SKIP_ENV_B=1        — пропустить среду B
#   SKIP_ENV_C=1        — пропустить среду C
#   CPU_THROTTLE_RATE=4 — коэффициент замедления CPU для среды B
#   API_DELAY_MS=300    — базовая задержка сети для среды C
#   API_JITTER_MS=200   — вариация задержки для среды C
#
# ПРИМЕР (только среды A и B, 20 повторений):
#   REPEAT=20 SKIP_ENV_C=1 ./scripts/run-experiments.sh
#
# ВЫВОД:
#   stress-results/A_baseline.ndjson
#   stress-results/B_cpu_throttle.ndjson
#   stress-results/C_network_delay.ndjson
#   stress-results/experiment-summary.txt
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Конфигурация ──────────────────────────────────────────────────────────────
REPEAT="${REPEAT:-30}"
CPU_THROTTLE_RATE="${CPU_THROTTLE_RATE:-4}"
API_DELAY_MS="${API_DELAY_MS:-300}"
API_JITTER_MS="${API_JITTER_MS:-200}"
RESULTS_DIR="stress-results"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
LOG_FILE="${RESULTS_DIR}/run_${TIMESTAMP}.log"

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# ── Функции ───────────────────────────────────────────────────────────────────
log() { echo -e "$@" | tee -a "${LOG_FILE}"; }
log_section() { log "\n${BOLD}${CYAN}═══════════════════════════════════════${NC}"; log "${BOLD}${CYAN}  $1${NC}"; log "${BOLD}${CYAN}═══════════════════════════════════════${NC}"; }
log_ok() { log "${GREEN}✓ $1${NC}"; }
log_warn() { log "${YELLOW}⚠ $1${NC}"; }
log_err() { log "${RED}✗ $1${NC}"; }
log_info() { log "${BLUE}ℹ $1${NC}"; }

# ── Подготовка ────────────────────────────────────────────────────────────────
mkdir -p "${RESULTS_DIR}"
log_section "Эксперимент по флакинессу — $(date)"
log_info "REPEAT_EACH   = ${REPEAT}"
log_info "CPU_THROTTLE  = ${CPU_THROTTLE_RATE}x"
log_info "API_DELAY     = ${API_DELAY_MS}ms ± ${API_JITTER_MS}ms"
log_info "Results dir   = ${RESULTS_DIR}/"
log_info "Log file      = ${LOG_FILE}"

# Проверяем что приложение запущено
log_info "Проверяем доступность http://localhost:3000..."
if ! curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 | grep -q "200"; then
  log_warn "Приложение не отвечает на localhost:3000"
  log_warn "Playwright webServer автоматически запустит 'npm run dev'"
fi

# ── Прогон СРЕДЫ A — Baseline ──────────────────────────────────────────────
if [ -z "${SKIP_ENV_A:-}" ]; then
  log_section "СРЕДА A — Baseline (без ограничений)"

  # Очищаем предыдущий результат
  rm -f "${RESULTS_DIR}/A_baseline.ndjson"

  START_TIME=$(date +%s)

  TEST_ENV=A_baseline \
  FLAKY_REPORT_FILE="${RESULTS_DIR}/A_baseline.ndjson" \
    npx playwright test \
      --config playwright.env-a.config.ts \
      --repeat-each "${REPEAT}" \
      --retries 0 \
      2>&1 | tee -a "${LOG_FILE}" || true
  # `|| true` — не прерываем скрипт при падении тестов (это ожидаемо)

  END_TIME=$(date +%s)
  ELAPSED=$(( END_TIME - START_TIME ))
  log_ok "Среда A завершена за ${ELAPSED}с -> ${RESULTS_DIR}/A_baseline.ndjson"
else
  log_warn "Среда A пропущена (SKIP_ENV_A=1)"
fi

# ── Прогон СРЕДЫ B — CPU Throttle ─────────────────────────────────────────
if [ -z "${SKIP_ENV_B:-}" ]; then
  log_section "СРЕДА B — CPU Throttle (${CPU_THROTTLE_RATE}x замедление)"
  log_warn "CDP работает только в Chromium! Firefox будет без throttle."

  rm -f "${RESULTS_DIR}/B_cpu_throttle.ndjson"

  START_TIME=$(date +%s)

  TEST_ENV=B_cpu_throttle \
  CPU_THROTTLE_RATE="${CPU_THROTTLE_RATE}" \
  FLAKY_REPORT_FILE="${RESULTS_DIR}/B_cpu_throttle.ndjson" \
    npx playwright test \
      --config playwright.env-b.config.ts \
      --repeat-each "${REPEAT}" \
      --retries 0 \
      2>&1 | tee -a "${LOG_FILE}" || true

  END_TIME=$(date +%s)
  ELAPSED=$(( END_TIME - START_TIME ))
  log_ok "Среда B завершена за ${ELAPSED}с -> ${RESULTS_DIR}/B_cpu_throttle.ndjson"
else
  log_warn "Среда B пропущена (SKIP_ENV_B=1)"
fi

# ── Прогон СРЕДЫ C — Network Delay ────────────────────────────────────────
if [ -z "${SKIP_ENV_C:-}" ]; then
  log_section "СРЕДА C — Network Delay (${API_DELAY_MS}ms ± ${API_JITTER_MS}ms)"

  rm -f "${RESULTS_DIR}/C_network_delay.ndjson"

  START_TIME=$(date +%s)

  TEST_ENV=C_network_delay \
  API_DELAY_MS="${API_DELAY_MS}" \
  API_JITTER_MS="${API_JITTER_MS}" \
  FLAKY_REPORT_FILE="${RESULTS_DIR}/C_network_delay.ndjson" \
    npx playwright test \
      --config playwright.env-c.config.ts \
      --repeat-each "${REPEAT}" \
      --retries 0 \
      2>&1 | tee -a "${LOG_FILE}" || true

  END_TIME=$(date +%s)
  ELAPSED=$(( END_TIME - START_TIME ))
  log_ok "Среда C завершена за ${ELAPSED}с -> ${RESULTS_DIR}/C_network_delay.ndjson"
else
  log_warn "Среда C пропущена (SKIP_ENV_C=1)"
fi

# ── Итоговая сводка ───────────────────────────────────────────────────────
log_section "Результаты собраны"

SUMMARY_FILE="${RESULTS_DIR}/experiment-summary.txt"
{
  echo "=== Эксперимент: $(date) ==="
  echo "REPEAT_EACH = ${REPEAT}"
  echo "CPU_THROTTLE_RATE = ${CPU_THROTTLE_RATE}"
  echo "API_DELAY_MS = ${API_DELAY_MS}"
  echo "API_JITTER_MS = ${API_JITTER_MS}"
  echo ""
  for env_file in "${RESULTS_DIR}"/*.ndjson; do
    [ -f "${env_file}" ] || continue
    ENV_NAME=$(basename "${env_file}" .ndjson)
    TOTAL=$(wc -l < "${env_file}" | tr -d ' ')
    FAILED=$(grep -c '"status":"failed"' "${env_file}" || echo 0)
    PASSED=$(grep -c '"status":"passed"' "${env_file}" || echo 0)
    echo "--- ${ENV_NAME} ---"
    echo "  Total:  ${TOTAL}"
    echo "  Passed: ${PASSED}"
    echo "  Failed: ${FAILED}"
    if [ "${TOTAL}" -gt 0 ]; then
      RATE=$(awk "BEGIN { printf \"%.1f\", ${FAILED} / ${TOTAL} * 100 }")
      echo "  Failure rate: ${RATE}%"
    fi
    echo ""
  done
} > "${SUMMARY_FILE}"

cat "${SUMMARY_FILE}"
log_ok "Сводка -> ${SUMMARY_FILE}"

log_section "Следующий шаг"
log_info "Запустите анализ: python3 scripts/analyze-results.py"
log_info "Отчёт будет в:   stress-results/analysis/"
