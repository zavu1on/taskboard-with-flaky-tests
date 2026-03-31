/**
 * SPEC 04 - Optimistic UI + Server Rollback (реальный production-кейс)
 *           R-category + ED-category (Pei et al. ICST 2025)
 *
 * Паттерн: клиент применяет изменение немедленно (optimistic update),
 * затем сервер подтверждает или откатывает его.
 *
 * Источник флакинесса: тест проверяет DOM в момент
 * МЕЖДУ optimistic state и rollback state.
 * Это классическая «мерцающая» нестабильность - тест видит
 * временное состояние, которое не является ни ошибкой, ни успехом.
 *
 * Реальный аналог: wp-calypso, metamask-extension (9+ DOM commits в датасете)
 */

import { expect, test } from "@playwright/test";
import {
	clearAllTasksViaAPI,
	createTaskViaAPI,
	waitForBoard,
} from "./helpers/board";

test.describe("04 · Optimistic UI + Rollback", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await waitForBoard(page);
		await clearAllTasksViaAPI(page);
		await page.reload();
		await waitForBoard(page);
	});

	// FLAKY - тест ловит промежуточное optimistic-состояние
	// ОЖИДАЕМОЕ ПОВЕДЕНИЕ: нестабильный результат.
	// Иногда проходит (поймал rollback), иногда падает (поймал optimistic).
	// Запустите: npx playwright test 04 --repeat-each 10 --retries 0
	test("[FLAKY] assertion в момент между optimistic и rollback", async ({
		page,
	}) => {
		const task = await createTaskViaAPI(page, {
			title: "Optimistic Task",
			status: "BACKLOG",
		});
		await page.reload();
		await waitForBoard(page);

		// Сервер возвращает 500 без задержки.
		// Rollback случится асинхронно - мы не знаем точно когда
		// относительно нашего count() ниже.
		await page.route(`**/api/tasks/${task.id}`, async (route) => {
			if (route.request().method() === "PATCH") {
				await route.fulfill({
					status: 500,
					contentType: "application/json",
					body: JSON.stringify({ error: "Server Error" }),
				});
			} else {
				await route.continue();
			}
		});

		// Кликаем Edit -> меняем статус
		const card = page.getByTestId(`task-card-${task.id}`);
		await card.hover();
		await page.getByTestId(`edit-btn-${task.id}`).click();
		await expect(page.getByTestId("modal")).toBeVisible();
		await page.getByTestId("task-status-select").selectOption("IN_PROGRESS");
		await page.getByTestId("modal-submit-btn").click();
		await expect(page.getByTestId("modal")).not.toBeVisible();

		// ПРОБЛЕМА: count() - мгновенный snapshot, не ретраит.
		// DOM может быть в одном из двух состояний:
		//  - count = 1: optimistic update применился, rollback ещё не пришёл
		//  - count = 0: rollback уже произошёл
		// Результат непредсказуем - зависит от скорости JS event loop.
		const inProgressCount = await page
			.getByTestId("column-in-progress")
			.locator('[data-testid^="task-card-"]')
			.count();
		expect(inProgressCount).toBe(0); // иногда 0 (rollback), иногда 1 (optimistic) -> флакинесс
	});

	// STABLE - ждём стабильного DOM-состояния после rollback
	test("[STABLE] ждёт финального DOM-состояния после rollback", async ({
		page,
	}) => {
		const task = await createTaskViaAPI(page, {
			title: "Rollback Task",
			status: "BACKLOG",
		});
		await page.reload();
		await waitForBoard(page);

		// Имитируем серверную ошибку при обновлении
		await page.route(`**/api/tasks/${task.id}`, async (route) => {
			if (route.request().method() === "PATCH") {
				await route.fulfill({
					status: 500,
					contentType: "application/json",
					body: JSON.stringify({ error: "Internal Server Error" }),
				});
			} else {
				await route.continue();
			}
		});

		// Открываем редактирование и меняем статус
		const card = page.getByTestId(`task-card-${task.id}`);
		await card.hover();
		await page.getByTestId(`edit-btn-${task.id}`).click();
		await expect(page.getByTestId("modal")).toBeVisible();
		await page.getByTestId("task-status-select").selectOption("IN_PROGRESS");
		await page.getByTestId("modal-submit-btn").click();
		await expect(page.getByTestId("modal")).not.toBeVisible();

		// РЕШЕНИЕ шаг 1: ждём error toast - это сигнал, что rollback завершён
		await expect(page.getByTestId("toast-error")).toBeVisible();

		// РЕШЕНИЕ шаг 2: теперь DOM стабилен - проверяем финальное состояние
		await expect(
			page.getByTestId("column-backlog").getByText("Rollback Task"),
		).toBeVisible();
		await expect(
			page.getByTestId("column-in-progress").getByText("Rollback Task"),
		).not.toBeVisible();
	});

	// STABLE - успешное обновление (happy path)
	test("[STABLE] успешный переход статуса через modal", async ({ page }) => {
		const task = await createTaskViaAPI(page, {
			title: "Happy Path Task",
			status: "BACKLOG",
		});
		await page.reload();
		await waitForBoard(page);

		const card = page.getByTestId(`task-card-${task.id}`);
		await card.hover();
		await page.getByTestId(`edit-btn-${task.id}`).click();
		await expect(page.getByTestId("modal")).toBeVisible();

		await page.getByTestId("task-status-select").selectOption("REVIEW");
		await page.getByTestId("modal-submit-btn").click();
		await expect(page.getByTestId("modal")).not.toBeVisible();

		// Ждём success toast - сигнал завершения транзакции
		await expect(page.getByTestId("toast-success")).toBeVisible();

		// Карточка в правильной колонке
		await expect(
			page.getByTestId("column-review").getByText("Happy Path Task"),
		).toBeVisible();
		await expect(
			page.getByTestId("column-backlog").getByText("Happy Path Task"),
		).not.toBeVisible();
	});

	// STABLE - удаление с оптимистичным rollback
	test("[STABLE] удаление задачи с rollback при ошибке сервера", async ({
		page,
	}) => {
		const task = await createTaskViaAPI(page, {
			title: "Delete Rollback Task",
			status: "BACKLOG",
		});
		await page.reload();
		await waitForBoard(page);

		// Блокируем DELETE
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

		const card = page.getByTestId(`task-card-${task.id}`);
		await card.hover();
		await page.getByTestId(`delete-btn-${task.id}`).click();

		// ✅ После error toast карточка восстановилась
		await expect(page.getByTestId("toast-error")).toBeVisible();
		await expect(
			page.getByTestId("column-backlog").getByText("Delete Rollback Task"),
		).toBeVisible();
	});
});
