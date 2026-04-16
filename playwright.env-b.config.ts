/**
 * playwright.env-b.config.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * СРЕДА B — Order-Dependent (OD) тесты
 *
 * Конфигурация для воспроизведения и анализа ORDER-DEPENDENT флакинесса.
 * OD-тесты по своей природе зависят от порядка выполнения и состояния,
 * разделяемого между тестами (shared DOM state, localStorage, browser context).
 *
 * КЛЮЧЕВЫЕ НАСТРОЙКИ:
 *   fullyParallel: false — строгая последовательность (критично для OD!)
 *   workers: 1          — один воркер = детерминированный порядок
 *   retries: 0          — видим реальный failure без маскировки
 *
 * ЗАПУСК:
 *
 *   # Полный эксперимент (15 прогонов):
 *   TEST_ENV=B_od npx playwright test \
 *     tests/e2e/10-od-listener-leak.spec.ts \
 *     tests/e2e/11-od-localstorage.spec.ts \
 *     --config playwright.env-b.config.ts \
 *     --repeat-each 15 --retries 0
 *
 *   # Только ISOLATED группы (baseline — должны всегда проходить):
 *   TEST_ENV=B_od_isolated npx playwright test \
 *     tests/e2e/10-od-listener-leak.spec.ts \
 *     tests/e2e/11-od-localstorage.spec.ts \
 *     --config playwright.env-b.config.ts \
 *     --grep "ISOLATED" --repeat-each 15 --retries 0
 *
 *   # Только POLLUTER→VICTIM (воспроизведение OD):
 *   TEST_ENV=B_od_polluted npx playwright test \
 *     tests/e2e/10-od-listener-leak.spec.ts \
 *     tests/e2e/11-od-localstorage.spec.ts \
 *     --config playwright.env-b.config.ts \
 *     --grep "POLLUTER.VICTIM" --repeat-each 15 --retries 0
 *
 *   # Только STABLE (проверка фиксов):
 *   TEST_ENV=B_od_stable npx playwright test \
 *     tests/e2e/10-od-listener-leak.spec.ts \
 *     tests/e2e/11-od-localstorage.spec.ts \
 *     --config playwright.env-b.config.ts \
 *     --grep "STABLE" --repeat-each 15 --retries 0
 *
 *   # Анализ результатов:
 *   python3 scripts/analyze-env-b.py
 */

import { defineConfig, devices } from "@playwright/test";
import path from "path";

export default defineConfig({
	// Только OD-спеки (spec 10 и 11)
	testDir: "./tests/e2e",
	testMatch: [
		"**/10-od-listener-leak.spec.ts",
		"**/11-od-localstorage.spec.ts",
	],

	// КРИТИЧНО для OD: строгая последовательность без параллелизма
	fullyParallel: false,
	workers: 1,

	// retries=0: видим реальный OD-failure
	// С retries>0 часть OD-флакинесса будет скрыта!
	retries: 0,

	reporter: [
		["list"],
		["html", { outputFolder: "playwright-report/env-b", open: "never" }],
		[
			path.resolve("./reporters/flaky-json-reporter.ts"),
			{
				env: process.env.TEST_ENV ?? "B_od",
				outputFile: path.resolve(
					`./stress-results/${process.env.TEST_ENV ?? "B_od"}.ndjson`,
				),
			},
		],
	],

	use: {
		baseURL: "http://localhost:3000",
		trace: "off",
		video: "off",
		screenshot: "only-on-failure",
		actionTimeout: 10_000,
		navigationTimeout: 15_000,
	},

	projects: [
		{
			name: "chromium-od",
			use: { ...devices["Desktop Chrome"] },
		},
	],

	webServer: {
		command: "npm run dev",
		url: "http://localhost:3000",
		reuseExistingServer: true,
		timeout: 60_000,
	},
});
