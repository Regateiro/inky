// Application launch tests: the app starts into a usable window with the
// expected chrome (title bar, sidebar navigation). Moved here from
// app/test/app.test.js when the suite was split into category files.

const { test, expect } = require('@playwright/test');
const { createHarness } = require('./_launch.js');

const h = createHarness(test);

test.describe('application launch tests', () => {
  test('shows an initial window', async () => {
    const window = await h.openWindow();
    expect(window).toBeTruthy();
  });

  test('reads the title', async () => {
    const window = await h.openWindow();
    await window.waitForSelector('h1.title', { state: 'attached' });
    const title = await window.locator('h1.title').textContent();
    expect(title.trim()).toBe('Untitled.ink');
  });

  test('opens the sidebar', async () => {
    const window = await h.openWindow();
    await window.locator('.nav-toggle').click();
    const sidebar = window.locator('.sidebar');
    await expect(sidebar).not.toHaveClass(/hidden/);
  });
});