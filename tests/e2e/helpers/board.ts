import { expect, type Page } from "@playwright/test";

/** Wait for the board to finish loading (skeleton disappears) */
export async function waitForBoard(page: Page) {
	await expect(page.getByTestId("board-loading")).not.toBeVisible({
		timeout: 10_000,
	});
	await expect(page.getByTestId("board")).toBeVisible();
}

/** Open the "New Task" modal for a specific column */
export async function openCreateModal(
	page: Page,
	columnStatus: string = "backlog",
) {
	await page.getByTestId(`add-task-btn-${columnStatus}`).click();
	await expect(page.getByTestId("modal")).toBeVisible();
}

/** Fill in and submit the task creation modal */
export async function createTaskViaModal(
	page: Page,
	options: {
		title: string;
		description?: string;
		priority?: "LOW" | "MEDIUM" | "HIGH";
		status?: string;
	},
) {
	await page.getByTestId("task-title-input").fill(options.title);
	if (options.description) {
		await page.getByTestId("task-description-input").fill(options.description);
	}
	if (options.priority) {
		await page
			.getByTestId("task-priority-select")
			.selectOption(options.priority);
	}
	if (options.status) {
		await page.getByTestId("task-status-select").selectOption(options.status);
	}
	await page.getByTestId("modal-submit-btn").click();
}

/** Get all task cards in a specific column */
export function getColumnCards(page: Page, columnStatus: string) {
	return page
		.getByTestId(`column-${columnStatus}`)
		.locator('[data-testid^="task-card-"]');
}

/** Wait for a specific task to appear in a column */
export async function expectTaskInColumn(
	page: Page,
	title: string,
	columnStatus: string,
) {
	const column = page.getByTestId(`column-${columnStatus}`);
	await expect(column.getByText(title)).toBeVisible();
}

/** Wait for a toast of a specific type to appear, then disappear */
export async function expectToast(
	page: Page,
	type: "success" | "error" | "info",
) {
	const toast = page.getByTestId(`toast-${type}`);
	await expect(toast).toBeVisible();
	return toast;
}

export async function dndDrag(
	page: Page,
	sourceTestId: string,
	targetTestId: string,
) {
	const source = page.getByTestId(sourceTestId);
	const target = page.getByTestId(targetTestId);

	const srcBox = await source.boundingBox();
	const tgtBox = await target.boundingBox();
	if (!srcBox || !tgtBox)
		throw new Error(
			`dndDrag: element not found (${sourceTestId} -> ${targetTestId})`,
		);

	const sx = srcBox.x + srcBox.width / 2;
	const sy = srcBox.y + srcBox.height / 2;
	const tx = tgtBox.x + tgtBox.width / 2;
	const ty = tgtBox.y + tgtBox.height / 2;

	await page.mouse.move(sx, sy);
	await page.mouse.down();

	await page.mouse.move(sx + 8, sy + 2, { steps: 3 });

	await page.mouse.move(tx, ty, { steps: 20 });
	await page.mouse.up();
}

export async function createTaskViaAPI(
	page: Page,
	data: {
		title: string;
		status?: string;
		priority?: string;
		description?: string;
	},
): Promise<{ id: string; title: string; status: string }> {
	const response = await page.request.post("/api/tasks", {
		data: {
			title: data.title,
			status: data.status ?? "BACKLOG",
			priority: data.priority ?? "MEDIUM",
			description: data.description ?? null,
		},
	});
	expect(response.status()).toBe(201);
	return response.json();
}

export async function deleteTaskViaAPI(page: Page, id: string) {
	const response = await page.request.delete(`/api/tasks/${id}`);
	expect(response.status()).toBe(200);
}

export async function clearAllTasksViaAPI(page: Page) {
	const res = await page.request.get("/api/tasks");
	const tasks: Array<{ id: string }> = await res.json();
	await Promise.all(tasks.map((t) => deleteTaskViaAPI(page, t.id)));
}
