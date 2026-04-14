/**
 * SPEC 07 — Concurrent DOM Mutations (ED-category, stress)
 *
 * Сценарий: 10 задач создаются параллельно через API,
 * затем Board рендерит их разом. Тест проверяет,
 * не теряет ли React DOM consistency при batch-обновлениях.
 *
 * Источник флакинесса:
 *   useTasks.ts использует setTasks((prev) => [...prev, optimistic]).
 *   При 10 параллельных вызовах React batching может не успеть
 *   обработать все setState до первого render.
 *   DOM показывает промежуточные состояния (N < 10 карточек).
 *
 * Связь с Pei et al. ICST 2025:
 *   ED-category (Event-DOM): каждый optimistic update —
 *   событие, модифицирующее DOM. При параллельных событиях
 *   DOM-состояние становится непредсказуемым.
 *
 * КАК ЗАПУСТИТЬ:
 *
 *   # Среда A:
 *   TEST_ENV=A_baseline npx playwright test tests/e2e/07-stress-concurrent.spec.ts \
 *     --config playwright.env-a.config.ts --repeat-each 30 --retries 0
 *
 *   # Среда B (WSL-safe, без CDP):
 *   TEST_ENV=B_cpu_throttle CPU_FAKE_DELAY_MS=150 \
 *   npx playwright test tests/e2e/07-stress-concurrent.spec.ts \
 *     --config playwright.env-b.config.ts --repeat-each 30 --retries 0
 *
 *   # Среда C:
 *   TEST_ENV=C_network_delay API_DELAY_MS=300 API_JITTER_MS=200 \
 *   npx playwright test tests/e2e/07-stress-concurrent.spec.ts \
 *     --config playwright.env-c.config.ts --repeat-each 30 --retries 0
 */

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
	clearAllTasksViaAPI,
	createTaskViaAPI,
	waitForBoard,
} from "./helpers/board";

// ── Утилиты применения нагрузки ──────────────────────────────────────────────

/**
 * Применяет замедление согласно текущей среде (TEST_ENV).
 *
 * Среда B: сначала пробует CDP (нативный Chrome), при ошибке
 *          (WSL, headless CI) падает на связку rAF-delay + route-delay.
 * Среда C: перехватывает все /api/* запросы с рандомной задержкой.
 */
async function applyThrottle(page: Page): Promise<void> {
	const env = process.env.TEST_ENV ?? "A_baseline";

	if (env === "B_cpu_throttle") {
		const rafDelay = Number(process.env.CPU_FAKE_DELAY_MS ?? 150);

		try {
			// Попытка 1: CDP (работает в нативном Chromium)
			const client = await page.context().newCDPSession(page);
			await client.send("Emulation.setCPUThrottlingRate", {
				rate: Number(process.env.CPU_THROTTLE_RATE ?? 4),
			});
			(page as any).__cdp = client;
			console.log("[07] CDP throttle: rate=4x");
		} catch {
			// Попытка 2: WSL-safe fallback
			console.log(`[07] CDP unavailable → rAF+route delay (${rafDelay}ms)`);

			// Замедляем React render — каждый кадр задерживается на rafDelay
			await page.addInitScript((delay: number) => {
				const orig = window.requestAnimationFrame.bind(window);
				(window as any).requestAnimationFrame = (cb: FrameRequestCallback) =>
					orig(() => setTimeout(cb, delay));
			}, rafDelay);

			// Замедляем обработку API-ответов
			await page.route("**/api/**", async (route) => {
				await new Promise((r) => setTimeout(r, rafDelay));
				await route.continue();
			});
		}
	}

	if (env === "C_network_delay") {
		const base = Number(process.env.API_DELAY_MS ?? 300);
		const jitter = Number(process.env.API_JITTER_MS ?? 200);

		await page.route("**/api/**", async (route) => {
			const delay = base + Math.floor(Math.random() * jitter);
			await new Promise((r) => setTimeout(r, delay));
			await route.continue();
		});

		console.log(`[07] Network delay: ${base}ms ± ${jitter}ms`);
	}
}

async function cleanupThrottle(page: Page): Promise<void> {
	const client = (page as any).__cdp;
	if (client) {
		try {
			await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
			await client.detach();
		} catch {
			/* игнорируем */
		}
		delete (page as any).__cdp;
	}
}

// ── Тесты ────────────────────────────────────────────────────────────────────

test.describe("07 · Concurrent DOM Mutations (Stress)", () => {
	test.beforeEach(async ({ page }) => {
		await applyThrottle(page);
		await page.goto("/");
		await waitForBoard(page);
		await clearAllTasksViaAPI(page);
		await page.reload();
		await waitForBoard(page);
	});

	test.afterEach(async ({ page }) => {
		await cleanupThrottle(page);
	});

	// ─────────────────────────────────────────────────────────────────────
	// [FLAKY] — count() без ожидания board после reload
	//
	// ПОЧЕМУ ФЛАКАЕТ:
	//   После page.reload() React ещё не завершил начальный render.
	//   count() — мгновенный snapshot, не ретраит.
	//   В момент вызова DOM находится в одном из трёх состояний:
	//     a) skeleton: 0 карточек (board-loading ещё виден)
	//     b) partial:  N < 10 карточек (часть задач отрендерилась)
	//     c) complete: 10 карточек (всё ok)
	//   На медленном CPU (среда B) вероятность (a) и (b) резко возрастает.
	// ─────────────────────────────────────────────────────────────────────
	test("[FLAKY] 10 параллельных задач — count() без waitForBoard", async ({
		page,
	}) => {
		await Promise.all(
			Array.from({ length: 10 }, (_, i) =>
				createTaskViaAPI(page, {
					title: `Concurrent Task ${i + 1}`,
					status: "BACKLOG",
				}),
			),
		);

		await page.reload();

		// BUG: нет waitForBoard — DOM в промежуточном состоянии
		const count = await page.locator('[data-testid^="task-card-"]').count();

		expect(count).toBe(10); // нестабильно: иногда 0..9
	});

	// ─────────────────────────────────────────────────────────────────────
	// [STABLE] — waitForBoard + toHaveCount (web-first assertion)
	//
	// ПОЧЕМУ СТАБИЛЬНО:
	//   1. waitForBoard ждёт исчезновения skeleton → board полностью загружен
	//   2. toHaveCount() polling ретраит каждые ~100ms до actionTimeout
	//   Даже если первый snapshot показал 7 карточек — Playwright подождёт.
	// ─────────────────────────────────────────────────────────────────────
	test("[STABLE] 10 параллельных задач — waitForBoard + toHaveCount", async ({
		page,
	}) => {
		await Promise.all(
			Array.from({ length: 10 }, (_, i) =>
				createTaskViaAPI(page, {
					title: `Concurrent Task ${i + 1}`,
					status: "BACKLOG",
				}),
			),
		);

		await page.reload();
		await waitForBoard(page); // FIX 1: ждём стабилизации

		await expect(
			// FIX 2: web-first polling
			page.locator('[data-testid^="task-card-"]'),
		).toHaveCount(10);
	});

	// ─────────────────────────────────────────────────────────────────────
	// [STRESS] — конкурентные мутации: API delete + UI create одновременно
	// ─────────────────────────────────────────────────────────────────────
	test("[STRESS] создание и удаление одновременно — DOM consistency", async ({
		page,
	}) => {
		const tasks = await Promise.all(
			Array.from({ length: 6 }, (_, i) =>
				createTaskViaAPI(page, {
					title: `Mixed Task ${i + 1}`,
					status: "BACKLOG",
				}),
			),
		);

		await page.reload();
		await waitForBoard(page);

		await expect(
			page.getByTestId("column-backlog").locator('[data-testid^="task-card-"]'),
		).toHaveCount(6);

		// Удаляем первые 3 через API (минуя React state)
		await Promise.all(
			tasks.slice(0, 3).map((t) => page.request.delete(`/api/tasks/${t.id}`)),
		);

		// Создаём 1 через UI (проходит через React optimistic state)
		await page.getByTestId("add-task-btn-backlog").click();
		await expect(page.getByTestId("modal")).toBeVisible();
		await page.getByTestId("task-title-input").fill("UI Task During Delete");
		await page.getByTestId("modal-submit-btn").click();
		await expect(page.getByTestId("modal")).not.toBeVisible();

		// Reload синхронизирует React state с БД
		// Ожидаем: 6 - 3 (API delete) + 1 (UI create) = 4
		await page.reload();
		await waitForBoard(page);

		await expect(
			page.getByTestId("column-backlog").locator('[data-testid^="task-card-"]'),
		).toHaveCount(4);
	});

	// ─────────────────────────────────────────────────────────────────────
	// [STRESS] — 5 параллельных PATCH через API, проверяем финальный DOM
	// ─────────────────────────────────────────────────────────────────────
	test("[STRESS] 5 задач параллельно меняют статус — финальный DOM", async ({
		page,
	}) => {
		const tasks = await Promise.all(
			Array.from({ length: 5 }, (_, i) =>
				createTaskViaAPI(page, {
					title: `Status Task ${i + 1}`,
					status: "BACKLOG",
				}),
			),
		);

		await page.reload();
		await waitForBoard(page);

		// Параллельно переводим все 5 задач в IN_PROGRESS
		await Promise.all(
			tasks.map((t) =>
				page.request.patch(`/api/tasks/${t.id}`, {
					data: { status: "IN_PROGRESS" },
				}),
			),
		);

		await page.reload();
		await waitForBoard(page);

		await expect(
			page.getByTestId("column-backlog").locator('[data-testid^="task-card-"]'),
		).toHaveCount(0);

		await expect(
			page
				.getByTestId("column-in-progress")
				.locator('[data-testid^="task-card-"]'),
		).toHaveCount(5);
	});
});
