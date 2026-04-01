/**
 * SPEC 06 - Delete & DOM Consistency (D-category, Pei et al. ICST 2025)
 *
 * D-category - самая долгоиграющая нестабильность (153.4 дня по данным статьи).
 * При удалении карточки: optimistic remove -> DOM update -> network DELETE.
 *
 * Источник флакинесса: после optimistic remove карточка исчезает немедленно,
 * но при rollback (ошибка сервера) появляется снова.
 * Тесты, которые проверяют absence of element без ожидания rollback - флакают.
 *
 * Второй источник: параллельные мутации DOM в момент удаления
 * (toast появляется, счётчик обновляется, карточка исчезает) -
 * три независимых DOM-обновления в одном render цикле.
 */

import { expect, test } from "@playwright/test";
import {
	clearAllTasksViaAPI,
	createTaskViaAPI,
	waitForBoard,
} from "./helpers/board";

test.describe("06 · Delete & DOM Consistency (D-category)", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await waitForBoard(page);
		await clearAllTasksViaAPI(page);
		await page.reload();
		await waitForBoard(page);
	});

	// FLAKY - проверяем absence карточки без ожидания сетевого запроса
	// D-category: элемент исчезает optimistically, но может вернуться
	test("[FLAKY] проверяет отсутствие карточки до завершения DELETE", async ({
		page,
	}) => {
		const task = await createTaskViaAPI(page, {
			title: "Delete Flaky",
			status: "BACKLOG",
		});
		await page.reload();
		await waitForBoard(page);

		// Искусственная задержка на DELETE (имитирует медленный CI)
		await page.route(`**/api/tasks/${task.id}`, async (route) => {
			if (route.request().method() === "DELETE") {
				await new Promise((r) => setTimeout(r, 1000)); // задержка 1с
				await route.continue();
			} else {
				await route.continue();
			}
		});

		const card = page.getByTestId(`task-card-${task.id}`);
		await card.hover();
		await page.getByTestId(`delete-btn-${task.id}`).click();

		// ПРОБЛЕМА: optimistic delete сразу убрал карточку из DOM,
		// но DELETE ещё в пути. Если этот тест проверяет absence -
		// он будет PASS даже если сервер потом вернёт ошибку.
		// Тест не валидирует реальное состояние системы.
		const isGone = await page.getByTestId(`task-card-${task.id}`).isVisible();
		expect(isGone).toBe(false); // проходит из-за optimistic, не из-за реального удаления
	});

	// STABLE - ждём сетевой запрос, затем проверяем финальный DOM
	test("[STABLE] ждёт DELETE response перед проверкой DOM", async ({
		page,
	}) => {
		const task = await createTaskViaAPI(page, {
			title: "Delete Stable",
			status: "BACKLOG",
		});
		await page.reload();
		await waitForBoard(page);

		const card = page.getByTestId(`task-card-${task.id}`);
		await card.hover();

		// Начинаем слушать DELETE перед кликом
		const deleteResponsePromise = page.waitForResponse(
			(r) =>
				r.url().includes(`/api/tasks/${task.id}`) &&
				r.request().method() === "DELETE",
		);

		await page.getByTestId(`delete-btn-${task.id}`).click();

		// Ждём подтверждения от сервера
		const deleteResponse = await deleteResponsePromise;
		expect(deleteResponse.status()).toBe(200);

		// Теперь DOM стабилен - карточки нет и это подтверждено сервером
		await expect(page.getByTestId(`task-card-${task.id}`)).not.toBeVisible();
		await expect(page.getByTestId("toast-success")).toBeVisible();
	});

	// STABLE - удаление нескольких задач с проверкой счётчика колонки
	// DOM consistency: count badge обновляется синхронно с карточками
	test("[STABLE] удаляет 3 задачи, счётчик колонки синхронизирован", async ({
		page,
	}) => {
		const tasks = await Promise.all([
			createTaskViaAPI(page, { title: "Task 1", status: "BACKLOG" }),
			createTaskViaAPI(page, { title: "Task 2", status: "BACKLOG" }),
			createTaskViaAPI(page, { title: "Task 3", status: "BACKLOG" }),
		]);
		await page.reload();
		await waitForBoard(page);

		// Проверяем начальный count
		const backlogColumn = page.getByTestId("column-backlog");
		await expect(
			backlogColumn.locator('[data-testid^="task-card-"]'),
		).toHaveCount(3);

		for (let i = 0; i < tasks.length; i++) {
			const task = tasks[i];
			const card = page.getByTestId(`task-card-${task.id}`);
			await card.hover();

			const deleteResponse = page.waitForResponse(
				(r) =>
					r.url().includes(`/api/tasks/${task.id}`) &&
					r.request().method() === "DELETE",
			);
			await page.getByTestId(`delete-btn-${task.id}`).click();
			await deleteResponse;

			// Ждём обновления DOM после каждого удаления
			const expectedCount = tasks.length - (i + 1);
			await expect(
				backlogColumn.locator('[data-testid^="task-card-"]'),
			).toHaveCount(expectedCount);
		}

		// Финальная проверка: empty state
		await expect(backlogColumn.getByText("Drop tasks here")).toBeVisible();
	});

	// STABLE - проверяем, что удаление задачи в одной колонке
	// не влияет на задачи в других колонках (DOM isolation test)
	test("[STABLE] удаление в Backlog не затрагивает другие колонки", async ({
		page,
	}) => {
		const [backlogTask, progressTask, reviewTask] = await Promise.all([
			createTaskViaAPI(page, { title: "Backlog Task", status: "BACKLOG" }),
			createTaskViaAPI(page, { title: "Progress Task", status: "IN_PROGRESS" }),
			createTaskViaAPI(page, { title: "Review Task", status: "REVIEW" }),
		]);
		await page.reload();
		await waitForBoard(page);

		// Удаляем только из Backlog
		const card = page.getByTestId(`task-card-${backlogTask.id}`);
		await card.hover();

		const deleteResponse = page.waitForResponse(
			(r) =>
				r.url().includes(`/api/tasks/${backlogTask.id}`) &&
				r.request().method() === "DELETE",
		);
		await page.getByTestId(`delete-btn-${backlogTask.id}`).click();
		await deleteResponse;

		// Backlog пустой
		await expect(
			page.getByTestId(`task-card-${backlogTask.id}`),
		).not.toBeVisible();

		// Другие колонки не затронуты
		await expect(
			page.getByTestId(`task-card-${progressTask.id}`),
		).toBeVisible();
		await expect(page.getByTestId(`task-card-${reviewTask.id}`)).toBeVisible();
	});
});
