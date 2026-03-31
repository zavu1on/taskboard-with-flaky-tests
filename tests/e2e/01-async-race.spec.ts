/**
 * SPEC 01 - Async Race Condition (ED-category, Pei et al. ICST 2025)
 *
 * Демонстрирует нестабильность класса Event-DOM:
 * Click [Submit] -> fetch() -> DOM update
 */

import { expect, test } from "@playwright/test";
import {
	clearAllTasksViaAPI,
	openCreateModal,
	waitForBoard,
} from "./helpers/board";

test.describe("01 · Async Race Condition", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await waitForBoard(page);
		await clearAllTasksViaAPI(page);
		await page.reload();
		await waitForBoard(page);
	});

	// FLAKY TEST
	// Нарушение: isVisible() - snapshot assertion, не ретраит.
	// Падает, когда fetch + React render ещё не завершены.
	test("[FLAKY] проверяет карточку сразу после клика Submit", async ({
		page,
	}) => {
		await openCreateModal(page, "backlog");
		await page.getByTestId("task-title-input").fill("Race Condition Task");
		await page.getByTestId("modal-submit-btn").click();

		// ПРОБЛЕМА: modal может закрыться (optimistic update),
		// но реальная карточка с server-id ещё не пришла.
		// isVisible() делает ONE snapshot - не ретраит.
		const taskCards = page.locator('[data-testid^="task-card-"]');
		const isVisible = await taskCards.first().isVisible(); // ← snapshot, не web-first!
		expect(isVisible).toBe(true); // 🎲 нестабильно на медленном CI
	});

	// STABLE TEST - правильный подход
	// web-first assertion expect().toBeVisible() ретраит до таймаута.
	// Ждём конкретный элемент по тексту.
	test("[STABLE] ждёт появления конкретной карточки в DOM", async ({
		page,
	}) => {
		await openCreateModal(page, "backlog");
		await page.getByTestId("task-title-input").fill("Race Condition Task");
		await page.getByTestId("modal-submit-btn").click();

		// РЕШЕНИЕ: web-first assertion с auto-retry polling.
		// Playwright ретраит expect() каждые ~100ms до actionTimeout.
		// Ждём именно нашу карточку по тексту.
		await expect(
			page.getByTestId("column-backlog").getByText("Race Condition Task"),
		).toBeVisible();

		// Бонус: проверяем count после того как DOM устоялся
		const count = await page.locator('[data-testid^="task-card-"]').count();
		expect(count).toBe(1);
	});

	// STRESS TEST - запускаем сценарий 5 раз подряд (detect flakiness)
	// В CI заменяется на: npx playwright test --repeat-each 20
	test("[STRESS] создаёт 3 задачи подряд без гонок", async ({ page }) => {
		const titles = ["Task Alpha", "Task Beta", "Task Gamma"];

		for (const title of titles) {
			await openCreateModal(page, "backlog");
			await page.getByTestId("task-title-input").fill(title);
			await page.getByTestId("modal-submit-btn").click();

			// Ждём появление каждой карточки перед следующей итерацией
			await expect(
				page.getByTestId("column-backlog").getByText(title),
			).toBeVisible();
		}

		const count = await page
			.getByTestId("column-backlog")
			.locator('[data-testid^="task-card-"]')
			.count();
		expect(count).toBe(3);
	});
});
