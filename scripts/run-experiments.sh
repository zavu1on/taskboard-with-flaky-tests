TEST_ENV=A_baseline npx playwright test \
  --config playwright.env-a.config.ts \
  --repeat-each 15 --retries 0
