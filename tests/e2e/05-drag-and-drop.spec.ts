/**
 * SPEC 05 - Drag & Drop (реальный production-кейс)
 *           ED-category + E-category (Pei et al. ICST 2025)
 *
 * Реальный прецедент: wp-calypso (9 DOM-related commits),
 * metamask-extension, sourcegraph (7 commits) - все используют DnD.
 *
 * Цепочка событий: pointerdown -> pointermove -> pointerup
 * Каждое событие может модифицировать DOM.
 *
 * ВАЖНО: @dnd-kit использует Pointer Events API, а НЕ HTML5 Drag API.
 * Playwright's page.dragTo() эмулирует HTML5 drag - @dnd-kit его не слышит.
 * Поэтому все DnD-операции делаем через page.mouse (pointer events).
 */

import { expect, test } from "@playwright/test";
import {
	clearAllTasksViaAPI,
	createTaskViaAPI,
	dndDrag,
	expectTaskInColumn,
	waitForBoard,
} from "./helpers/board";

test.describe("05 · Drag & Drop (Real Production Case)", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await waitForBoard(page);
		await clearAllTasksViaAPI(page);
		await page.reload();
		await waitForBoard(page);
	});

	//  FLAKY - count() сразу после drop, без ожидания React-рендера
	//     ОЖИДАЕМОЕ ПОВЕДЕНИЕ: нестабильный результат.
	//     count() - snapshot, может поймать DOM до или после optimistic update.
	//     Запустите: npx playwright test 05 --repeat-each 10 --retries 0
	test("[FLAKY] проверяет колонку сразу после drop", async ({ page }) => {
		const task = await createTaskViaAPI(page, {
			title: "DnD Flaky Task",
			status: "BACKLOG",
		});
		await page.reload();
		await waitForBoard(page);

		await dndDrag(page, `task-card-${task.id}`, "drop-zone-in-progress");

		// ПРОБЛЕМА: mouse.up() завершает drag, но React ещё не обновил DOM.
		// count() - мгновенный snapshot:
		//  - 1 если optimistic update уже применился
		//  - 0 если React рендер ещё не отработал
		// Результат зависит от скорости JS event loop на конкретной машине.
		const count = await page
			.getByTestId("column-in-progress")
			.locator('[data-testid^="task-card-"]')
			.count();
		expect(count).toBe(1);
	});

	// STABLE - ждём PATCH response + web-first assertion
	test("[STABLE] dndDrag + waitForResponse + web-first assertion", async ({
		page,
	}) => {
		const task = await createTaskViaAPI(page, {
			title: "DnD Stable Task",
			status: "BACKLOG",
		});
		await page.reload();
		await waitForBoard(page);

		// Начинаем слушать PATCH ДО drag - иначе можем пропустить быстрый ответ
		const patchResponsePromise = page.waitForResponse(
			(r) =>
				r.url().includes(`/api/tasks/${task.id}`) &&
				r.request().method() === "PATCH",
		);

		await dndDrag(page, `task-card-${task.id}`, "drop-zone-in-progress");

		// Ждём подтверждения от сервера - транзакция завершена
		const patchResponse = await patchResponsePromise;
		expect(patchResponse.status()).toBe(200);

		// DOM стабилен - web-first assertion с auto-retry
		await expectTaskInColumn(page, "DnD Stable Task", "in-progress");
		await expect(
			page.getByTestId("column-backlog").getByText("DnD Stable Task"),
		).not.toBeVisible();
	});

	// STABLE - DnD rollback при ошибке сервера
	test("[STABLE] DnD откатывается в исходную колонку при ошибке", async ({
		page,
	}) => {
		const task = await createTaskViaAPI(page, {
			title: "DnD Rollback Task",
			status: "BACKLOG",
		});
		await page.reload();
		await waitForBoard(page);

		await page.route(`**/api/tasks/${task.id}`, async (route) => {
			if (route.request().method() === "PATCH") {
				await route.fulfill({
					status: 500,
					body: JSON.stringify({ error: "Move failed" }),
					contentType: "application/json",
				});
			} else {
				await route.continue();
			}
		});

		await dndDrag(page, `task-card-${task.id}`, "drop-zone-in-progress");

		// Error toast - сигнал что rollback завершён
		await expect(page.getByTestId("toast-error")).toBeVisible();

		// Карточка вернулась в исходную колонку
		await expectTaskInColumn(page, "DnD Rollback Task", "backlog");
		await expect(
			page.getByTestId("column-in-progress").getByText("DnD Rollback Task"),
		).not.toBeVisible();
	});
});
