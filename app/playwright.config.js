const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './test',
  testMatch: '**/test.js',
  timeout: 30000,
  retries: 0,
  use: {
    trace: 'on-first-retry',
  },
});
