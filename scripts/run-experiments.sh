# ── Исполнение FLAKY сценариев и их STABLE эквивалентов
TEST_ENV=A_baseline npx playwright test \
  --config playwright.env-a.config.ts \
  --repeat-each 15 --retries 0

# ── Анализ
python3 scripts/analyze-env-a.py

# ── Шаг 1: Isolated (victim без поллютера — всегда PASS)
TEST_ENV=B_od_isolated npx playwright test \
  tests/e2e/10-od-listener-leak.spec.ts \
  tests/e2e/11-od-localstorage.spec.ts \
  --config playwright.env-b.config.ts \
  --grep "ISOLATED" --repeat-each 15 --retries 0

# ── Шаг 2: Polluted (воспроизведение OD — VICTIM должен FAIL)
TEST_ENV=B_od_polluted npx playwright test \
  tests/e2e/10-od-listener-leak.spec.ts \
  tests/e2e/11-od-localstorage.spec.ts \
  --config playwright.env-b.config.ts \
  --grep "POLLUTER.VICTIM" --repeat-each 15 --retries 0

# ── Шаг 3: Stable (фиксы работают — всё PASS)
TEST_ENV=B_od_stable npx playwright test \
  tests/e2e/10-od-listener-leak.spec.ts \
  tests/e2e/11-od-localstorage.spec.ts \
  --config playwright.env-b.config.ts \
  --grep "STABLE" --repeat-each 15 --retries 0

# ── Анализ
python3 scripts/analyze-env-b.py
