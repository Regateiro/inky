// Project tests: managing the project's files in the sidebar (creating
// include files). Moved here from app/test/app.test.js when the suite was
// split into category files. Relevant sources: renderer/inkProject.js,
// renderer/navView.js.

const { test, expect } = require('@playwright/test');
const { createHarness } = require('./_launch.js');

const h = createHarness(test);

test.describe('include file creation', () => {
  test('creates new include file', async () => {
    const window = await h.openWindow();

    await window.locator('.nav-toggle').click();
    await window.waitForTimeout(500);

    await window.locator('.add-include-button').click();
    await window.waitForTimeout(500);

    await window.locator('.new-include-form input[type="text"]').fill('chapter1.ink');
    await window.locator('#add-include').click();
    await window.waitForTimeout(1000);

    const fileItems = window.locator('.nav-group-item .filename');
    const count = await fileItems.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('cancels include creation', async () => {
    const window = await h.openWindow();

    await window.locator('.nav-toggle').click();
    await window.waitForTimeout(500);

    await window.locator('.add-include-button').click();
    await window.waitForTimeout(500);

    const footer = window.locator('.sidebar .footer');
    await expect(footer).toHaveClass(/showingForm/);

    await window.locator('#cancel-add-include').click();
    await window.waitForTimeout(1000);

    await expect(footer).not.toHaveClass(/showingForm/);
  });
});