/**
 * SPEC 03 - Modal / Multiple DOM Contexts (DE-category, Pei et al. ICST 2025)
 *
 * Модальное окно монтируется в отдельном DOM-слое (portal).
 * Паттерн DE: DOM-изменение (открытие модала) -> триггер события (focus, keydown).
 *
 * Источник флакинесса: тест взаимодействует с элементами модала
 * до того, как тот полностью вмонтировался в DOM и получил focus.
 */

import { expect, test } from "@playwright/test";
import {
	clearAllTasksViaAPI,
	createTaskViaAPI,
	waitForBoard,
} from "./helpers/board";

test.describe("03 · Modal DOM Context", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await waitForBoard(page);
		await clearAllTasksViaAPI(page);
		await page.reload();
		await waitForBoard(page);
	});

	// FLAKY - взаимодействие с элементами модала без ожидания его монтирования
	test("[FLAKY] fill() вызывается до полного монтирования модала", async ({
		page,
	}) => {
		await page.getByTestId("global-add-task-btn").click();

		// ПРОБЛЕМА: модал монтируется с анимацией animate-fade-in (~150ms).
		// fill() попадает в момент, когда input ещё не focusable.
		// На быстрых машинах проходит, на CI с CPU throttling - падает.
		await page.getByTestId("task-title-input").fill("Premature Fill Task");
		await page.getByTestId("modal-submit-btn").click();

		// Assertion тоже без ожидания - double flakiness
		const cards = await page.locator('[data-testid^="task-card-"]').count();
		expect(cards).toBeGreaterThan(0); // 🎲 нестабильно
	});

	// STABLE - ждём полного монтирования модала перед взаимодействием
	test("[STABLE] ждёт modal в DOM перед fill()", async ({ page }) => {
		await page.getByTestId("global-add-task-btn").click();

		// РЕШЕНИЕ: явное ожидание модала.
		// Только после toBeVisible() мы знаем, что элементы доступны.
		await expect(page.getByTestId("modal")).toBeVisible();

		await page.getByTestId("task-title-input").fill("Proper Modal Task");
		await page.getByTestId("modal-submit-btn").click();

		// Ждём закрытия модала
		await expect(page.getByTestId("modal")).not.toBeVisible();

		// Ждём карточку
		await expect(
			page.getByTestId("column-backlog").getByText("Proper Modal Task"),
		).toBeVisible();
	});

	// STABLE - закрытие модала через Escape (DOM Event chain)
	test("[STABLE] Escape закрывает модал без потери данных на доске", async ({
		page,
	}) => {
		// Создаём задачу через API для изоляции
		await createTaskViaAPI(page, { title: "Existing Task", status: "BACKLOG" });
		await page.reload();
		await waitForBoard(page);

		await page.getByTestId("global-add-task-btn").click();
		await expect(page.getByTestId("modal")).toBeVisible();

		// Нажимаем Escape - триггерим keydown event
		await page.keyboard.press("Escape");

		// Модал закрылся
		await expect(page.getByTestId("modal")).not.toBeVisible();

		// Существующие карточки не пострадали
		await expect(
			page.getByTestId("column-backlog").getByText("Existing Task"),
		).toBeVisible();
	});

	// STABLE - редактирование задачи (edit modal)
	test("[STABLE] ✅ редактирование задачи через modal", async ({ page }) => {
		const task = await createTaskViaAPI(page, {
			title: "Original Title",
			status: "BACKLOG",
			priority: "LOW",
		});
		await page.reload();
		await waitForBoard(page);

		// Hover -> показываем кнопку Edit
		const card = page.getByTestId(`task-card-${task.id}`);
		await card.hover();

		// Кликаем Edit
		await page.getByTestId(`edit-btn-${task.id}`).click();

		// Ждём модал с предзаполненными данными
		await expect(page.getByTestId("modal")).toBeVisible();
		await expect(page.getByTestId("task-title-input")).toHaveValue(
			"Original Title",
		);

		// Меняем заголовок
		await page.getByTestId("task-title-input").clear();
		await page.getByTestId("task-title-input").fill("Updated Title");
		await page.getByTestId("modal-submit-btn").click();

		// Ждём закрытия и обновления карточки
		await expect(page.getByTestId("modal")).not.toBeVisible();
		await expect(
			page.getByTestId("column-backlog").getByText("Updated Title"),
		).toBeVisible();
		await expect(
			page.getByTestId("column-backlog").getByText("Original Title"),
		).not.toBeVisible();
	});

	// STABLE - клик на backdrop закрывает модал (DOM event on overlay)
	test("[STABLE] клик на backdrop закрывает модал", async ({ page }) => {
		await page.getByTestId("global-add-task-btn").click();
		await expect(page.getByTestId("modal")).toBeVisible();

		// Кликаем на backdrop (data-testid="modal-backdrop")
		await page
			.getByTestId("modal-backdrop")
			.click({ position: { x: 10, y: 10 } });

		await expect(page.getByTestId("modal")).not.toBeVisible();
	});
});
