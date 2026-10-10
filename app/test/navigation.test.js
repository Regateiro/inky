// Navigation tests: go-to-anything, editor navigation history, path jump, and
// the knot/stitch sidebar navigation. Feature tests moved here from
// app/test/app.test.js when the suite was split into category files; the T8
// regression test came from app/test/regression.test.js. Relevant sources:
// renderer/goto.js, renderer/navHistory.js, renderer/navView.js.

const { test, expect } = require('@playwright/test');
const { createHarness } = require('./_launch.js');

const h = createHarness(test);

test.describe('go to anything', () => {
  test('opens go to anything dialog', async () => {
    const window = await h.openWindow();

    await h.setEditorContent(window, '=== knot1 ===\nHello World!');
    await h.waitForCompilation(window);

    await h.electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('goto-anything');
    });
    await window.waitForTimeout(500);

    const gotoDialog = window.locator('#goto-anything');
    await expect(gotoDialog).toBeVisible();
  });

  test('finds symbols by name', async () => {
    const window = await h.openWindow();

    await h.setEditorContent(window, '=== myKnot ===\nHello World!');
    await h.waitForCompilation(window);

    await h.electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('goto-anything');
    });
    await window.waitForTimeout(500);

    await window.locator('#goto-anything input').fill('myKnot');
    await window.waitForTimeout(1000);

    const results = window.locator('#goto-anything .results li');
    const count = await results.count();
    expect(count).toBeGreaterThan(0);
  });

  test('closes with escape', async () => {
    const window = await h.openWindow();

    await h.electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('goto-anything');
    });
    await window.waitForTimeout(500);

    const gotoDialog = window.locator('#goto-anything');
    await expect(gotoDialog).not.toHaveClass(/hidden/);

    await window.keyboard.press('Escape');
    await window.waitForTimeout(500);

    await expect(gotoDialog).toHaveClass(/hidden/);
  });
});

test.describe('navigation history', () => {
  test('navigates back and forward', async () => {
    const window = await h.openWindow();

    await h.setEditorContent(window, '=== knot1 ===\nLine 1\n=== knot2 ===\nLine 2');
    await h.waitForCompilation(window);

    await window.evaluate(() => {
      const editor = ace.edit('editor');
      editor.gotoLine(2, 0);
    });
    await window.waitForTimeout(500);

    await window.evaluate(() => {
      const editor = ace.edit('editor');
      editor.gotoLine(4, 0);
    });
    await window.waitForTimeout(500);

    await window.locator('.nav-back').click();
    await window.waitForTimeout(1000);

    const cursorRow = await window.evaluate(() => {
      const editor = ace.edit('editor');
      return editor.getCursorPosition().row;
    });
    expect(cursorRow).toBeLessThanOrEqual(3);
  });
});

test.describe('path jump', () => {
  test('jumps to path', async () => {
    const window = await h.openWindow();

    await h.setEditorContent(window, '=== myKnot ===\nHello World!');
    await h.waitForCompilation(window);

    await window.locator('.pathJumpInput').fill('myKnot');
    await window.locator('.pathJumpGo').click();
    await window.waitForTimeout(1000);

    const cursorRow = await window.evaluate(() => {
      const editor = ace.edit('editor');
      return editor.getCursorPosition().row;
    });
    expect(cursorRow).toBeLessThanOrEqual(1);
  });
});

test.describe('knot and stitch navigation', () => {
  test('shows knots in sidebar', async () => {
    const window = await h.openWindow();

    await h.setEditorContent(window, '=== myKnot ===\nHello World!\n=== anotherKnot ===\nMore text');
    await h.waitForCompilation(window);

    await window.locator('.knot-toggle').click();
    await window.waitForTimeout(500);

    const knotItems = window.locator('#knot-stitch-wrapper .knot');
    const count = await knotItems.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('jumps to knot when clicked', async () => {
    const window = await h.openWindow();

    await h.setEditorContent(window, '=== firstKnot ===\nLine 1\n=== secondKnot ===\nLine 2');
    await h.waitForCompilation(window);

    await window.locator('.knot-toggle').click();
    await window.waitForTimeout(500);

    const knot = window.locator('#knot-stitch-wrapper .knot').first();
    await knot.click();
    await window.waitForTimeout(500);

    const cursorRow = await window.evaluate(() => {
      const editor = ace.edit('editor');
      return editor.getCursorPosition().row;
    });
    expect(cursorRow).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// T8: Go-to-anything leaks its result-build interval (phantom results)
// Bug: goto.js refresh() returns early on an empty query BEFORE clearing
// resultsBuildInterval (and hide() never clears it), so a stale interval keeps
// rendering old results into the cleared list.
// ---------------------------------------------------------------------------
test.describe('T8: phantom results', () => {
  test('clearing the query clears the results list', async () => {
    const window = await h.openWindow();

    // Enough matches that the chunked build (10 per 35ms tick) can't finish
    // before we clear the query.
    const lines = [];
    for (let i = 0; i < 300; i++) lines.push(`phantom clue number ${i}`);
    await h.setEditorContent(window, lines.join('\n'));

    await h.sendToRenderer('goto-anything');
    await window.waitForTimeout(300);

    await window.locator('#goto-anything input').fill('phantom');
    await window.waitForTimeout(250); // build interval now running

    await window.locator('#goto-anything input').fill('');
    await window.waitForTimeout(500); // stale interval keeps appending

    const count = await window.locator('#goto-anything .results li').count();
    expect(count, 'stale build interval rendered phantom results into an empty list').toBe(0);
  });
});