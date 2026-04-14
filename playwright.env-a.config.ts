/**
 * playwright.env-a.config.ts
 * ─────────────────────────────────────────────────
 * СРЕДА A — Baseline
 *
 * Никакого throttling. Нормальные условия.
 * Используется как точка отсчёта для сравнения failure rate.
 *
 * Запуск:
 *   TEST_ENV=A_baseline npx playwright test \
 *     --config playwright.env-a.config.ts \
 *     --repeat-each 30 --retries 0
 */

import { defineConfig, devices } from "@playwright/test";
import path from "path";

const REPEAT = Number(process.env.REPEAT_EACH ?? 30);

export default defineConfig({
	testDir: "./tests/e2e",

	// Только Chromium для воспроизводимости между средами.
	// Firefox добавляем отдельным прогоном если нужно.
	projects: [
		{
			name: "chromium-baseline",
			use: { ...devices["Desktop Chrome"] },
		},
	],

	// Последовательно — исключаем влияние параллелизма на результат
	fullyParallel: false,
	workers: 1,

	// retries=0 — видим реальный flakiness без скрытия
	retries: 0,

	reporter: [
		["list"],
		["html", { outputFolder: "playwright-report/env-a", open: "never" }],
		[
			path.resolve("./reporters/flaky-json-reporter.ts"),
			{
				env: "A_baseline",
				outputFile: path.resolve("./stress-results/A_baseline.ndjson"),
			},
		],
	],

	use: {
		baseURL: "http://localhost:3000",
		trace: "off", // trace off для скорости — включаем только при отладке
		video: "off",
		screenshot: "only-on-failure",
		actionTimeout: 10_000,
		navigationTimeout: 15_000,

		// Среда A: никакого замедления CPU, нормальная сеть
		launchOptions: {
			args: [],
		},
	},

	webServer: {
		command: "npm run dev",
		url: "http://localhost:3000",
		reuseExistingServer: true,
		timeout: 60_000,
	},
});
