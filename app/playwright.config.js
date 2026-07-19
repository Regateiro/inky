const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './test',
  testMatch: '**/*.test.js',
  timeout: 60000,
  retries: 0,
  use: {
    trace: 'on-first-retry',
    headless: true,
  },
});
