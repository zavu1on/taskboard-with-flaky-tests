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
npx playwright install chromium firefox
```

### Запуск тестов

```bash
# Все тесты (headless)
npx playwright test

# Конкретный spec
npx playwright test tests/e2e/01-async-race.spec.ts

# С UI-режимом (наглядно)
npx playwright test --ui

# Стресс-тест (поиск флаки): запускаем каждый тест 20 раз
npx playwright test --repeat-each 20 --retries 0

# Обнаружение флаки в CI-режиме
npx playwright test --retries 2 --fail-on-flaky-tests
```

### HTML-отчёт

```bash
npx playwright show-report
```

---

## Структура тестов

| Spec | Категория (ICST 2025) | Описание |
|------|----------------------|----------|
| `01-async-race` | ED (Event-DOM) | Race condition после Submit |
| `02-toast-timing` | R (Response) | Assertion timing для animated toast |
| `03-modal-dom-context` | DE (DOM-Event) | Взаимодействие с portal-модалом |
| `04-optimistic-rollback` | R + ED | Optimistic UI + server rollback |
| `05-drag-and-drop` | ED + E | DnD через @dnd-kit, production case |
| `06-delete-dom-consistency` | D (DOM) | Удаление + DOM consistency |

Каждый spec содержит:
- `[FLAKY]` - намеренно нестабильный тест с объяснением причины
- `[STABLE]` - правильное решение
- `[STRESS]` - сценарий нагрузки для воспроизведения гонок

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
└── tests/e2e/
    ├── helpers/board.ts     # Shared test utilities
    ├── 01-async-race.spec.ts
    ├── 02-toast-timing.spec.ts
    ├── 03-modal-dom-context.spec.ts
    ├── 04-optimistic-rollback.spec.ts
    ├── 05-drag-and-drop.spec.ts
    └── 06-delete-dom-consistency.spec.ts
```

---

## Ключевые паттерны нестабильности (по Pei et al., ICST 2025)

### ED (Event-DOM) - 32.5% случаев
Событие модифицирует DOM. Нестабильно когда DOM не успел обновиться к моменту assertion.  
**Фикс:** web-first assertions + `waitForResponse()`

### R (Response) - 16.3% случаев  
Assertion срабатывает до стабилизации DOM после предыдущих событий.  
**Фикс:** `await expect(locator).toBeVisible()` вместо `isVisible()`

### D (DOM) - самая долгая нестабильность (153.4 дня)  
Прямые DOM-манипуляции без учёта async-цепочек.  
**Фикс:** `waitForResponse()` + `toHaveCount()` с polling
