/**
 * SPEC 10 — Order-Dependent: DOM Event Listener Leak
 * ═══════════════════════════════════════════════════════════════════════════
 * Категория: OD (Order-Dependent) по Luo et al., EMSE 2019
 * Подтип OD:  VICTIM   — тест падает ТОЛЬКО если перед ним запустился POLLUTER
 *             BRITTLE  — тест проходит ТОЛЬКО если перед ним запустился POLLUTER
 *
 * Связь с темой НИР «DOM Event Interaction как источник нестабильности E2E тестов»:
 *
 *   DOM Event Interaction — источник не только TIMING-флакинесса (spec 01–09),
 *   но и ORDER-DEPENDENT нестабильности.
 *
 *   TaskModal.tsx регистрирует глобальный listener на document:
 *     document.addEventListener('keydown', onKey)    ← Bubble phase
 *     return () => document.removeEventListener(...)  ← cleanup в useEffect
 *
 *   Если cleanup НЕ срабатывает (race при быстром unmount, навигация в момент
 *   исполнения эффекта, необработанное исключение) — listener остаётся «зомби»
 *   и накапливается от теста к тесту в рамках ОДНОГО browser context.
 *
 * МЕХАНИЗМ OD-ФЛАКИНЕССА (Listener Leak):
 *   [POLLUTER] инжектирует capture-phase listener с stopImmediatePropagation.
 *              Capture phase имеет приоритет над Bubble phase.
 *              stopImmediatePropagation() блокирует ВСЕ последующие handlers.
 *
 *   [VICTIM]   открывает модал, нажимает Escape.
 *              Zombie listener (capture) перехватывает событие ПЕРВЫМ →
 *              stopImmediatePropagation() → TaskModal.onKey НИКОГДА не вызывается →
 *              modal остаётся открытым → expect(modal).not.toBeVisible() → FAIL.
 *
 * СТРУКТУРА СПЕКА:
 *   ГРУППА 1 — ISOLATED:         Victim в изоляции → PASS (доказываем)
 *   ГРУППА 2 — POLLUTER→VICTIM:  Зависимое выполнение → VICTIM FAIL (ожидаемо)
 *   ГРУППА 3 — STABLE:           С beforeEach cleanup → оба PASS (фикс)
 *
 * КАК ЗАПУСТИТЬ (эксперимент):
 *
 *   # Среда B — все OD тесты (15 прогонов для сбора статистики)
 *   TEST_ENV=B_od npx playwright test \
 *     tests/e2e/10-od-listener-leak.spec.ts \
 *     --config playwright.env-b.config.ts \
 *     --repeat-each 15 --retries 0
 *
 *   # Только ISOLATED группа (victim без поллютера — должен проходить):
 *   TEST_ENV=B_od_isolated npx playwright test \
 *     tests/e2e/10-od-listener-leak.spec.ts \
 *     --config playwright.env-b.config.ts \
 *     --grep "ISOLATED" --repeat-each 15 --retries 0
 *
 *   # Только POLLUTER+VICTIM группа (воспроизведение OD):
 *   TEST_ENV=B_od_polluted npx playwright test \
 *     tests/e2e/10-od-listener-leak.spec.ts \
 *     --config playwright.env-b.config.ts \
 *     --grep "POLLUTER→VICTIM" --repeat-each 15 --retries 0
 */

import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { clearAllTasksViaAPI, waitForBoard } from "./helpers/board";

// ══════════════════════════════════════════════════════════════════════════════
// ГРУППА 1: Изолированное выполнение
// Доказательство: victim-тест ПРОХОДИТ, когда запущен в чистой среде.
// Каждый тест получает НОВУЮ страницу через стандартный fixture ({ page }).
// ══════════════════════════════════════════════════════════════════════════════

test.describe("10 · OD Listener Leak — ISOLATED (victim без поллютера)", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await waitForBoard(page);
		await clearAllTasksViaAPI(page);
		await page.reload();
		await waitForBoard(page);
	});

	/**
	 * ISOLATED: Escape закрывает модал корректно.
	 *
	 * В чистой среде на document висит ровно ОДИН keydown listener —
	 * тот, что добавил TaskModal.tsx при монтировании.
	 * Escape беспрепятственно достигает handler → onClose() → unmount.
	 *
	 * РЕЗУЛЬТАТ: PASS (стабильно в любой итерации)
	 */
	test("[ISOLATED] Escape закрывает модал — чистая среда (PASS)", async ({
		page,
	}) => {
		await page.getByTestId("global-add-task-btn").click();
		await expect(page.getByTestId("modal")).toBeVisible();

		const listenerCount = await page.evaluate(
			() =>
				// Проверяем, что нет посторонних listeners (в чистой среде их нет)
				(window as any).__zombieListenerRef === undefined,
		);
		expect(listenerCount).toBe(true); // чистая среда подтверждена

		await page.keyboard.press("Escape");

		// В чистой среде Escape слышит ТОЛЬКО TaskModal.tsx handler → PASS
		await expect(page.getByTestId("modal")).not.toBeVisible();
	});

	/**
	 * ISOLATED: создание задачи через Escape-цикл (open → fill → Escape → open → submit).
	 * Проверяем, что множественные Escape не оставляют zombie listeners.
	 *
	 * РЕЗУЛЬТАТ: PASS (изолировано)
	 */
	test("[ISOLATED] многократный Escape не накапливает listeners", async ({
		page,
	}) => {
		// Открываем и закрываем через Escape 3 раза подряд
		for (let i = 0; i < 3; i++) {
			await page.getByTestId("global-add-task-btn").click();
			await expect(page.getByTestId("modal")).toBeVisible();

			await page.keyboard.press("Escape");
			await expect(page.getByTestId("modal")).not.toBeVisible();
		}

		// После 3-х циклов Escape всё ещё работает корректно
		await page.getByTestId("global-add-task-btn").click();
		await expect(page.getByTestId("modal")).toBeVisible();

		// Проверяем, что НЕТ накопленных zombie listeners
		const hasZombie = await page.evaluate(
			() => (window as any).__zombieListenerRef !== undefined,
		);
		expect(hasZombie).toBe(false);

		await page.keyboard.press("Escape");
		await expect(page.getByTestId("modal")).not.toBeVisible();
	});
});

// ══════════════════════════════════════════════════════════════════════════════
// ГРУППА 2: POLLUTER → VICTIM (зависимое выполнение)
//
// КЛЮЧЕВОЕ ОТЛИЧИЕ от группы 1:
//   Тесты используют ОБЩУЮ страницу (sharedPage) через beforeAll.
//   Playwright НЕ создаёт новый browser context между тестами группы.
//   Состояние document — включая event listeners — СОХРАНЯЕТСЯ.
//
// test.describe.serial гарантирует строгий порядок: POLLUTER → VICTIM.
// ══════════════════════════════════════════════════════════════════════════════

test.describe
	.serial("10 · OD Listener Leak — POLLUTER→VICTIM (воспроизведение OD)", () => {
		let sharedContext: BrowserContext;
		let sharedPage: Page;

		test.beforeAll(async ({ browser }) => {
			// Создаём ОБЩИЙ контекст — НЕ изолированный per-test
			sharedContext = await browser.newContext({
				baseURL: "http://localhost:3000",
			});
			sharedPage = await sharedContext.newPage();
			await sharedPage.goto("/");
			await waitForBoard(sharedPage);
			// Очищаем задачи один раз перед всей группой
			await clearAllTasksViaAPI(sharedPage);
			await sharedPage.reload();
			await waitForBoard(sharedPage);
		});

		test.afterAll(async () => {
			await sharedContext.close();
		});

		// ────────────────────────────────────────────────────────────────────────
		// [POLLUTER] — тест, который «загрязняет» среду для следующего теста.
		//
		// Симулирует реальный баг: компонент зарегистрировал keydown listener,
		// но получил unmount-сигнал ДО того как useEffect cleanup успел отработать.
		// Это возможно при:
		//   — навигации сразу после mount (React 18 Strict Mode double-invoke)
		//   — быстром unmount из-за ошибки в render
		//   — network timeout, прерывающем жизненный цикл компонента
		//
		// Технически: listener добавляется в capture phase (приоритет выше bubble).
		// stopImmediatePropagation() в capture phase блокирует ВСЕ последующие
		// handlers — включая те, что зарегистрированы в bubble phase.
		// ────────────────────────────────────────────────────────────────────────
		test("[POLLUTER] инжектирует zombie keydown listener — capture phase", async () => {
			// Шаг 1: открываем модал (TaskModal добавляет свой bubble-phase listener)
			await sharedPage.getByTestId("global-add-task-btn").click();
			await expect(sharedPage.getByTestId("modal")).toBeVisible();
			await sharedPage.getByTestId("task-title-input").fill("Polluter data");

			// Шаг 2: ИНЖЕКЦИЯ ZOMBIE LISTENER
			//
			// Имитируем ситуацию: React начал unmount компонента, но cleanup
			// useEffect не успел выполниться (race condition при быстрой навигации).
			// В результате listener "завис" на document без removeEventListener.
			await sharedPage.evaluate(() => {
				const zombieHandler = (e: KeyboardEvent): void => {
					if (e.key === "Escape") {
						// Capture phase → stopImmediatePropagation → блокирует ВСЁ,
						// включая TaskModal.tsx handler в bubble phase
						e.stopImmediatePropagation();
						console.warn(
							"[ZOMBIE LISTENER] Escape intercepted! TaskModal will NOT receive this event.",
						);
					}
				};

				// capture: true — критически важно для воспроизведения бага.
				// Capture phase выполняется ДО bubble phase.
				document.addEventListener("keydown", zombieHandler, { capture: true });

				// Сохраняем ссылку в window для диагностики в тестах.
				// В реальном production-баге этой ссылки НЕТ — именно поэтому
				// его сложно обнаружить и исправить.
				(window as any).__zombieListenerRef = zombieHandler;
				(window as any).__zombieCount =
					((window as any).__zombieCount ?? 0) + 1;

				console.log(
					`[POLLUTER] Zombie listener injected. Total zombies: ${(window as any).__zombieCount}`,
				);
			});

			// Шаг 3: закрываем модал через кнопку (НЕ через Escape)
			// Если бы мы закрыли через Escape — zombie заблокировал бы СВОЁ же закрытие
			await sharedPage.getByTestId("modal-cancel-btn").click();
			await expect(sharedPage.getByTestId("modal")).not.toBeVisible();

			// Подтверждаем: zombie listener сидит на document и ждёт следующего теста
			const zombieExists = await sharedPage.evaluate(
				() => (window as any).__zombieListenerRef !== undefined,
			);
			expect(zombieExists).toBe(true); // ← zombie успешно посеян
		});

		// ────────────────────────────────────────────────────────────────────────
		// [VICTIM] — тест, который ПАДАЕТ из-за поллютера.
		//
		// Этот тест запускается ПОСЛЕ [POLLUTER] на ТОЙ ЖЕ странице.
		// На document ВСЕГДА есть zombie listener.
		//
		// Тест помечен как test.fail() — это значит:
		//   - Playwright ОЖИДАЕТ, что тест упадёт
		//   - Если тест неожиданно ПРОЙДЁТ — репортер сообщит об аномалии
		//   - В NDJSON-отчёте фиксируется статус "expected failure"
		//
		// Это стандартная практика для документирования известных OD-дефектов.
		// ────────────────────────────────────────────────────────────────────────
		test("[VICTIM] Escape заблокирован zombie listener — модал не закрывается (EXPECTED FAIL)", async () => {
			// Маркер: этот тест ОЖИДАЕМО падает при запуске после [POLLUTER]
			// Убираем test.fail() чтобы ВИДЕТЬ реальный failure в репорте для аналитики
			// test.fail();

			// Проверяем предусловие: zombie listener существует
			const zombieExists = await sharedPage.evaluate(
				() => (window as any).__zombieListenerRef !== undefined,
			);
			expect(zombieExists).toBe(true); // подтверждаем OD-зависимость

			// Открываем модал (TaskModal добавляет свой bubble-phase listener)
			await sharedPage.getByTestId("global-add-task-btn").click();
			await expect(sharedPage.getByTestId("modal")).toBeVisible();

			// Нажимаем Escape — ОЖИДАЕМ закрытия, НО zombie перехватит событие
			await sharedPage.keyboard.press("Escape");

			// ASSERTION: модал должен закрыться (Escape достигает TaskModal handler)
			// РЕАЛЬНОСТЬ: zombie listener поглотил событие → модал открыт → FAIL
			//
			// Failure message: "Locator: getByTestId('modal') Expected: not visible / Received: visible"
			await expect(sharedPage.getByTestId("modal")).not.toBeVisible({
				timeout: 3_000, // уменьшенный timeout — мы знаем что он упадёт
			});
		});
	});

// ══════════════════════════════════════════════════════════════════════════════
// ГРУППА 3: STABLE — фикс через явную очистку listeners в beforeEach
//
// Правильное решение OD-проблемы:
//   1. Каждый тест начинается с ПОЛНОЙ очистки document event listeners
//   2. В реальном проекте: использовать AbortController для cleanup
//      или переходить к изолированному browser context на каждый тест
// ══════════════════════════════════════════════════════════════════════════════

test.describe
	.serial("10 · OD Listener Leak — STABLE (с beforeEach cleanup)", () => {
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
			await sharedPage.reload();
			await waitForBoard(sharedPage);
		});

		test.afterAll(async () => {
			await sharedContext.close();
		});

		/**
		 * FIX: beforeEach удаляет zombie listeners перед каждым тестом.
		 *
		 * В реальном проекте аналогичная очистка должна быть встроена
		 * в глобальный beforeEach или в afterEach каждого теста.
		 *
		 * Ещё лучший подход: использовать AbortController в компоненте:
		 *   const controller = new AbortController();
		 *   document.addEventListener('keydown', onKey, { signal: controller.signal });
		 *   return () => controller.abort(); // cleanup гарантирован
		 */
		test.beforeEach(async () => {
			await sharedPage.evaluate(() => {
				const ref = (window as any).__zombieListenerRef;
				if (ref) {
					document.removeEventListener("keydown", ref, { capture: true });
					delete (window as any).__zombieListenerRef;
					delete (window as any).__zombieCount;
					console.log("[CLEANUP] Zombie listener removed before test");
				}
			});
		});

		test("[STABLE][POLLUTER] инжектирует zombie listener (тест сам по себе OK)", async () => {
			await sharedPage.getByTestId("global-add-task-btn").click();
			await expect(sharedPage.getByTestId("modal")).toBeVisible();

			await sharedPage.getByTestId("task-title-input").fill("Stable polluter");

			// Инжектируем тот же zombie что и в группе 2
			await sharedPage.evaluate(() => {
				const zombieHandler = (e: KeyboardEvent): void => {
					if (e.key === "Escape") {
						e.stopImmediatePropagation();
					}
				};
				document.addEventListener("keydown", zombieHandler, { capture: true });
				(window as any).__zombieListenerRef = zombieHandler;
			});

			await sharedPage.getByTestId("modal-cancel-btn").click();
			await expect(sharedPage.getByTestId("modal")).not.toBeVisible();
		});

		/**
		 * [STABLE][VICTIM] — после beforeEach cleanup zombie listener удалён.
		 * Escape корректно достигает TaskModal.tsx handler → модал закрывается.
		 *
		 * РЕЗУЛЬТАТ: PASS (фикс работает)
		 */
		test("[STABLE][VICTIM] Escape закрывает модал — zombie очищен beforeEach (PASS)", async () => {
			// Подтверждаем: zombie listener удалён beforeEach
			const zombieExists = await sharedPage.evaluate(
				() => (window as any).__zombieListenerRef !== undefined,
			);
			expect(zombieExists).toBe(false); // ← среда чистая

			await sharedPage.getByTestId("global-add-task-btn").click();
			await expect(sharedPage.getByTestId("modal")).toBeVisible();

			await sharedPage.keyboard.press("Escape");

			// FIX: zombie удалён → Escape достигает TaskModal handler → PASS
			await expect(sharedPage.getByTestId("modal")).not.toBeVisible();
		});

		/**
		 * [STABLE] дополнительная проверка: после zombie cleanup
		 * полный workflow создания задачи работает корректно.
		 */
		test("[STABLE] полный workflow после cleanup — создание задачи через форму", async () => {
			const zombieExists = await sharedPage.evaluate(
				() => (window as any).__zombieListenerRef !== undefined,
			);
			expect(zombieExists).toBe(false);

			await sharedPage.getByTestId("global-add-task-btn").click();
			await expect(sharedPage.getByTestId("modal")).toBeVisible();

			await sharedPage.getByTestId("task-title-input").fill("Stable Task");

			// Escape не закрывает — проверяем что он работает корректно
			await sharedPage.keyboard.press("Escape");
			await expect(sharedPage.getByTestId("modal")).not.toBeVisible();

			// Открываем снова и создаём задачу
			await sharedPage.getByTestId("global-add-task-btn").click();
			await expect(sharedPage.getByTestId("modal")).toBeVisible();
			await sharedPage.getByTestId("task-title-input").fill("Created Task");
			await sharedPage.getByTestId("modal-submit-btn").click();
			await expect(sharedPage.getByTestId("modal")).not.toBeVisible();

			await expect(
				sharedPage.getByTestId("column-backlog").getByText("Created Task"),
			).toBeVisible();
		});
	});
