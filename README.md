# TaskBoard — E2E Flaky Test Research Platform

## Authors and Contributors

The main contributor is **Mikhail M. Alekseev**, student of Peter the Great St. Petersburg Polytechnic University, Institute of Computer Science and Cybersecurity (SPbPU ICSC).
The advisor and contributor Vladimir A. Parkhomenko, Senior Lecturer of SPbPU ICSC.

## Introduction

TaskBoard is a Kanban-style task management application built on **Next.js 15 + Prisma + PostgreSQL + Tailwind CSS**. It serves as a controlled research platform for studying and reproducing instability in End-to-End (E2E) tests caused by DOM Event Interaction.

The project was completed during the preparation of Mikhail A. Alekseev's coursework on *Software Testing Methods* at SPbPU Institute of Computer Science and Cybersecurity (SPbPU ICSC).

The research is grounded in the empirical classification of DOM-related flaky tests proposed by Pei, Sohn & Papadakis (ICST 2025) and extended with Order-Dependent (OD) flakiness analysis following the methodology of Luo et al. (EMSE 2019).

### Research Overview

The project implements two experimental environments:

**Environment A — Timing Flakiness (Specs 01–09)**
Reproduces instability arising from DOM Event Interaction timing: race conditions between event dispatch and DOM updates, assertion timing on animated elements, optimistic UI rollbacks, and drag-and-drop pointer event chains. Tests are classified according to the ED / R / DE / D taxonomy from Pei et al.

**Environment B — Order-Dependent Flakiness (Specs 10–11)**
Reproduces instability arising from shared state that persists between tests within the same browser context. Two concrete OD mechanisms are studied:

- **Spec 10**: Zombie DOM Event Listener Leak — a capture-phase `keydown` listener left on `document` by one test intercepts Escape events in subsequent tests via `stopImmediatePropagation()`, preventing `TaskModal` from closing.
- **Spec 11**: localStorage State Pollution — a click event triggers `saveLastColumn()` which writes to `localStorage['taskboard:lastColumn']`; the next test reads the polluted value and creates a task in the wrong column.

Experimental results from Environment B (15 repetitions per mode, Chromium):

| OD Category | Runs | Failure Rate |
|-------------|------|-------------|
| ISOLATED (victim without polluter) | 30 | 0.0% |
| POLLUTER | 60 | 0.0% |
| VICTIM (with polluter) | 30 | 100.0% |
| STABLE (with cleanup fix) | 30 | 0.0% |

Both research hypotheses were confirmed: H_OD1 (victims fail significantly more often when preceded by a polluter) and H_OD2 (explicit state cleanup in `beforeEach` eliminates OD flakiness).

## Instruction

### Prerequisites

- Node.js 18+
- PostgreSQL 16 (local or Docker)
- Python 3.9+ with `pandas` and `matplotlib` (for analysis scripts)

### 1. Install dependencies

```bash
npm install
```

### 2. Database setup

```bash
# Start PostgreSQL via Docker
docker run -d \
  --name taskboard-pg \
  -e POSTGRES_DB=taskboard \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  postgres:16-alpine

# Configure environment
cp .env.example .env.local
# Edit DATABASE_URL in .env.local

# Apply schema and seed data
npm run db:push
npm run db:seed
```

### 3. Run the application

```bash
npm run dev
# http://localhost:3000
```

### 4. Install Playwright

```bash
npx playwright install chromium
```

### Environment A — Timing Flakiness (Specs 01–09)

```bash
# Full experiment — 15 repetitions, no retries
TEST_ENV=A_baseline npx playwright test \
  --config playwright.env-a.config.ts \
  --repeat-each 15 --retries 0

# Analysis
pip install pandas matplotlib
python3 scripts/analyze-env-a.py
```

Results are saved to `stress-results/analysis-a/`.

### Environment B — Order-Dependent Flakiness (Specs 10–11)

The experiment runs in three modes to isolate the OD effect:

```bash
# Step 1: Isolated — victims without polluter (expected: 0% failure)
TEST_ENV=B_od_isolated npx playwright test \
  tests/e2e/10-od-listener-leak.spec.ts \
  tests/e2e/11-od-localstorage.spec.ts \
  --config playwright.env-b.config.ts \
  --grep "ISOLATED" --repeat-each 15 --retries 0

# Step 2: Polluted — polluter precedes victim (expected: ~100% victim failure)
TEST_ENV=B_od_polluted npx playwright test \
  tests/e2e/10-od-listener-leak.spec.ts \
  tests/e2e/11-od-localstorage.spec.ts \
  --config playwright.env-b.config.ts \
  --grep "POLLUTER.VICTIM" --repeat-each 15 --retries 0

# Step 3: Stable — cleanup fix applied (expected: 0% failure)
TEST_ENV=B_od_stable npx playwright test \
  tests/e2e/10-od-listener-leak.spec.ts \
  tests/e2e/11-od-localstorage.spec.ts \
  --config playwright.env-b.config.ts \
  --grep "STABLE" --repeat-each 15 --retries 0

# Analysis
python3 scripts/analyze-env-b.py
```

Results are saved to `stress-results/analysis-b/`.

### Test Structure

| Spec | Environment | OD Category | Mechanism |
|------|-------------|-------------|-----------|
| 01–async-race | A | ED | Race condition after Submit |
| 02–toast-timing | A | R | Assertion timing on animated toast |
| 03–modal-dom-context | A | DE | Interaction with portal modal |
| 04–optimistic-rollback | A | R + ED | Optimistic UI + server rollback |
| 05–drag-and-drop | A | ED + E | DnD via @dnd-kit |
| 06–delete-dom-consistency | A | D | Delete + DOM consistency |
| 07–stress-concurrent | A | ED (stress) | 10 parallel tasks, batch DOM mutations |
| 08–stress-rapid-events | A | R + DE (stress) | Rapid sequential events |
| 09–stress-cascade-rollback | A | D (stress) | Cascade rollbacks, stale closure |
| 10–od-listener-leak | B | OD / VICTIM | Zombie capture-phase keydown listener |
| 11–od-localstorage | B | OD / VICTIM | localStorage pollution via click event |

### Viewing Reports

```bash
# Playwright HTML report
npx playwright show-report

# Environment A charts
open stress-results/analysis-a/figure_1_spec_bars.png
open stress-results/analysis-a/figure_2_pei_bars.png

# Environment B charts
open stress-results/analysis-b/figure_3_od_categories.png
open stress-results/analysis-b/figure_4_order_comparison.png
open stress-results/analysis-b/figure_5_spec_breakdown.png
```

## License

MIT License

Copyright (c) 2026 Mikhail Alekseev

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Warranty

The developed software is a research prototype created for academic purposes. The authors give no warranty regarding fitness for production use.

## References

1. Pei, Z., Sohn, J., & Papadakis, M. (2025). *An Empirical Study of DOM-Related Flaky Tests*. IEEE International Conference on Software Testing, Verification and Validation (ICST 2025).

2. Luo, Q., Hariri, F., Eloussi, L., & Marinov, D. (2014). *An Empirical Analysis of Flaky Tests*. Proceedings of the ACM SIGSOFT Symposium on the Foundations of Software Engineering (FSE 2014).

3. Luo, Q., Zaidman, A., Penta, M. D., & Bavota, G. (2019). *Characterizing and Detecting Flaky Tests in Large Open-Source Systems*. Empirical Software Engineering (EMSE 2019).

4. Playwright Documentation. Microsoft. https://playwright.dev/docs/intro

5. Next.js Documentation. Vercel. https://nextjs.org/docs

6. Prisma Documentation. Prisma Data. https://www.prisma.io/docs
