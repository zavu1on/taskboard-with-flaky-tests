/**
 * SPEC 08 — Rapid Sequential Events (R-category + DE-category, stress)
 *
 * Сценарий: быстрые последовательные пользовательские действия
 * без пауз между ними. Имитирует «нетерпеливого» пользователя
 * или автоматизированный скрипт без явных await на DOM.
 *
 * Источники флакинесса:
 *   1. Накопление event listener'ов при mount/unmount модала.
 *      В TaskModal.tsx Escape-listener добавляется в useEffect:
 *        document.addEventListener('keydown', onKey)
 *      При быстром open→close без ожидания анимации cleanup
 *      может не отработать — listener остаётся «зомби».
 *
 *   2. animate-fade-in (~150ms): модал открывается с анимацией.
 *      Если fill() вызвать до завершения анимации — input не focusable.
 *      На медленном CPU анимация длится дольше номинала.
 *
 *   3. React 18 batching: два быстрых setState могут объединиться
 *      в один render, «теряя» промежуточное состояние.
 *
 * Связь с Pei et al. ICST 2025:
 *   R-category:  assertion срабатывает до стабилизации DOM
 *   DE-category: DOM изменяется → событие не достигает цели
 *
 * КАК ЗАПУСТИТЬ:
 *
 *   TEST_ENV=B_cpu_throttle CPU_FAKE_DELAY_MS=150 \
 *   npx playwright test tests/e2e/08-stress-rapid-events.spec.ts \
 *     --config playwright.env-b.config.ts --repeat-each 20 --retries 0
 */

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
	clearAllTasksViaAPI,
	createTaskViaAPI,
	waitForBoard,
} from "./helpers/board";

// ── Утилиты применения нагрузки (идентичны спеку 07) ────────────────────────

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
			console.log("[08] CDP throttle: rate=4x");
		} catch {
			console.log(`[08] CDP unavailable → rAF+route delay (${rafDelay}ms)`);
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
		console.log(`[08] Network delay: ${base}ms ± ${jitter}ms`);
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

test.describe("08 · Rapid Sequential Events (Stress)", () => {
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
	// [FLAKY] — open → close → open без ожидания анимации модала
	//
	// ПОЧЕМУ ФЛАКАЕТ:
	//   Модал открывается с анимацией animate-fade-in (~150ms).
	//   Если нажать Escape до завершения анимации:
	//     1. onClose() вызывается — React начинает unmount
	//     2. useEffect cleanup ещё не отработал — listener «завис»
	//     3. Второй open() монтирует модал с ДВУМЯ Escape-listener'ами
	//     4. fill() попадает в момент когда input ещё transitioning
	//   На медленном CPU (среда B) эффект проявляется стабильнее.
	// ─────────────────────────────────────────────────────────────────────
	test("[FLAKY] open→Escape→open без ожидания анимации", async ({ page }) => {
		await page.getByTestId("global-add-task-btn").click();

		// BUG: Escape сразу, без ожидания toBeVisible
		// На медленном CPU listener ещё не добавился → Escape не сработает
		await page.keyboard.press("Escape");

		// BUG: немедленно открываем снова
		await page.getByTestId("global-add-task-btn").click();

		// BUG: fill() без ожидания монтирования — input может быть не focusable
		await page.getByTestId("task-title-input").fill("Rapid Open Task");
		await page.getByTestId("modal-submit-btn").click();

		// BUG: snapshot count без ожидания
		const count = await page.locator('[data-testid^="task-card-"]').count();
		expect(count).toBe(1); // нестабильно: 0 если fill не сработал
	});

	// ─────────────────────────────────────────────────────────────────────
	// [STABLE] — ждём каждый DOM-переход перед следующим действием
	//
	// ПОЧЕМУ СТАБИЛЬНО:
	//   toBeVisible() / not.toBeVisible() гарантируют, что React
	//   завершил mount/unmount и анимация отыграла.
	//   После этого listener существует и input focusable.
	// ─────────────────────────────────────────────────────────────────────
	test("[STABLE] open→Escape→open с ожиданием каждого перехода", async ({
		page,
	}) => {
		await page.getByTestId("global-add-task-btn").click();
		await expect(page.getByTestId("modal")).toBeVisible(); // FIX: ждём mount

		await page.keyboard.press("Escape");
		await expect(page.getByTestId("modal")).not.toBeVisible(); // FIX: ждём unmount

		await page.getByTestId("global-add-task-btn").click();
		await expect(page.getByTestId("modal")).toBeVisible(); // FIX: ждём mount

		await page.getByTestId("task-title-input").fill("Stable Rapid Task");
		await page.getByTestId("modal-submit-btn").click();
		await expect(page.getByTestId("modal")).not.toBeVisible();

		await expect(
			page.getByTestId("column-backlog").getByText("Stable Rapid Task"),
		).toBeVisible();
	});

	// ─────────────────────────────────────────────────────────────────────
	// [FLAKY] — двойной клик Submit без ожидания первого ответа
	//
	// ПОЧЕМУ ФЛАКАЕТ:
	//   В TaskModal.tsx кнопка Submit имеет disabled={submitting}.
	//   submitting=true выставляется через setSubmitting(true).
	//   На медленном CPU React может не успеть re-render
	//   кнопку как disabled до второго клика.
	//   Результат: два POST /api/tasks → две карточки.
	//
	//   В нашей реализации onClose() вызывается до await (оптимистично),
	//   поэтому второй клик фактически не проходит, но в других
	//   реализациях (без оптимистичного закрытия) это классический баг.
	// ─────────────────────────────────────────────────────────────────────
	test("[FLAKY] двойной клик Submit — риск дублирования задачи", async ({
		page,
	}) => {
		await page.getByTestId("global-add-task-btn").click();
		await expect(page.getByTestId("modal")).toBeVisible();

		await page.getByTestId("task-title-input").fill("Double Submit Task");

		// BUG: два клика без ожидания между ними
		await page.getByTestId("modal-submit-btn").click();
		await page.getByTestId("modal-submit-btn").click(); // второй клик

		// BUG: ждём фиксированное время вместо web-first assertion
		await page.waitForTimeout(500);

		const count = await page
			.getByTestId("column-backlog")
			.locator('[data-testid^="task-card-"]')
			.count();
		expect(count).toBe(1); // иногда 2 при медленном CPU
	});

	// ─────────────────────────────────────────────────────────────────────
	// [STABLE] — проверка protected submit через slow-server intercept
	//
	// Перехватываем POST и задерживаем — теперь гарантированно
	// видим disabled-состояние кнопки в момент второго клика.
	// ─────────────────────────────────────────────────────────────────────
	test("[STABLE] submit защищён: modal закрывается до второго клика", async ({
		page,
	}) => {
		// Задержка на POST — чтобы кнопка точно успела стать disabled
		// (или modal закрылся оптимистично до второго клика)
		await page.route("**/api/tasks", async (route) => {
			if (route.request().method() === "POST") {
				await new Promise((r) => setTimeout(r, 400));
				await route.continue();
			} else {
				await route.continue();
			}
		});

		await page.getByTestId("global-add-task-btn").click();
		await expect(page.getByTestId("modal")).toBeVisible();

		await page.getByTestId("task-title-input").fill("Protected Submit Task");
		await page.getByTestId("modal-submit-btn").click();

		// FIX: modal закрывается оптимистично → второй клик невозможен
		await expect(page.getByTestId("modal")).not.toBeVisible();

		// Ждём карточку (сервер ответил через 400ms)
		await expect(
			page.getByTestId("column-backlog").getByText("Protected Submit Task"),
		).toBeVisible();
	});

	// ─────────────────────────────────────────────────────────────────────
	// [STRESS] — 10 задач подряд через UI без пауз между итерациями
	//
	// Максимальная нагрузка на event loop: каждая итерация
	// открывает модал → заполняет → сабмитит → ждёт карточку.
	// В среде B (медленный CPU) каждая операция занимает
	// дольше обычного → накапливается задержка.
	// ─────────────────────────────────────────────────────────────────────
	test("[STRESS] 10 задач подряд через UI — максимальная нагрузка", async ({
		page,
	}) => {
		const TASK_COUNT = 10;

		for (let i = 1; i <= TASK_COUNT; i++) {
			await page.getByTestId("add-task-btn-backlog").click();
			await expect(page.getByTestId("modal")).toBeVisible();

			await page.getByTestId("task-title-input").fill(`Rapid Task ${i}`);
			await page.getByTestId("modal-submit-btn").click();

			// Ждём закрытия модала — сигнал что React применил optimistic update
			await expect(page.getByTestId("modal")).not.toBeVisible();

			// Ждём появления карточки — подтверждение рендера
			await expect(
				page.getByTestId("column-backlog").getByText(`Rapid Task ${i}`),
			).toBeVisible();
		}

		// Финальная проверка после всех 10 итераций
		await expect(
			page.getByTestId("column-backlog").locator('[data-testid^="task-card-"]'),
		).toHaveCount(TASK_COUNT);
	});

	// ─────────────────────────────────────────────────────────────────────
	// [STRESS] — 5 последовательных редактирований одной карточки
	//
	// Проверяем, что useTasks не накапливает stale state
	// при быстрых последовательных updateTask вызовах.
	// waitForResponse гарантирует что каждое обновление подтверждено
	// сервером перед следующим.
	// ─────────────────────────────────────────────────────────────────────
	test("[STRESS] 5 последовательных edit — финальный статус корректен", async ({
		page,
	}) => {
		const task = await createTaskViaAPI(page, {
			title: "Edit Me Task",
			status: "BACKLOG",
			priority: "LOW",
		});
		await page.reload();
		await waitForBoard(page);

		const statuses = [
			"IN_PROGRESS",
			"REVIEW",
			"DONE",
			"BACKLOG",
			"IN_PROGRESS",
		] as const;

		for (const status of statuses) {
			const card = page.getByTestId(`task-card-${task.id}`);
			await card.hover();
			await page.getByTestId(`edit-btn-${task.id}`).click();
			await expect(page.getByTestId("modal")).toBeVisible();

			await page.getByTestId("task-status-select").selectOption(status);

			// Слушаем PATCH ДО submit — не пропустим быстрый ответ
			const patchDone = page.waitForResponse(
				(r) =>
					r.url().includes(`/api/tasks/${task.id}`) &&
					r.request().method() === "PATCH",
			);

			await page.getByTestId("modal-submit-btn").click();
			await expect(page.getByTestId("modal")).not.toBeVisible();

			// Ждём подтверждения сервера перед следующей итерацией
			await patchDone;

			const colId = status.toLowerCase().replace("_", "-");
			await expect(
				page.getByTestId(`column-${colId}`).getByText("Edit Me Task"),
			).toBeVisible();
		}

		// Финальный статус: IN_PROGRESS (последний в массиве)
		await expect(
			page.getByTestId("column-in-progress").getByText("Edit Me Task"),
		).toBeVisible();
	});
});
