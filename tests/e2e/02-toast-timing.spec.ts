/**
 * SPEC 02 - Response/Assertion Timing (R-category, Pei et al. ICST 2025)
 *
 * Toast уведомление появляется с CSS-анимацией (~200ms) и исчезает через 4с.
 * Это типичный R-type flakiness: assertion срабатывает против DOM,
 * который ещё не перешёл в ожидаемое состояние.
 */

import { expect, test } from "@playwright/test";
import {
	clearAllTasksViaAPI,
	openCreateModal,
	waitForBoard,
} from "./helpers/board";

test.describe("02 · Toast Assertion Timing", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await waitForBoard(page);
		await clearAllTasksViaAPI(page);
		await page.reload();
		await waitForBoard(page);
	});

	// FLAKY - snapshot assertion против анимированного элемента
	test("[FLAKY] snapshot-проверка toast сразу после клика", async ({
		page,
	}) => {
		await openCreateModal(page, "backlog");
		await page.getByTestId("task-title-input").fill("Toast Flaky Task");
		await page.getByTestId("modal-submit-btn").click();

		// ПРОБЛЕМА: toast рендерится с анимацией animate-slide-in (~200ms).
		// isVisible() - мгновенный snapshot, не ждёт анимации.
		// На медленных машинах / CI -> false negative.
		const isVisible = await page.getByTestId("toast-success").isVisible();
		expect(isVisible).toBe(true); // может быть false при медленном рендере
	});

	// STABLE - web-first assertion, ждёт завершения анимации
	test("[STABLE] web-first assertion ждёт toast в DOM", async ({ page }) => {
		await openCreateModal(page, "backlog");
		await page.getByTestId("task-title-input").fill("Toast Stable Task");
		await page.getByTestId("modal-submit-btn").click();

		// РЕШЕНИЕ: expect().toBeVisible() polling - ретраит каждые ~100ms.
		// Playwright ждёт до actionTimeout (10с) включая время анимации.
		await expect(page.getByTestId("toast-success")).toBeVisible();
	});

	// STABLE - проверяем полный lifecycle toast (появление + исчезновение)
	// Это важно для тестирования auto-dismiss логики
	test("[STABLE] toast появляется и исчезает через 4 секунды", async ({
		page,
	}) => {
		await openCreateModal(page, "backlog");
		await page.getByTestId("task-title-input").fill("Lifecycle Task");
		await page.getByTestId("modal-submit-btn").click();

		// Шаг 1: ждём появление
		const toast = page.getByTestId("toast-success");
		await expect(toast).toBeVisible();

		// Шаг 2: ждём исчезновение (auto-dismiss = 4000ms + анимация ~200ms)
		await expect(toast).not.toBeVisible({ timeout: 5_500 });
	});

	// STABLE - error toast при попытке создать задачу без title
	test("[STABLE] ✅ показывает inline ошибку при пустом title", async ({
		page,
	}) => {
		await openCreateModal(page, "backlog");
		// НЕ заполняем title
		await page.getByTestId("modal-submit-btn").click();

		// Inline validation error - появляется синхронно
		await expect(page.getByTestId("title-error")).toBeVisible();
		// Модальное окно остаётся открытым
		await expect(page.getByTestId("modal")).toBeVisible();
	});

	// STABLE - проверяем error toast при API-ошибке (через route intercept)
	test("[STABLE] error toast при сбое сервера (intercepted)", async ({
		page,
	}) => {
		// Перехватываем POST /api/tasks и возвращаем 500
		await page.route("**/api/tasks", async (route) => {
			if (route.request().method() === "POST") {
				await route.fulfill({
					status: 500,
					contentType: "application/json",
					body: JSON.stringify({ error: "Internal Server Error" }),
				});
			} else {
				await route.continue();
			}
		});

		await openCreateModal(page, "backlog");
		await page.getByTestId("task-title-input").fill("Will Fail Task");
		await page.getByTestId("modal-submit-btn").click();

		// Карточка исчезает из UI (optimistic rollback)
		await expect(
			page.getByTestId("column-backlog").getByText("Will Fail Task"),
		).not.toBeVisible();

		// Error toast появляется
		await expect(page.getByTestId("toast-error")).toBeVisible();
	});
});
