/**
 * SPEC 09 — Cascade Rollback (D-category, наиболее жёсткий stress)
 *
 * D-category по Pei et al.: longest lifespan = 153.4 дня.
 * Причина долгой жизни: тяжело воспроизвести и сложно диагностировать.
 * Дефект проявляется редко и непредсказуемо.
 *
 * Сценарий: серия оптимистичных обновлений, каждое из которых
 * откатывается сервером (500). DOM должен корректно вернуться
 * в исходное состояние после N rollback'ов подряд.
 *
 * Источник флакинесса (stale closure):
 *   useTasks.ts — updateTask захватывает `tasks` из closure:
 *
 *     const updateTask = useCallback(async (id, input) => {
 *       const prev = tasks.find(t => t.id === id);  // ← closure!
 *       setTasks(all => all.map(...));               // optimistic
 *       try { ... } catch {
 *         setTasks(all => all.map(t => t.id === id ? prev : t)); // rollback
 *       }
 *     }, [tasks]);  // ← пересоздаётся при каждом изменении tasks
 *
 *   При быстрых последовательных вызовах:
 *     op1: prev=original, optimistic=HIGH
 *     op2: вызывается ДО того как op1 rollback пересоздал updateTask
 *          → op2 захватывает stale prev=HIGH (не original!)
 *          → rollback op2 возвращает HIGH, а не original
 *
 * Связь с Pei et al. ICST 2025:
 *   D-category: прямые DOM-манипуляции без учёта async rollback цепочек.
 *   Реальный прецедент: wp-calypso (9 DOM commits), metamask-extension.
 *
 * КАК ЗАПУСТИТЬ (поиск флакинесса):
 *
 *   TEST_ENV=B_cpu_throttle CPU_FAKE_DELAY_MS=150 \
 *   npx playwright test tests/e2e/09-stress-cascade-rollback.spec.ts \
 *     --config playwright.env-b.config.ts --repeat-each 20 --retries 0
 */

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
	clearAllTasksViaAPI,
	createTaskViaAPI,
	waitForBoard,
} from "./helpers/board";

// ── Утилиты применения нагрузки (идентичны спекам 07, 08) ───────────────────

async function applyThrottle(page: Page): Promise<void> {
	const env = process.env.TEST_ENV ?? "A_baseline";

	if (env === "B_cpu_throttle") {
		const rafDelay = Number(process.env.CPU_FAKE_DELAY_MS ?? 150);
		try {
			const client = await page.context().newCDPSession(page);
			await client.send("Emulation.setCPUThrottlingRate", {
				rate: Number(process.env.CPU_THROTTLE_RATE ?? 4),
			});
			(page as any).__cdp = client;
			console.log("[09] CDP throttle: rate=4x");
		} catch {
			console.log(`[09] CDP unavailable → rAF+route delay (${rafDelay}ms)`);
			await page.addInitScript((delay: number) => {
				const orig = window.requestAnimationFrame.bind(window);
				(window as any).requestAnimationFrame = (cb: FrameRequestCallback) =>
					orig(() => setTimeout(cb, delay));
			}, rafDelay);
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
		console.log(`[09] Network delay: ${base}ms ± ${jitter}ms`);
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

test.describe("09 · Cascade Rollback (D-category Stress)", () => {
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
	// [FLAKY] — два rollback подряд без ожидания первого
	//
	// ПОЧЕМУ ФЛАКАЕТ (stale closure):
	//   1. op1 отправляет PATCH → optimistic: priority=HIGH
	//      useTasks захватил prev={priority: MEDIUM}
	//   2. op2 немедленно вызывается.
	//      В этот момент useTasks ЕЩЁ НЕ пересоздал updateTask
	//      (React ещё не перерендерил с новым tasks).
	//      op2 захватывает stale prev={priority: HIGH} (optimistic!)
	//   3. Сервер отвечает 500 на op1 → rollback: priority=MEDIUM ✓
	//   4. Сервер отвечает 500 на op2 → rollback: priority=HIGH ✗
	//      (stale prev был HIGH, а не MEDIUM)
	//
	//   Итог: задача остаётся с HIGH priority вместо исходного MEDIUM.
	//   Тест ловит это как failure на expect(badge).toHaveText("Medium").
	// ─────────────────────────────────────────────────────────────────────
	test("[FLAKY] два rollback подряд — stale closure в useTasks", async ({
		page,
	}) => {
		const task = await createTaskViaAPI(page, {
			title: "Cascade Target",
			status: "BACKLOG",
			priority: "MEDIUM",
		});
		await page.reload();
		await waitForBoard(page);

		// Блокируем все PATCH для этой задачи
		await page.route(`**/api/tasks/${task.id}`, async (route) => {
			if (route.request().method() === "PATCH") {
				await route.fulfill({
					status: 500,
					contentType: "application/json",
					body: JSON.stringify({ error: "Blocked" }),
				});
			} else {
				await route.continue();
			}
		});

		// Операция 1: меняем приоритет MEDIUM → HIGH
		const card = page.getByTestId(`task-card-${task.id}`);
		await card.hover();
		await page.getByTestId(`edit-btn-${task.id}`).click();
		await expect(page.getByTestId("modal")).toBeVisible();
		await page.getByTestId("task-priority-select").selectOption("HIGH");
		await page.getByTestId("modal-submit-btn").click();
		await expect(page.getByTestId("modal")).not.toBeVisible();

		// BUG: НЕ ждём rollback op1.
		// useTasks ещё не пересоздал updateTask с новым tasks.
		// op2 захватит stale closure с prev={HIGH}.

		// Операция 2: меняем статус BACKLOG → IN_PROGRESS
		await card.hover();
		await page.getByTestId(`edit-btn-${task.id}`).click();
		await expect(page.getByTestId("modal")).toBeVisible();
		await page.getByTestId("task-status-select").selectOption("IN_PROGRESS");
		await page.getByTestId("modal-submit-btn").click();
		await expect(page.getByTestId("modal")).not.toBeVisible();

		// Ждём хотя бы одного error toast
		await expect(page.getByTestId("toast-error")).toBeVisible();
		await page.waitForTimeout(300); // нестабильная пауза — часть флакинесса

		// ОЖИДАЕМ: BACKLOG + MEDIUM (original)
		// РЕАЛЬНО (при stale closure): BACKLOG + HIGH или IN_PROGRESS + HIGH
		await expect(
			page.getByTestId("column-backlog").getByText("Cascade Target"),
		).toBeVisible();

		// Это assertion может упасть из-за stale closure:
		// priority-badge может показывать "High" вместо "Medium"
		await expect(page.getByTestId(`priority-badge-${task.id}`)).toHaveText(
			"Medium",
		);
	});

	// ─────────────────────────────────────────────────────────────────────
	// [STABLE] — ждём каждый rollback перед следующей операцией
	//
	// ПОЧЕМУ СТАБИЛЬНО:
	//   После error toast мы знаем:
	//     1. Сервер ответил 500
	//     2. React выполнил setTasks(rollback)
	//     3. useCallback пересоздал updateTask с актуальным tasks
	//   Следующая операция захватит корректный prev.
	// ─────────────────────────────────────────────────────────────────────
	test("[STABLE] последовательные rollback — ждём каждый toast", async ({
		page,
	}) => {
		const task = await createTaskViaAPI(page, {
			title: "Stable Cascade",
			status: "BACKLOG",
			priority: "MEDIUM",
		});
		await page.reload();
		await waitForBoard(page);

		await page.route(`**/api/tasks/${task.id}`, async (route) => {
			if (route.request().method() === "PATCH") {
				await route.fulfill({
					status: 500,
					contentType: "application/json",
					body: JSON.stringify({ error: "Cascade block" }),
				});
			} else {
				await route.continue();
			}
		});

		// Операция 1: MEDIUM → HIGH
		const card = page.getByTestId(`task-card-${task.id}`);
		await card.hover();
		await page.getByTestId(`edit-btn-${task.id}`).click();
		await expect(page.getByTestId("modal")).toBeVisible();
		await page.getByTestId("task-priority-select").selectOption("HIGH");
		await page.getByTestId("modal-submit-btn").click();
		await expect(page.getByTestId("modal")).not.toBeVisible();

		// FIX: ждём error toast — сигнал что rollback завершён
		await expect(page.getByTestId("toast-error")).toBeVisible();
		// Дожидаемся исчезновения: React перерендерил, updateTask пересоздан
		await expect(page.getByTestId("toast-error")).not.toBeVisible({
			timeout: 5_500,
		});

		// Операция 2: BACKLOG → IN_PROGRESS
		await card.hover();
		await page.getByTestId(`edit-btn-${task.id}`).click();
		await expect(page.getByTestId("modal")).toBeVisible();
		await page.getByTestId("task-status-select").selectOption("IN_PROGRESS");
		await page.getByTestId("modal-submit-btn").click();
		await expect(page.getByTestId("modal")).not.toBeVisible();

		// FIX: ждём второй rollback
		await expect(page.getByTestId("toast-error")).toBeVisible();
		await expect(page.getByTestId("toast-error")).not.toBeVisible({
			timeout: 5_500,
		});

		// DOM в исходном состоянии: BACKLOG + MEDIUM
		await expect(
			page.getByTestId("column-backlog").getByText("Stable Cascade"),
		).toBeVisible();
		await expect(page.getByTestId(`priority-badge-${task.id}`)).toHaveText(
			"Medium",
		);
	});

	// ─────────────────────────────────────────────────────────────────────
	// [STRESS] — 5 rollback'ов подряд, финальный state = original
	//
	// Максимальная нагрузка на D-category:
	//   5 операций → 5 оптимистичных обновлений → 5 rollback'ов.
	//   Каждый rollback ждём явно перед следующей операцией.
	//   Финальное состояние должно совпадать с initial state.
	// ─────────────────────────────────────────────────────────────────────
	test("[STRESS] 5 rollback'ов подряд — финальный state = original", async ({
		page,
	}) => {
		const task = await createTaskViaAPI(page, {
			title: "Five Rollbacks",
			status: "BACKLOG",
			priority: "LOW",
		});
		await page.reload();
		await waitForBoard(page);

		await page.route(`**/api/tasks/${task.id}`, async (route) => {
			if (route.request().method() === "PATCH") {
				await route.fulfill({
					status: 500,
					contentType: "application/json",
					body: JSON.stringify({ error: "Stress block" }),
				});
			} else {
				await route.continue();
			}
		});

		// 5 операций — чередуем priority и status изменения
		const operations: Array<
			| { field: "priority"; value: "HIGH" | "MEDIUM" | "LOW" }
			| {
					field: "status";
					value: "IN_PROGRESS" | "REVIEW" | "DONE" | "BACKLOG";
			  }
		> = [
			{ field: "priority", value: "HIGH" },
			{ field: "status", value: "IN_PROGRESS" },
			{ field: "priority", value: "MEDIUM" },
			{ field: "status", value: "REVIEW" },
			{ field: "priority", value: "HIGH" },
		];

		for (let i = 0; i < operations.length; i++) {
			const op = operations[i];
			const card = page.getByTestId(`task-card-${task.id}`);
			await card.hover();
			await page.getByTestId(`edit-btn-${task.id}`).click();
			await expect(page.getByTestId("modal")).toBeVisible();

			if (op.field === "priority") {
				await page.getByTestId("task-priority-select").selectOption(op.value);
			} else {
				await page.getByTestId("task-status-select").selectOption(op.value);
			}

			await page.getByTestId("modal-submit-btn").click();
			await expect(page.getByTestId("modal")).not.toBeVisible();

			// Ждём rollback перед следующей операцией
			await expect(page.getByTestId("toast-error")).toBeVisible();
			await expect(page.getByTestId("toast-error")).not.toBeVisible({
				timeout: 5_500,
			});

			console.log(`[STRESS 09] Rollback ${i + 1}/${operations.length} done`);
		}

		// После 5 rollback'ов: задача в исходном состоянии BACKLOG + LOW
		await expect(
			page.getByTestId("column-backlog").getByText("Five Rollbacks"),
		).toBeVisible();

		await expect(page.getByTestId(`priority-badge-${task.id}`)).toHaveText(
			"Low",
		);
	});

	// ─────────────────────────────────────────────────────────────────────
	// [STRESS] — rollback при удалении 3 задач, DOM isolation
	//
	// Проверяем что rollback удаления одной задачи
	// не влияет на остальные задачи в том же столбце.
	// ─────────────────────────────────────────────────────────────────────
	test("[STRESS] rollback удаления 3 задач — DOM isolation", async ({
		page,
	}) => {
		const tasks = await Promise.all([
			createTaskViaAPI(page, { title: "Rollback Task 1", status: "BACKLOG" }),
			createTaskViaAPI(page, { title: "Rollback Task 2", status: "BACKLOG" }),
			createTaskViaAPI(page, { title: "Rollback Task 3", status: "BACKLOG" }),
		]);
		await page.reload();
		await waitForBoard(page);

		// Блокируем DELETE для всех трёх
		for (const task of tasks) {
			await page.route(`**/api/tasks/${task.id}`, async (route) => {
				if (route.request().method() === "DELETE") {
					await route.fulfill({
						status: 500,
						contentType: "application/json",
						body: JSON.stringify({ error: "Cannot delete" }),
					});
				} else {
					await route.continue();
				}
			});
		}

		// Удаляем последовательно, ждём rollback после каждой
		for (const task of tasks) {
			const card = page.getByTestId(`task-card-${task.id}`);
			await card.hover();
			await page.getByTestId(`delete-btn-${task.id}`).click();

			// FIX: ждём rollback
			await expect(page.getByTestId("toast-error")).toBeVisible();
			await expect(page.getByTestId("toast-error")).not.toBeVisible({
				timeout: 5_500,
			});

			// Карточка восстановилась
			await expect(card).toBeVisible();
		}

		// Все 3 карточки на месте
		await expect(
			page.getByTestId("column-backlog").locator('[data-testid^="task-card-"]'),
		).toHaveCount(3);
	});
});
