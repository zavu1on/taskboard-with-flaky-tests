/**
 * reporters/flaky-json-reporter.ts
 *
 * Кастомный Playwright репортер для сбора данных флакинесса.
 * Пишет NDJSON (newline-delimited JSON) — один объект на строку.
 * Это позволяет безопасно аппендить записи без перезаписи файла.
 *
 * Запись содержит:
 *  - env:        среда (A_baseline / B_cpu_throttle / C_network_delay)
 *  - spec:       имя spec-файла (01-async-race, …)
 *  - title:      заголовок теста
 *  - category:   FLAKY / STABLE / STRESS (из заголовка теста)
 *  - status:     passed / failed / timedOut / skipped
 *  - duration:   мс
 *  - retry:      номер попытки (0 = первая)
 *  - timestamp:  ISO-строка
 *  - errors:     массив строк с сообщениями об ошибках
 */

import type {
	FullConfig,
	FullResult,
	Reporter,
	Suite,
	TestCase,
	TestResult,
} from "@playwright/test/reporter";
import fs from "fs";
import path from "path";

interface FlakiRecord {
	env: string;
	spec: string;
	title: string;
	category: "FLAKY" | "STABLE" | "STRESS" | "UNKNOWN";
	status: TestResult["status"];
	duration: number;
	retry: number;
	timestamp: string;
	errors: string[];
	workerIndex: number;
}

function extractCategory(title: string): FlakiRecord["category"] {
	if (title.includes("[FLAKY]")) return "FLAKY";
	if (title.includes("[STABLE]")) return "STABLE";
	if (title.includes("[STRESS]")) return "STRESS";
	return "UNKNOWN";
}

function extractSpec(filePath: string): string {
	// "tests/e2e/01-async-race.spec.ts" -> "01-async-race"
	const base = path.basename(filePath, ".spec.ts");
	return base;
}

class FlakyJsonReporter implements Reporter {
	private outputPath: string;
	private env: string;
	private fd: number | null = null;

	constructor(options: { outputFile?: string; env?: string } = {}) {
		this.env = options.env ?? process.env.TEST_ENV ?? "A_baseline";
		this.outputPath =
			options.outputFile ??
			process.env.FLAKY_REPORT_FILE ??
			path.join(process.cwd(), "stress-results", `${this.env}.ndjson`);
	}

	onBegin(_config: FullConfig, _suite: Suite): void {
		const dir = path.dirname(this.outputPath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
		// Открываем файл в режиме append — безопасно для параллельных воркеров
		this.fd = fs.openSync(this.outputPath, "a");
		console.log(`[FlakyReporter] env=${this.env} -> ${this.outputPath}`);
	}

	onTestEnd(test: TestCase, result: TestResult): void {
		if (!this.fd) return;

		const record: FlakiRecord = {
			env: this.env,
			spec: extractSpec(test.location.file),
			title: test.title,
			category: extractCategory(test.title),
			status: result.status,
			duration: result.duration,
			retry: result.retry,
			timestamp: new Date().toISOString(),
			errors: result.errors.map((e) =>
				(e.message ?? "").split("\n")[0].slice(0, 200),
			),
			workerIndex: result.workerIndex,
		};

		fs.writeSync(this.fd, JSON.stringify(record) + "\n");
	}

	onEnd(_result: FullResult): void {
		if (this.fd !== null) {
			fs.closeSync(this.fd);
			this.fd = null;
		}
		console.log(`[FlakyReporter] Done -> ${this.outputPath}`);
	}
}

export default FlakyJsonReporter;
