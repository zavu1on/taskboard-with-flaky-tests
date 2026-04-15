# TaskBoard - E2E Flaky Test Demo

Kanban-доска на **Next.js 15 + Prisma + PostgreSQL + Tailwind CSS**.  
Создана для демонстрации нестабильности E2E-тестов, связанной с DOM Event Interaction,  
в рамках доклада по работе **Pei, Sohn & Papadakis - ICST 2025**.

---

## Быстрый старт

### 1. Зависимости

```bash
npm install
```

### 2. База данных (PostgreSQL)

Запустите PostgreSQL локально или через Docker:

```bash
# Docker
docker run -d \
  --name taskboard-pg \
  -e POSTGRES_DB=taskboard \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  postgres:16-alpine
```

### 3. Переменные окружения

```bash
cp .env.example .env.local
# Отредактируйте DATABASE_URL в .env.local
```

Пример `.env.local`:
```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/taskboard"
```

### 4. Миграция и seed

```bash
npm run db:push   # применяет схему
npm run db:seed   # заполняет тестовыми данными
```

### 5. Запуск приложения

```bash
npm run dev
# -> http://localhost:3000
```

---

## E2E тесты

### Установка Playwright

```bash
npx playwright install chromium
```

### Базовый запуск

```bash
# Все тесты (headless)
npx playwright test

# Конкретный spec
npx playwright test tests/e2e/01-async-race.spec.ts

# С UI-режимом (наглядно)
npx playwright test --ui

# Обнаружение флаки в CI-режиме
npx playwright test --retries 2 --fail-on-flaky-tests
```

### HTML-отчёт

```bash
npx playwright show-report
```

---

## Структура тестов

### Основные спеки (01–06)

| Spec | Категория (ICST 2025) | Описание |
|------|----------------------|----------|
| `01-async-race` | ED (Event-DOM) | Race condition после Submit |
| `02-toast-timing` | R (Response) | Assertion timing для animated toast |
| `03-modal-dom-context` | DE (DOM-Event) | Взаимодействие с portal-модалом |
| `04-optimistic-rollback` | R + ED | Optimistic UI + server rollback |
| `05-drag-and-drop` | ED + E | DnD через @dnd-kit, production case |
| `06-delete-dom-consistency` | D (DOM) | Удаление + DOM consistency |

### Стресс-спеки (07–09)

| Spec | Категория (ICST 2025) | Описание |
|------|----------------------|----------|
| `07-stress-concurrent` | ED (stress) | 10 параллельных задач, batch DOM mutations |
| `08-stress-rapid-events` | R + DE (stress) | Быстрые последовательные события, накопление listener'ов |
| `09-stress-cascade-rollback` | D (stress) | Каскадные rollback'и, stale closure в useTasks |

Каждый spec содержит:
- `[FLAKY]` — намеренно нестабильный тест с объяснением причины
- `[STABLE]` — правильное решение
- `[STRESS]` — сценарий нагрузки для воспроизведения гонок

---

## Архитектура приложения

```
taskboard/
├── app/
│   ├── api/tasks/          # GET all, POST create
│   │   └── [id]/           # PATCH update, DELETE
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
├── components/
│   ├── Board.tsx            # DnD context + state orchestration
│   ├── Column.tsx           # Drop target
│   ├── TaskCard.tsx         # Draggable card
│   ├── TaskModal.tsx        # Create/Edit form
│   └── Toast.tsx            # Notification system
├── hooks/
│   ├── useTasks.ts          # Optimistic CRUD + API calls
│   └── useToast.ts          # Toast state management
├── lib/
│   ├── prisma.ts            # Singleton Prisma client
│   └── types.ts             # Shared TypeScript types
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── reporters/
│   └── flaky-json-reporter.ts   # Кастомный репортер, пишет NDJSON
├── scripts/
│   ├── analyze-env-a.py         # Анализ результатов эксперимента
│   └── fast-experiments.sh      # Быстрый запуск прогонов
└── tests/e2e/
    ├── helpers/board.ts          # Shared test utilities
    ├── fixtures/
    │   ├── cpu-throttle.ts       # CDP-фикстура для замедления CPU
    │   └── network-delay.ts      # Route-фикстура для задержки сети
    ├── 01-async-race.spec.ts
    ├── 02-toast-timing.spec.ts
    ├── 03-modal-dom-context.spec.ts
    ├── 04-optimistic-rollback.spec.ts
    ├── 05-drag-and-drop.spec.ts
    ├── 06-delete-dom-consistency.spec.ts
    ├── 07-stress-concurrent.spec.ts
    ├── 08-stress-rapid-events.spec.ts
    └── 09-stress-cascade-rollback.spec.ts
```

---

## Фикстуры

### `fixtures/cpu-throttle.ts`

Применяет замедление CPU через Chrome DevTools Protocol (CDP).  
`Emulation.setCPUThrottlingRate({ rate: 4 })` замедляет JS execution в 4 раза,  
имитируя слабый CI-агент. Работает только в Chromium.  
При недоступности CDP (WSL, headless CI) автоматически переключается на  
fallback: замедление `requestAnimationFrame` + задержка API через `page.route()`.

```typescript
// Управление через env-переменные:
CPU_THROTTLE_RATE=4      // коэффициент замедления CDP
CPU_FAKE_DELAY_MS=150    // задержка fallback-режима (мс)
```

### `fixtures/network-delay.ts`

Добавляет случайную задержку на все запросы к `/api/*` через `page.route()`.  
Работает в любом браузере без CDP.

```typescript
// Управление через env-переменные:
API_DELAY_MS=300    // базовая задержка (мс)
API_JITTER_MS=200   // случайная добавка ±jitter (мс)
```

---

## Эксперимент: воспроизведение флакинесса (Среда A — Baseline)

Эксперимент запускает все тесты 15 раз подряд в штатных условиях  
без искусственных ограничений. Результаты записываются в NDJSON-файл  
кастомным репортером `flaky-json-reporter.ts`.

### Предварительные условия

Приложение должно быть запущено **до** старта тестов:

```bash
# Терминал 1 — держать открытым на всё время эксперимента
npm run dev
```

### Запуск эксперимента

```bash
# Терминал 2
TEST_ENV=A_baseline npx playwright test \
  --config playwright.env-a.config.ts \
  --repeat-each 15 --retries 0
```

Результаты сохраняются в `stress-results/A_baseline.ndjson`.

### Анализ результатов

```bash
# Установить зависимости для анализа (один раз)
pip install pandas matplotlib

# Запустить анализ
python3 scripts/analyze-env-a.py
```

Скрипт создаст папку `stress-results/analysis-a/` со следующими артефактами:

| Файл | Описание |
|------|----------|
| `failure_rate_env_a.csv` | Таблица runs / fails / rate% по каждому тесту |
| `figure_1_spec_bars.png` | Failure rate FLAKY vs STABLE по спекам |
| `figure_2_pei_bars.png` | Failure rate по категориям Pei et al. |
| `report_env_a.txt` | Текстовая проверка гипотез H1 и H3 |

---

## Ключевые паттерны нестабильности (по Pei et al., ICST 2025)

### ED (Event-DOM) — 32.5% случаев
Событие модифицирует DOM. Нестабильно когда DOM не успел обновиться к моменту assertion.  
**Фикс:** web-first assertions + `waitForResponse()`  
**Спеки:** `01-async-race`, `07-stress-concurrent`

### R (Response) — 16.3% случаев
Assertion срабатывает до стабилизации DOM после предыдущих событий.  
**Фикс:** `await expect(locator).toBeVisible()` вместо `isVisible()`  
**Спеки:** `02-toast-timing`, `08-stress-rapid-events`

### DE (DOM-Event) — взаимодействие с немонтированным элементом
DOM изменяется, событие не достигает цели (элемент не focusable, listener не добавлен).  
**Фикс:** явное ожидание `toBeVisible()` перед любым взаимодействием с элементом  
**Спеки:** `03-modal-dom-context`, `08-stress-rapid-events`

### D (DOM) — самая долгая нестабильность (153.4 дня)
Прямые DOM-манипуляции без учёта async-цепочек и stale closure в React hooks.  
**Фикс:** `waitForResponse()` + `toHaveCount()` с polling + ожидание toast перед следующей операцией  
**Спеки:** `06-delete-dom-consistency`, `09-stress-cascade-rollback`
