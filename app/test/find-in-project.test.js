// Find-in-project tests: opening the search panel, finding text across the
// open buffer, and dismissing it. Moved here from app/test/app.test.js when
// the suite was split into category files. Relevant source:
// renderer/findInProject.js.

const { test, expect } = require('@playwright/test');
const { createHarness } = require('./_launch.js');

const h = createHarness(test);

test.describe('find in project', () => {
  test('opens find in project dialog', async () => {
    const window = await h.openWindow();

    await h.setEditorContent(window, 'Hello World!\nThis is a test.');
    await h.waitForCompilation(window);

    await h.electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('find-in-project');
    });
    await window.waitForTimeout(500);

    const findPanel = window.locator('#find-in-project');
    await expect(findPanel).toBeVisible();
  });

  test('finds text in editor', async () => {
    const window = await h.openWindow();

    await h.setEditorContent(window, 'Hello World!\nThis is a test.\nHello again!');
    await h.waitForCompilation(window);

    await h.electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('find-in-project');
    });
    await window.waitForTimeout(500);

    await window.locator('.fip-search-input').fill('Hello');
    await window.waitForTimeout(500);

    const matchCount = await window.locator('.fip-match-count').textContent();
    expect(matchCount).toContain('2');
  });

  test('closes find panel with escape', async () => {
    const window = await h.openWindow();

    await h.electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('find-in-project');
    });
    await window.waitForTimeout(500);

    await window.keyboard.press('Escape');
    await window.waitForTimeout(500);

    const findPanel = window.locator('#find-in-project');
    await expect(findPanel).toBeHidden();
  });
});