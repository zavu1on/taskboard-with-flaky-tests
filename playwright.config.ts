import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/e2e",
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0, // retries=0 при локальной отладке - показывает реальный флак
	workers: 1,
	reporter: [
		["html", { outputFolder: "playwright-report", open: "never" }],
		["list"],
	],

	use: {
		baseURL: "http://localhost:3000",
		trace: "retain-on-failure",
		video: "retain-on-failure",
		screenshot: "only-on-failure",
		actionTimeout: 10_000,
		navigationTimeout: 15_000,
	},

	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
		{
			name: "firefox",
			use: { ...devices["Desktop Firefox"] },
		},
	],

	webServer: {
		command: "npm run dev",
		url: "http://localhost:3000",
		reuseExistingServer: !process.env.CI,
		timeout: 60_000,
	},
});
