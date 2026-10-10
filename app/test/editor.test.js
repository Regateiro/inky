// Editor-related tests: theme switching, zoom controls, editor behaviour
// (cursor preservation, error reporting) and the keyboard-shortcuts dialog.
// Moved here from app/test/app.test.js when the suite was split into category
// files. Relevant sources: renderer/controller.js, renderer/editorView.js.

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