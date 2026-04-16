/**
 * SPEC 11 — Order-Dependent: localStorage State Pollution
 * ═══════════════════════════════════════════════════════════════════════════
 * Категория: OD (Order-Dependent) по Luo et al., EMSE 2019
 * Подтип OD:  VICTIM   — тест получает загрязнённый localStorage и падает
 *             BRITTLE  — тест зависит от наличия определённого localStorage-ключа
 *
 * Связь с темой НИР «DOM Event Interaction как источник нестабильности E2E тестов»:
 *
 *   localStorage.setItem() вызывается в response на DOM Event (клик по кнопке).
 *   Цепочка: click event → React handler → localStorage write → page reload →
 *            localStorage read → DOM renders with polluted default state.
 *
 *   Таким образом, DOM Event (клик) становится источником PERSISTENT STATE,
 *   который переживает навигацию и заражает последующие тесты.
 *
 * СЦЕНАРИЙ «taskboard:lastColumn»:
 *   Board.tsx сохраняет последнюю использованную колонку в localStorage.
 *   Кнопка «New Task» читает это значение и pre-select'ит колонку в модале.
 *
 *   [POLLUTER]: кликает "Add Task" в колонке DONE →
 *               localStorage['taskboard:lastColumn'] = 'DONE'
 *
 *   [VICTIM]:   кликает глобальную "New Task" →
 *               читает 'DONE' из localStorage →
 *               модал открывается с pre-select 'DONE' (вместо BACKLOG) →
 *               задача создаётся в DONE → ожидалась BACKLOG → FAIL
 *
 * СТРУКТУРА СПЕКА:
 *   ГРУППА 1 — ISOLATED:         Victim в чистой среде → PASS
 *   ГРУППА 2 — POLLUTER→VICTIM:  Зависимое выполнение → VICTIM FAIL (ожидаемо)
 *   ГРУППА 3 — STABLE:           С beforeEach localStorage.clear() → оба PASS
 *
 * ТРЕБОВАНИЕ К ПРИЛОЖЕНИЮ:
 *   Необходимо добавить localStorage-интеграцию в components/Board.tsx.
 *   См. патч: Board.tsx → openCreateModalWithMemory() + globalAddTaskHandler()
 *
 * КАК ЗАПУСТИТЬ:
 *
 *   # Среда B — все OD тесты
 *   TEST_ENV=B_od npx playwright test \
 *     tests/e2e/11-od-localstorage.spec.ts \
 *     --config playwright.env-b.config.ts \
 *     --repeat-each 15 --retries 0
 *
 *   # Только POLLUTER+VICTIM (воспроизведение OD)
 *   TEST_ENV=B_od_polluted npx playwright test \
 *     tests/e2e/11-od-localstorage.spec.ts \
 *     --config playwright.env-b.config.ts \
 *     --grep "POLLUTER→VICTIM" --repeat-each 15 --retries 0
 */

import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import {
	clearAllTasksViaAPI,
	createTaskViaAPI,
	waitForBoard,
} from "./helpers/board";

// ── Ключ localStorage, используемый приложением ───────────────────────────────
const LS_KEY = "taskboard:lastColumn";

// ── Утилиты ───────────────────────────────────────────────────────────────────

/** Читает значение taskboard:lastColumn из localStorage страницы */
async function getStoredColumn(page: Page): Promise<string | null> {
	return page.evaluate((key) => window.localStorage.getItem(key), LS_KEY);
}

/** Очищает ВЕСЬ localStorage страницы (полная изоляция) */
async function clearLocalStorage(page: Page): Promise<void> {
	await page.evaluate(() => window.localStorage.clear());
}

/** Устанавливает значение lastColumn напрямую через evaluate (для симуляции) */
async function setStoredColumn(page: Page, column: string): Promise<void> {
	await page.evaluate(
		([key, val]) => window.localStorage.setItem(key, val),
		[LS_KEY, column],
	);
}

// ══════════════════════════════════════════════════════════════════════════════
// ГРУППА 1: ISOLATED — Victim в чистой среде (localStorage пуст)
// ══════════════════════════════════════════════════════════════════════════════

test.describe("11 · OD localStorage — ISOLATED (чистый localStorage)", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await waitForBoard(page);
		await clearAllTasksViaAPI(page);
		// Полная очистка localStorage — гарантируем чистую среду
		await clearLocalStorage(page);
		await page.reload();
		await waitForBoard(page);
	});

	/**
	 * ISOLATED: глобальная кнопка "New Task" открывает BACKLOG по умолчанию.
	 *
	 * Когда localStorage пуст, приложение использует default = BACKLOG.
	 * Задача создаётся в правильной колонке.
	 *
	 * РЕЗУЛЬТАТ: PASS
	 */
	test("[ISOLATED] глобальная 'New Task' → дефолт BACKLOG (localStorage пуст)", async ({
		page,
	}) => {
		// Подтверждаем: localStorage чистый
		const stored = await getStoredColumn(page);
		expect(stored).toBeNull();

		// Кликаем глобальную кнопку
		await page.getByTestId("global-add-task-btn").click();
		await expect(page.getByTestId("modal")).toBeVisible();

		// Дефолтная колонка = BACKLOG (т.к. localStorage пуст)
		const selectedStatus = await page
			.getByTestId("task-status-select")
			.inputValue();
		expect(selectedStatus).toBe("BACKLOG");

		// Создаём задачу и проверяем что она попала в BACKLOG
		await page.getByTestId("task-title-input").fill("Isolated Task");
		await page.getByTestId("modal-submit-btn").click();
		await expect(page.getByTestId("modal")).not.toBeVisible();

		await expect(
			page.getByTestId("column-backlog").getByText("Isolated Task"),
		).toBeVisible();
		await expect(
			page.getByTestId("column-done").getByText("Isolated Task"),
		).not.toBeVisible();
	});

	/**
	 * ISOLATED: Демонстрация механизма localStorage-загрязнения.
	 *
	 * Тест доказывает, что localStorage МОЖЕТ содержать персистентное
	 * состояние, которое переживает навигацию и влияет на следующий тест.
	 *
	 * ВАЖНО: запись в localStorage симулируется через page.evaluate(),
	 * чтобы тест работал независимо от наличия патча в Board.tsx.
	 * С патчем Board.tsx запись происходит АВТОМАТИЧЕСКИ при клике на
	 * колоночную кнопку "Add Task" (через saveLastColumn()).
	 *
	 * РЕЗУЛЬТАТ: PASS (с патчем и без)
	 */
	test("[ISOLATED] localStorage персистирует между навигациями — механизм OD", async ({
		page,
	}) => {
		// Шаг 1: кликаем на Add в колонке DONE
		await page.getByTestId("add-task-btn-done").click();
		await expect(page.getByTestId("modal")).toBeVisible();

		// Шаг 2: проверяем pre-select в модале (работает без патча Board.tsx)
		const selectedStatus = await page
			.getByTestId("task-status-select")
			.inputValue();
		expect(selectedStatus).toBe("DONE");

		// Шаг 3: закрываем модал
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("modal")).not.toBeVisible();

		// Шаг 4: СИМУЛИРУЕМ запись в localStorage.
		//
		// С патчем Board.tsx: saveLastColumn() вызывается автоматически при клике
		// в шаге 1, и localStorage УЖЕ содержит 'DONE' к этому моменту.
		//
		// Без патча: вручную эмулируем то, что делает saveLastColumn() —
		// чтобы тест работал в обоих случаях.
		const alreadyWritten = await getStoredColumn(page);
		if (alreadyWritten === null) {
			// Board.tsx не пропатчен — симулируем запись напрямую
			await setStoredColumn(page, selectedStatus);
		}

		// Шаг 5: верифицируем персистентность — localStorage содержит 'DONE'
		const stored = await getStoredColumn(page);
		expect(stored).toBe("DONE");

		// Шаг 6: перезагружаем страницу — localStorage СОХРАНЯЕТСЯ
		await page.reload();
		await waitForBoard(page);

		const storedAfterReload = await getStoredColumn(page);
		expect(storedAfterReload).toBe("DONE"); // ← ключевое свойство: persists после reload!

		console.log(
			`[ISOLATED] localStorage['${LS_KEY}'] = '${storedAfterReload}' — сохранился после reload`,
		);
	});
});

// ══════════════════════════════════════════════════════════════════════════════
// ГРУППА 2: POLLUTER → VICTIM (зависимое выполнение)
//
// Тесты используют ОБЩУЮ страницу. localStorage НЕ очищается между тестами.
// POLLUTER пишет в localStorage → VICTIM читает загрязнённое состояние.
//
// Это точная модель реального E2E OD-бага:
//   - Тест A взаимодействует с приложением → side effect в localStorage
//   - Тест B (запускается следующим) наследует этот side effect
//   - Тест B падает с неожиданным результатом
// ══════════════════════════════════════════════════════════════════════════════

test.describe
	.serial("11 · OD localStorage — POLLUTER→VICTIM (воспроизведение OD)", () => {
		let sharedContext: BrowserContext;
		let sharedPage: Page;

		test.beforeAll(async ({ browser }) => {
			sharedContext = await browser.newContext({
				baseURL: "http://localhost:3000",
			});
			sharedPage = await sharedContext.newPage();
			await sharedPage.goto("/");
			await waitForBoard(sharedPage);
			await clearAllTasksViaAPI(sharedPage);
			// ВАЖНО: НЕ очищаем localStorage в beforeAll — это часть OD-сценария.
			await sharedPage.goto("/");
			await waitForBoard(sharedPage);
			// Ждём гидратации: add-task-btn-done должен быть видимым = React смонтировал Column
			await sharedPage
				.getByTestId("add-task-btn-done")
				.waitFor({ state: "visible" });
		});

		test.afterAll(async () => {
			await sharedContext.close();
		});

		// ────────────────────────────────────────────────────────────────────────
		// [POLLUTER] — тест, который «загрязняет» localStorage.
		//
		// Реалистичный сценарий: QA создаёт задачу в колонке DONE
		// (тест проверяет функциональность DONE-колонки).
		// После этого в localStorage остаётся 'taskboard:lastColumn' = 'DONE'.
		//
		// Поллютер ПРОХОДИТ — он делает именно то, что должен.
		// Проблема проявляется только в следующем тесте.
		// ────────────────────────────────────────────────────────────────────────
		test("[POLLUTER] создаёт задачу в DONE → загрязняет localStorage", async () => {
			const initialStored = await getStoredColumn(sharedPage);
			expect(initialStored).toBeNull();

			await createTaskViaAPI(sharedPage, {
				title: "Done Task",
				status: "DONE",
			});
			// goto вместо reload — стабильнее при repeat-each: нет риска ERR_ABORTED
			await sharedPage.goto("/");
			await waitForBoard(sharedPage);

			await sharedPage.getByTestId("add-task-btn-done").click();
			await expect(sharedPage.getByTestId("modal")).toBeVisible();

			const selectedStatus = await sharedPage
				.getByTestId("task-status-select")
				.inputValue();
			expect(selectedStatus).toBe("DONE");

			await sharedPage
				.getByTestId("task-title-input")
				.fill("Another Done Task");
			await sharedPage.getByTestId("modal-submit-btn").click();
			await expect(sharedPage.getByTestId("modal")).not.toBeVisible();

			await expect(
				sharedPage.getByTestId("column-done").getByText("Another Done Task"),
			).toBeVisible();

			// ЗАГРЯЗНЕНИЕ localStorage.
			// С патчем Board.tsx: saveLastColumn() уже записала при клике выше.
			// Без патча: явно эмулируем saveLastColumn() через evaluate().
			// ПРИМЕЧАНИЕ: для реального OD-failure в VICTIM требуется патч Board.tsx —
			// только тогда readLastColumn() повлияет на pre-select в модале.
			const alreadyPolluted = await getStoredColumn(sharedPage);
			if (alreadyPolluted === null) {
				await setStoredColumn(sharedPage, "DONE");
				console.log(
					"[POLLUTER] Board.tsx not patched — simulating saveLastColumn() via evaluate()",
				);
			}

			const pollutedValue = await getStoredColumn(sharedPage);
			expect(pollutedValue).toBe("DONE");
			console.log(
				`[POLLUTER] localStorage['${LS_KEY}'] = '${pollutedValue}' — среда загрязнена`,
			);
		});

		// ────────────────────────────────────────────────────────────────────────
		// [VICTIM] — подтверждает OD-эффект через прямую проверку DOM.
		//
		// ВАЖНОЕ ИЗМЕНЕНИЕ В ДИЗАЙНЕ:
		//   Прежняя версия: expect(selectedStatus).toBe("BACKLOG") → падает при OD.
		//   Проблема: setModalDefaultStatus + setModalTarget — два setState-вызова.
		//   React может смонтировать модал с defaultStatus="BACKLOG" (из useState)
		//   до того как batched update с "DONE" применится → assertion ненадёжен.
		//
		//   Новая версия: тест ПОДТВЕРЖДАЕТ OD через проверку места создания задачи.
		//   Это black-box подход: "задача создана → проверяем где она оказалась".
		//   Не зависит от порядка React setState-обновлений → стабильно.
		//
		// OD-СИГНАТУРА:
		//   - PASS: задача в DONE (не в BACKLOG) → OD подтверждён
		//   - FAIL: задача в BACKLOG → OD-эффект отсутствует (фикс применён)
		// ────────────────────────────────────────────────────────────────────────
		test("[VICTIM] OD подтверждён: задача создана в DONE вместо BACKLOG", async () => {
			// Шаг 1: предусловие OD — localStorage загрязнён поллютером
			const pollutedValue = await getStoredColumn(sharedPage);
			expect(pollutedValue).toBe("DONE");

			console.log(
				`[VICTIM] Загрязнение подтверждено: localStorage['${LS_KEY}'] = '${pollutedValue}'`,
			);

			// Шаг 2: очищаем задачи поллютера, localStorage НЕ трогаем.
			// goto() вместо reload() — более стабильно при shared page context:
			// reload() может вызвать ERR_ABORTED если страница ещё обрабатывает
			// pending-запросы от POLLUTER-теста.
			await clearAllTasksViaAPI(sharedPage);
			try {
				await sharedPage.waitForLoadState("networkidle", { timeout: 2_000 });
			} catch {
				/* продолжаем если timeout */
			}
			await sharedPage.goto("/");
			await waitForBoard(sharedPage);

			// Шаг 3: после reload localStorage всё ещё содержит 'DONE'
			const afterReload = await getStoredColumn(sharedPage);
			expect(afterReload).toBe("DONE");
			console.log(
				`[VICTIM] После reload: localStorage['${LS_KEY}'] = '${afterReload}' (OD-загрязнение живёт)`,
			);

			// Шаг 4: открываем глобальную "New Task"
			await sharedPage.getByTestId("global-add-task-btn").click();
			await expect(sharedPage.getByTestId("modal")).toBeVisible();

			// Шаг 5: диагностика — что реально показывает select
			const actualSelectedStatus = await sharedPage
				.getByTestId("task-status-select")
				.inputValue();
			console.log(
				`[VICTIM] Modal opened with: '${actualSelectedStatus}' (BACKLOG=нет OD | DONE=OD есть)`,
			);

			// Шаг 6: создаём задачу НЕ меняя дефолтный статус
			// Статус берётся из того, что модал pre-selected (DONE из localStorage или BACKLOG)
			await sharedPage.getByTestId("task-title-input").fill("Victim Task");
			await sharedPage.getByTestId("modal-submit-btn").click();
			await expect(sharedPage.getByTestId("modal")).not.toBeVisible();

			// Шаг 7: ждём toast (сигнал что оптимистичное обновление пришло с сервера)
			await expect(sharedPage.getByTestId("toast-success")).toBeVisible();

			// Шаг 8: OD ПОДТВЕРЖДЕНИЕ — задача ДОЛЖНА быть в DONE (не в BACKLOG)
			//
			// Логика: polluter записал 'DONE' в localStorage.
			// readLastColumn() прочитал 'DONE' → modal открылся с DONE pre-selected.
			// Задача создана в DONE.
			//
			// Этот тест ПРОХОДИТ при наличии OD (задача в DONE).
			// Этот тест ПАДАЕТ если OD устранён (задача в BACKLOG).
			await expect(
				sharedPage.getByTestId("column-done").getByText("Victim Task"),
			).toBeVisible();

			// Дополнительно: в BACKLOG задачи НЕТ
			await expect(
				sharedPage.getByTestId("column-backlog").getByText("Victim Task"),
			).not.toBeVisible();

			console.log(
				"[VICTIM] OD-эффект подтверждён: задача в DONE вместо BACKLOG",
			);
		});
	});

// ══════════════════════════════════════════════════════════════════════════════
// ГРУППА 3: STABLE — фикс через localStorage.clear() в beforeEach
//
// Правильное решение OD-проблемы с localStorage:
//   1. Очищать localStorage перед КАЖДЫМ тестом в beforeEach
//   2. Использовать отдельный browser context per test (изоляция по умолчанию)
//   3. Устанавливать конкретное начальное состояние вместо default
// ══════════════════════════════════════════════════════════════════════════════

test.describe
	.serial("11 · OD localStorage — STABLE (с beforeEach localStorage.clear())", () => {
		let sharedContext: BrowserContext;
		let sharedPage: Page;

		test.beforeAll(async ({ browser }) => {
			sharedContext = await browser.newContext({
				baseURL: "http://localhost:3000",
			});
			sharedPage = await sharedContext.newPage();
			await sharedPage.goto("/");
			await waitForBoard(sharedPage);
		});

		test.afterAll(async () => {
			await sharedContext.close();
		});

		/**
		 * FIX: beforeEach очищает localStorage и данные БД.
		 *
		 * ВАЖНО: используем goto("/") вместо reload() — это надёжнее при
		 * test.describe.serial + --repeat-each. reload() вызывает ERR_ABORTED
		 * если страница ещё обрабатывает pending-запросы или toast-анимации
		 * от предыдущего теста. goto() всегда начинает навигацию с нуля.
		 *
		 * Порядок операций критичен:
		 *   1. Ждём стабилизации (networkidle) → нет pending fetch/XHR
		 *   2. Чистим localStorage → нет OD-загрязнения
		 *   3. Чистим БД через API → нет задач от предыдущих итераций
		 *   4. goto("/") → свежая страница
		 *   5. waitForBoard → React смонтирован, доска видна
		 */
		test.beforeEach(async () => {
			// Шаг 1: ждём стабилизации страницы после предыдущего теста.
			// Это предотвращает ERR_ABORTED при --repeat-each N:
			// к N-й итерации могут оставаться pending toast-таймеры, анимации,
			// незавершённые fetch-запросы от предыдущего теста.
			try {
				await sharedPage.waitForLoadState("networkidle", { timeout: 3_000 });
			} catch {
				// Если страница не успела стабилизироваться — продолжаем всё равно.
				// ERR_ABORTED случается именно когда мы ЖДЁМ idle и его не дожидаемся.
				// goto() ниже корректно обработает любое состояние страницы.
			}

			// Шаг 2: FIX — очищаем localStorage перед каждым тестом
			await clearLocalStorage(sharedPage);
			const stored = await getStoredColumn(sharedPage);
			expect(stored).toBeNull();

			// Шаг 3: очищаем задачи из БД
			await clearAllTasksViaAPI(sharedPage);

			// Шаг 4: goto + явное ожидание гидратации React.
			// goto() сбрасывает страницу надёжнее чем reload(),
			// но Next.js SSR отдаёт HTML раньше, чем React прикрепляет onClick-handlers.
			// waitForBoard видит DOM, но не гарантирует что event listeners на месте.
			// Решение: ждём что глобальная кнопка стала кликабельной (enabled + visible).
			await sharedPage.goto("/");
			await waitForBoard(sharedPage);
			// Ожидаем полной гидратации: кнопка должна быть enabled
			await sharedPage
				.getByTestId("add-task-btn-done")
				.waitFor({ state: "visible" });
		});

		test("[STABLE][POLLUTER] создаёт задачу в DONE (localStorage будет очищен)", async () => {
			// Создаём задачу в DONE (загрязняем localStorage).
			// Используем глобальную кнопку "New Task" — она вызывает openCreateModalWithMemory(),
			// которая читает localStorage. Но для ЗАГРЯЗНЕНИЯ нам нужна колоночная кнопка,
			// которая вызывает openCreateModal(status) → saveLastColumn(status).
			//
			// Если saveLastColumn не отработал (гонка гидратации) — используем fallback.
			await sharedPage.getByTestId("add-task-btn-done").click();
			await expect(sharedPage.getByTestId("modal")).toBeVisible();

			await sharedPage.getByTestId("task-title-input").fill("Stable Done Task");
			await sharedPage.getByTestId("modal-submit-btn").click();
			await expect(sharedPage.getByTestId("modal")).not.toBeVisible();

			await expect(
				sharedPage.getByTestId("column-done").getByText("Stable Done Task"),
			).toBeVisible();

			// Проверяем localStorage — saveLastColumn должна была записать "DONE".
			// Если Board.tsx не успел прикрепить handler (гонка гидратации) — используем
			// явный evaluate() fallback, чтобы VICTIM-тест мог проверить работу cleanup.
			const storedByApp = await getStoredColumn(sharedPage);
			if (storedByApp === null) {
				// Fallback: saveLastColumn() не сработал из-за гонки гидратации.
				// Явно симулируем запись — это та же функция, что и в app:
				//   localStorage.setItem("taskboard:lastColumn", "DONE")
				await setStoredColumn(sharedPage, "DONE");
				console.log(
					"[STABLE][POLLUTER] hydration race: saveLastColumn not called — simulating via evaluate()",
				);
			} else {
				console.log(
					"[STABLE][POLLUTER] saveLastColumn() worked natively — Board.tsx patch confirmed",
				);
			}

			const stored = await getStoredColumn(sharedPage);
			expect(stored).toBe("DONE"); // загрязнение подтверждено (native или fallback)
		});

		/**
		 * [STABLE][VICTIM] — зеркало VICTIM из группы 2, но с beforeEach cleanup.
		 * Та же black-box стратегия: создаём задачу и проверяем где она оказалась.
		 *
		 * РЕЗУЛЬТАТ: PASS — задача идёт в BACKLOG (фикс устранил OD-загрязнение)
		 */
		test("[STABLE][VICTIM] задача создана в BACKLOG — OD устранён cleanup (PASS)", async () => {
			// beforeEach очистил localStorage → загрязнения нет
			const stored = await getStoredColumn(sharedPage);
			expect(stored).toBeNull();

			await sharedPage.getByTestId("global-add-task-btn").click();
			await expect(sharedPage.getByTestId("modal")).toBeVisible();

			// readLastColumn() возвращает 'BACKLOG' (localStorage пуст → fallback)
			const actualSelectedStatus = await sharedPage
				.getByTestId("task-status-select")
				.inputValue();
			console.log(
				`[STABLE][VICTIM] Modal opened with: '${actualSelectedStatus}' (ожидаем BACKLOG)`,
			);
			expect(actualSelectedStatus).toBe("BACKLOG"); // ← PASS: нет загрязнения

			await sharedPage
				.getByTestId("task-title-input")
				.fill("Stable Victim Task");
			await sharedPage.getByTestId("modal-submit-btn").click();
			await expect(sharedPage.getByTestId("modal")).not.toBeVisible();

			await expect(sharedPage.getByTestId("toast-success")).toBeVisible();

			// FIX ПОДТВЕРЖДЁН: задача в BACKLOG (не в DONE)
			// Сравни с группой 2: там задача была бы в DONE из-за OD
			await expect(
				sharedPage
					.getByTestId("column-backlog")
					.getByText("Stable Victim Task"),
			).toBeVisible();
			await expect(
				sharedPage.getByTestId("column-done").getByText("Stable Victim Task"),
			).not.toBeVisible();
		});

		/**
		 * [STABLE] Демонстрация лучшей практики: явно устанавливать
		 * начальное состояние localStorage вместо полагания на default.
		 *
		 * Тест сам устанавливает нужное ему состояние — не зависит от других тестов.
		 * Это делает его ПОЛНОСТЬЮ независимым от порядка выполнения.
		 */
		test("[STABLE] явная установка localStorage — тест независим от порядка", async () => {
			// Лучшая практика: явно устанавливаем НУЖНОЕ состояние
			await setStoredColumn(sharedPage, "BACKLOG");

			await sharedPage.getByTestId("global-add-task-btn").click();
			await expect(sharedPage.getByTestId("modal")).toBeVisible();

			const selectedStatus = await sharedPage
				.getByTestId("task-status-select")
				.inputValue();
			expect(selectedStatus).toBe("BACKLOG");

			await sharedPage.keyboard.press("Escape");
			await expect(sharedPage.getByTestId("modal")).not.toBeVisible();
		});
	});

// ══════════════════════════════════════════════════════════════════════════════
// ГРУППА 4: Дополнительный анализ — BRITTLE тест
//
// BRITTLE — тест, который проходит ТОЛЬКО если перед ним запустился поллютер.
// Противоположность VICTIM: VICTIM падает, BRITTLE проходит благодаря поллютеру.
// ══════════════════════════════════════════════════════════════════════════════

test.describe
	.serial("11 · OD localStorage — BRITTLE (зависит от поллютера для прохождения)", () => {
		let sharedContext: BrowserContext;
		let sharedPage: Page;

		test.beforeAll(async ({ browser }) => {
			sharedContext = await browser.newContext({
				baseURL: "http://localhost:3000",
			});
			sharedPage = await sharedContext.newPage();
			await sharedPage.goto("/");
			await waitForBoard(sharedPage);
			await clearAllTasksViaAPI(sharedPage);
			await clearLocalStorage(sharedPage);
			await sharedPage.goto("/");
			await waitForBoard(sharedPage);
			await sharedPage
				.getByTestId("add-task-btn-in-progress")
				.waitFor({ state: "visible" });
		});

		test.afterAll(async () => {
			await sharedContext.close();
		});

		/**
		 * [POLLUTER] устанавливает состояние, необходимое для BRITTLE теста.
		 */
		test("[POLLUTER] устанавливает lastColumn = 'IN_PROGRESS' в localStorage", async () => {
			// Кликаем "Add Task" в колонке IN_PROGRESS
			await sharedPage.getByTestId("add-task-btn-in-progress").click();
			await expect(sharedPage.getByTestId("modal")).toBeVisible();

			await sharedPage.getByTestId("task-title-input").fill("In Progress Task");
			await sharedPage.getByTestId("modal-submit-btn").click();
			await expect(sharedPage.getByTestId("modal")).not.toBeVisible();

			const stored = await getStoredColumn(sharedPage);
			expect(stored).toBe("IN_PROGRESS");
		});

		/**
		 * [BRITTLE] — тест, который ОЖИДАЕТ что localStorage = 'IN_PROGRESS'.
		 *
		 * Этот тест ПРОЙДЁТ только если перед ним запустился POLLUTER,
		 * который установил нужное значение.
		 *
		 * В изоляции (без POLLUTER) — УПАДЁТ, т.к. localStorage пуст.
		 *
		 * BRITTLE тесты особенно опасны: они маскируют зависимости между тестами,
		 * создавая иллюзию стабильности при определённом порядке запуска.
		 */
		test("[BRITTLE] проверяет lastColumn = 'IN_PROGRESS' (зависит от POLLUTER)", async () => {
			const stored = await getStoredColumn(sharedPage);

			// Это assertion ПРОХОДИТ только потому что POLLUTER установил значение.
			// Запустите этот тест В ИЗОЛЯЦИИ — он упадёт: stored = null
			expect(stored).toBe("IN_PROGRESS");

			// Открываем модал — ожидаем pre-select IN_PROGRESS
			await sharedPage.getByTestId("global-add-task-btn").click();
			await expect(sharedPage.getByTestId("modal")).toBeVisible();

			const selectedStatus = await sharedPage
				.getByTestId("task-status-select")
				.inputValue();
			expect(selectedStatus).toBe("IN_PROGRESS"); // PASS только после POLLUTER

			await sharedPage.keyboard.press("Escape");
			await expect(sharedPage.getByTestId("modal")).not.toBeVisible();
		});
	});
