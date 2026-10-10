// Find-in-project tests: opening the search panel, finding text across the
// open buffer, dismissing it, and the result cap that keeps broad searches
// responsive. Feature tests moved here from app/test/app.test.js when the
// suite was split into category files; the M10 regression test came from
// app/test/robustness.test.js. Relevant source: renderer/findInProject.js.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
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

// ---------------------------------------------------------------------------
// M10: find-in-project has no result cap or debounce
// Bug: findInProject.js renders one DOM row per match with no limit — a
// broad search over a large project freezes the renderer.
// ---------------------------------------------------------------------------
test.describe('M10: find-in-project result cap', () => {
  test('broad searches render a bounded number of results', async () => {
    const dir = h.makeTempDir('inky-m10-');
    const mainPath = path.join(dir, 'story.ink');
    let content = '';
    for (let i = 0; i < 400; i++) content += `line ${i} needle here\n`;
    fs.writeFileSync(mainPath, content);

    const window = await h.openWindow();

    await window.evaluate((p) => {
      const { InkProject } = require('./inkProject.js');
      InkProject.currentProject = new InkProject(p);
    }, mainPath);

    await h.electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('find-in-project');
    });
    await window.waitForSelector('#find-in-project .fip-search-input', { state: 'visible' });
    await window.fill('#find-in-project .fip-search-input', 'needle');

    await window.waitForFunction(() => {
      return document.querySelectorAll('#find-in-project .fip-results li.fip-match').length > 0;
    }, { timeout: 15000 });

    const matchRows = await window.evaluate(
      () => document.querySelectorAll('#find-in-project .fip-results li.fip-match').length
    );
    expect(matchRows, 'some results should render').toBeGreaterThan(0);
    expect(matchRows, 'rendered results must be capped').toBeLessThanOrEqual(200);

    // The match count must still report the true total.
    const label = await window.locator('#find-in-project .fip-match-count').textContent();
    expect(label, 'match count should report the real total').toContain('400');
  });
});