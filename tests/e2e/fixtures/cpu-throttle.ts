/**
 * tests/e2e/fixtures/cpu-throttle.ts
 *
 * Playwright fixture, который применяет CPU throttling через CDP
 * перед каждым тестом и снимает его после.
 *
 * КАК ЭТО РАБОТАЕТ:
 * Chrome DevTools Protocol (CDP) предоставляет метод
 * Emulation.setCPUThrottlingRate, который замедляет JavaScript execution
 * на стороне браузера. Rate=4 означает «CPU в 4 раза медленнее».
 *
 * ВАЖНО: CDP доступен только в Chromium. Для Firefox/Safari
 * throttling нужно делать через OS-уровень (cpulimit, nice) или
 * через ограничение ресурсов Docker-контейнера.
 *
 * ИСПОЛЬЗОВАНИЕ в spec-файле:
 *
 *   import { test, expect } from '../fixtures/cpu-throttle';
 *   // вместо import { test, expect } from '@playwright/test'
 *
 *   test('my test', async ({ page }) => {
 *     // CPU уже throttled здесь
 *   });
 */

import type { CDPSession } from "@playwright/test";
import { test as base, expect } from "@playwright/test";

// Читаем rate из env, default = 4x (имитация слабого CI)
const CPU_THROTTLE_RATE = Number(process.env.CPU_THROTTLE_RATE ?? 4);

// Расширяем тип фикстур
type ThrottleFixtures = {
	cdpSession: CDPSession;
};

export const test = base.extend<ThrottleFixtures>({
	// Фикстура cdpSession — создаём CDP-сессию и применяем throttle
	cdpSession: async ({ page }, use) => {
		// Подключаемся к CDP-сессии страницы
		const client = await page.context().newCDPSession(page);

		// Применяем CPU throttle
		await client.send("Emulation.setCPUThrottlingRate", {
			rate: CPU_THROTTLE_RATE,
		});

		console.log(`[cpu-throttle] Applied ${CPU_THROTTLE_RATE}x CPU throttle`);

		// Передаём фикстуру тесту
		await use(client);

		// После теста снимаем throttle (rate=1 = no throttle)
		await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
		await client.detach();
	},

	// Автоматически используем cdpSession в каждом тесте
	// (auto: true означает фикстура применяется без явного запроса)
	page: async ({ page, cdpSession: _cdp }, use) => {
		// cdpSession уже применён выше, просто пробрасываем page
		await use(page);
	},
});

export { expect };

// ─────────────────────────────────────────────────────────────
// АЛЬТЕРНАТИВНЫЙ ПОДХОД: beforeEach в describe-блоке
// Используй этот шаблон если не хочешь кастомный fixture:
//
// import { chromium } from '@playwright/test';
//
// test.beforeEach(async ({ page }) => {
//   const client = await page.context().newCDPSession(page);
//   await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
//   // сохраняем client в page._cdpClient для afterEach
//   (page as any)._cdpClient = client;
// });
//
// test.afterEach(async ({ page }) => {
//   const client = (page as any)._cdpClient as CDPSession | undefined;
//   if (client) {
//     await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
//     await client.detach();
//   }
// });
// ─────────────────────────────────────────────────────────────
