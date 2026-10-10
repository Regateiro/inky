// Editor-related tests: theme switching, zoom controls, editor behaviour
// (cursor preservation, error reporting) and the keyboard-shortcuts dialog.
// Feature tests moved here from app/test/app.test.js when the suite was split
// into category files; the T9 regression test came from app/test/regression.test.js.
// Relevant sources: renderer/controller.js, renderer/editorView.js.

const { test, expect } = require('@playwright/test');
const { createHarness } = require('./_launch.js');

const h = createHarness(test);

test.describe('theme switching', () => {
  test('switches to dark theme', async () => {
    const window = await h.openWindow();

    await h.electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('change-theme', 'dark');
    });
    await window.waitForTimeout(500);

    const windowEl = window.locator('.window');
    await expect(windowEl).toHaveClass(/dark/);
  });

  test('switches to contrast theme', async () => {
    const window = await h.openWindow();

    await h.electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('change-theme', 'contrast');
    });
    await window.waitForTimeout(500);

    const windowEl = window.locator('.window');
    await expect(windowEl).toHaveClass(/contrast/);
  });

  test('switches to focus theme', async () => {
    const window = await h.openWindow();

    await h.electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('change-theme', 'focus');
    });
    await window.waitForTimeout(500);

    const windowEl = window.locator('.window');
    await expect(windowEl).toHaveClass(/focus/);
  });
});

test.describe('zoom controls', () => {
  test('zooms in', async () => {
    const window = await h.openWindow();

    const initialSize = await window.evaluate(() => {
      const editorEl = document.getElementById('editor');
      return editorEl.style.fontSize || '12px';
    });

    await h.electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('zoom', 2);
    });
    await window.waitForTimeout(500);

    const newSize = await window.evaluate(() => {
      const editorEl = document.getElementById('editor');
      return editorEl.style.fontSize;
    });

    expect(parseFloat(newSize)).toBeGreaterThan(parseFloat(initialSize));
  });

  test('zooms out', async () => {
    const window = await h.openWindow();

    await h.electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('zoom', 150);
    });
    await window.waitForTimeout(500);

    const largerSize = await window.evaluate(() => {
      const editorEl = document.getElementById('editor');
      return editorEl.style.fontSize;
    });

    await h.electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('zoom', -2);
    });
    await window.waitForTimeout(500);

    const smallerSize = await window.evaluate(() => {
      const editorEl = document.getElementById('editor');
      return editorEl.style.fontSize;
    });

    expect(parseFloat(smallerSize)).toBeLessThan(parseFloat(largerSize));
  });
});

test.describe('editor features', () => {
  test('maintains cursor position after compilation', async () => {
    const window = await h.openWindow();

    await h.setEditorContent(window, 'Line 1\nLine 2\nLine 3\nLine 4');
    await window.waitForTimeout(500);

    await window.evaluate(() => {
      const editor = ace.edit('editor');
      editor.gotoLine(3, 2);
    });
    await window.waitForTimeout(500);

    const cursorPos = await window.evaluate(() => {
      const editor = ace.edit('editor');
      return editor.getCursorPosition();
    });
    expect(cursorPos.row).toBe(2);
  });

  test('shows syntax errors', async () => {
    const window = await h.openWindow();

    await h.setEditorContent(window, '-> invalid_divert');
    await h.waitForCompilation(window);

    const issuesSummary = window.locator('.issuesSummary');
    await expect(issuesSummary).toBeVisible();
  });
});

test.describe('keyboard shortcuts', () => {
  test('shows keyboard shortcuts dialog', async () => {
    const window = await h.openWindow();

    window.on('dialog', async dialog => {
      expect(dialog.message()).toContain('Useful Keyboard Shortcuts');
      await dialog.accept();
    });

    await h.electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('keyboard-shortcuts');
    });
    await window.waitForTimeout(2000);
  });
});

// ---------------------------------------------------------------------------
// T9: changing the theme triggers a full recompile + replay
// Bug: controller.js:557 updateTheme() calls LiveCompiler.setEdited(), which
// makes the compile loop restart and replay the story ~500ms later.
// ---------------------------------------------------------------------------
test.describe('T9: theme change', () => {
  test('changing the theme does not recompile the story', async () => {
    const window = await h.openWindow();

    await window.evaluate(() => {
      const { LiveCompiler } = require(process.cwd() + '/renderer/liveCompiler.js');
      window.__resetCount = 0;
      LiveCompiler.on('resetting', () => { window.__resetCount++; });
    });

    // Make an edit so the compile loop definitely runs at least once and the
    // listener is proven to work.
    await h.setEditorContent(window, 'Hello world. This is a regression test.');
    await window.waitForTimeout(3000);

    const baseline = await window.evaluate(() => window.__resetCount);
    expect(baseline, 'sanity: app compiled after an edit').toBeGreaterThan(0);

    await window.evaluate(() => { window.__resetCount = 0; });
    await h.sendToRenderer('change-theme', 'dark');
    await window.waitForTimeout(1800);

    const after = await window.evaluate(() => window.__resetCount);
    expect(after, 'theme change must not trigger a recompile/replay').toBe(0);
  });
});