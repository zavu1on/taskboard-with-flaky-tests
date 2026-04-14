/**
 * tests/e2e/fixtures/network-delay.ts
 *
 * Playwright fixture, который добавляет задержку на все API-запросы
 * через page.route(). Работает в любом браузере (не требует CDP).
 *
 * КАК ЭТО РАБОТАЕТ:
 * page.route("**/ api; /**") перехватывает все запросы к /api/*.
 * Перед route.continue() делаем setTimeout(delay).
 * Задержка = BASE_DELAY + random(0, JITTER) — имитирует сетевую нестабильность.
 *
 * ПАРАМЕТРЫ (через env):
 *   API_DELAY_MS=300    — базовая задержка (мс)
 *   API_JITTER_MS=200   — случайная добавка ±jitter (мс)
 *
 * ИСПОЛЬЗОВАНИЕ в spec-файле:
 *
 *   import { test, expect } from '../fixtures/network-delay';
 *
 *   test('my test', async ({ page }) => {
 *     // все запросы к /api/* задержаны на BASE_DELAY ± JITTER
 *   });
 */

import { test as base, expect } from "@playwright/test";

const BASE_DELAY = Number(process.env.API_DELAY_MS ?? 300);
const JITTER = Number(process.env.API_JITTER_MS ?? 200);

function randomDelay(): number {
	return BASE_DELAY + Math.floor(Math.random() * JITTER);
}

type DelayFixtures = {
	// Маркер, что задержка применена (для логирования)
	networkDelay: { baseMs: number; jitterMs: number };
};

export const test = base.extend<DelayFixtures>({
	networkDelay: async ({}, use) => {
		await use({ baseMs: BASE_DELAY, jitterMs: JITTER });
	},

	page: async ({ page, networkDelay }, use) => {
		// Перехватываем ВСЕ запросы к нашему API
		await page.route("**/api/**", async (route) => {
			const delay = randomDelay();

			// Логируем задержку для отладки (убираем в prod-прогонах)
			if (process.env.DEBUG_DELAY) {
				console.log(
					`[network-delay] ${route.request().method()} ${route.request().url()} +${delay}ms`,
				);
			}

			await new Promise((resolve) => setTimeout(resolve, delay));
			await route.continue();
		});

		console.log(
			`[network-delay] Installed: base=${networkDelay.baseMs}ms jitter=±${networkDelay.jitterMs}ms`,
		);

		await use(page);
	},
});

export { expect };

// ─────────────────────────────────────────────────────────────
// АЛЬТЕРНАТИВА: встроить задержку прямо в beforeEach описания:
//
// test.beforeEach(async ({ page }) => {
//   const BASE = Number(process.env.API_DELAY_MS ?? 300);
//   const JITTER = Number(process.env.API_JITTER_MS ?? 200);
//
//   await page.route('**/api/**', async (route) => {
//     const delay = BASE + Math.floor(Math.random() * JITTER);
//     await new Promise(r => setTimeout(r, delay));
//     await route.continue();
//   });
// });
// ─────────────────────────────────────────────────────────────
