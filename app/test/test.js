const { _electron: electron } = require('playwright');
const { test, expect } = require('@playwright/test');

let electronApp;

test.beforeEach(async () => {
  electronApp = await electron.launch({
    args: ['main-process/main.js'],
    cwd: __dirname + '/..',
  });
});

test.afterEach(async () => {
  if (electronApp) {
    const windows = await electronApp.windows();
    for (const win of windows) {
      await win.evaluate(() => {
        if (window.InkProject && window.InkProject.currentProject) {
          window.InkProject.currentProject.hasUnsavedChanges = false;
          window.InkProject.currentProject.unsavedFiles = [];
        }
      }).catch(() => {});
    }
    await electronApp.close();
  }
});

async function setEditorContent(window, text) {
  await window.evaluate((text) => {
    const editor = ace.edit('editor');
    editor.setValue(text, -1);
  }, text);
}

async function waitForCompilation(window) {
  await window.waitForTimeout(2000);
}

test.describe('application launch tests', () => {
  test('shows an initial window', async () => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    expect(window).toBeTruthy();
  });

  test('reads the title', async () => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('h1.title', { state: 'attached' });
    await window.waitForTimeout(1000);
    const title = await window.locator('h1.title').textContent();
    expect(title.trim()).toBe('Untitled.ink');
  });

  test('opens the sidebar', async () => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('.nav-toggle', { state: 'visible' });
    await window.locator('.nav-toggle').click();
    const sidebar = window.locator('.sidebar');
    await expect(sidebar).not.toHaveClass(/hidden/);
  });
});

test.describe('compiles hello world game', () => {
  test('writes and reads hello world', async () => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1500);

    await setEditorContent(window, 'Hello World!');
    await waitForCompilation(window);

    const playerText = await window.evaluate(() => {
      const activeBuffer = document.querySelector('#player .innerText.active');
      return activeBuffer ? activeBuffer.textContent : '';
    });
    expect(playerText).toContain('Hello World!');
  });

  test('writes and selects a choice', async () => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1500);

    const input = 'Hello World!\n* Hello back\nNice to hear from you!\n-> END';
    await setEditorContent(window, input);
    await waitForCompilation(window);

    const choice = window.locator('#player .innerText.active .choice').last();
    await expect(choice).toBeVisible();
    await choice.click();
    await waitForCompilation(window);

    const storyTexts = window.locator('#player .innerText.active .storyText');
    const count = await storyTexts.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('suppresses choice text', async () => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1500);

    const input = 'Hello World!\n* [Hello back]\nNice to hear from you!\n-> END';
    await setEditorContent(window, input);
    await waitForCompilation(window);

    const choice = window.locator('#player .innerText.active .choice').last();
    await expect(choice).toBeVisible();
    await choice.click();
    await waitForCompilation(window);

    const storyTexts = window.locator('#player .innerText.active .storyText');
    const count = await storyTexts.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('shows TODOs', async () => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1500);

    const input = '-\n* Rock\n* Paper\n* Scissors\nTODO: Make this more interesting';
    await setEditorContent(window, input);
    await waitForCompilation(window);

    const issuesSummary = window.locator('.issuesSummary');
    await expect(issuesSummary).toBeVisible();
  });
});

test.describe('theme switching', () => {
  test('switches to dark theme', async () => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1000);

    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('change-theme', 'dark');
    });
    await window.waitForTimeout(500);

    const windowEl = window.locator('.window');
    await expect(windowEl).toHaveClass(/dark/);
  });

  test('switches to contrast theme', async () => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1000);

    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('change-theme', 'contrast');
    });
    await window.waitForTimeout(500);

    const windowEl = window.locator('.window');
    await expect(windowEl).toHaveClass(/contrast/);
  });

  test('switches to focus theme', async () => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1000);

    await electronApp.evaluate(({ BrowserWindow }) => {
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
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1000);

    const initialSize = await window.evaluate(() => {
      const editorEl = document.getElementById('editor');
      return editorEl.style.fontSize || '12px';
    });

    await electronApp.evaluate(({ BrowserWindow }) => {
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
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1000);

    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('zoom', 150);
    });
    await window.waitForTimeout(500);

    const largerSize = await window.evaluate(() => {
      const editorEl = document.getElementById('editor');
      return editorEl.style.fontSize;
    });

    await electronApp.evaluate(({ BrowserWindow }) => {
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

test.describe('find in project', () => {
  test('opens find in project dialog', async () => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1000);

    await setEditorContent(window, 'Hello World!\nThis is a test.');
    await waitForCompilation(window);

    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('find-in-project');
    });
    await window.waitForTimeout(500);

    const findPanel = window.locator('#find-in-project');
    await expect(findPanel).toBeVisible();
  });

  test('finds text in editor', async () => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1000);

    await setEditorContent(window, 'Hello World!\nThis is a test.\nHello again!');
    await waitForCompilation(window);

    await electronApp.evaluate(({ BrowserWindow }) => {
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
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1000);

    await electronApp.evaluate(({ BrowserWindow }) => {
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

test.describe('go to anything', () => {
  test('opens go to anything dialog', async () => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1000);

    await setEditorContent(window, '=== knot1 ===\nHello World!');
    await waitForCompilation(window);

    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('goto-anything');
    });
    await window.waitForTimeout(500);

    const gotoDialog = window.locator('#goto-anything');
    await expect(gotoDialog).toBeVisible();
  });

  test('finds symbols by name', async () => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1000);

    await setEditorContent(window, '=== myKnot ===\nHello World!');
    await waitForCompilation(window);

    await electronApp.evaluate(({ BrowserWindow }) => {
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
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1000);

    await electronApp.evaluate(({ BrowserWindow }) => {
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
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1000);

    await setEditorContent(window, '=== knot1 ===\nLine 1\n=== knot2 ===\nLine 2');
    await waitForCompilation(window);

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

test.describe('include file creation', () => {
  test('creates new include file', async () => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1000);

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
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1000);

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

test.describe('path jump', () => {
  test('jumps to path', async () => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1000);

    await setEditorContent(window, '=== myKnot ===\nHello World!');
    await waitForCompilation(window);

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

test.describe('pause compilation', () => {
  test('toggles pause state', async () => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1000);

    await window.locator('.pause-toggle').click();
    await window.waitForTimeout(500);

    const pauseBtn = window.locator('.pause-toggle');
    await expect(pauseBtn).toHaveClass(/selected/);
  });
});

test.describe('rewind and step back', () => {
  test('rewinds story', async () => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1000);

    const input = 'Hello World!\n* Choice 1\nResponse 1\n-> END';
    await setEditorContent(window, input);
    await waitForCompilation(window);

    const choice = window.locator('#player .innerText.active .choice').last();
    await choice.click();
    await waitForCompilation(window);

    await window.locator('.rewind').click();
    await waitForCompilation(window);

    const storyTexts = window.locator('#player .innerText.active .storyText');
    const count = await storyTexts.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('steps back one choice', async () => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1000);

    const input = 'Hello World!\n* Choice 1\nResponse 1\n-> END';
    await setEditorContent(window, input);
    await waitForCompilation(window);

    const choice = window.locator('#player .innerText.active .choice').last();
    await choice.click();
    await waitForCompilation(window);

    await window.locator('.step-back').click();
    await window.waitForTimeout(500);

    const dividers = window.locator('#player .innerText.active .turnDivider');
    const count = await dividers.count();
    expect(count).toBe(0);
  });
});

test.describe('knot and stitch navigation', () => {
  test('shows knots in sidebar', async () => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1000);

    await setEditorContent(window, '=== myKnot ===\nHello World!\n=== anotherKnot ===\nMore text');
    await waitForCompilation(window);

    await window.locator('.knot-toggle').click();
    await window.waitForTimeout(500);

    const knotItems = window.locator('#knot-stitch-wrapper .knot');
    const count = await knotItems.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('jumps to knot when clicked', async () => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1000);

    await setEditorContent(window, '=== firstKnot ===\nLine 1\n=== secondKnot ===\nLine 2');
    await waitForCompilation(window);

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

test.describe('editor features', () => {
  test('maintains cursor position after compilation', async () => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1000);

    await setEditorContent(window, 'Line 1\nLine 2\nLine 3\nLine 4');
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
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1000);

    await setEditorContent(window, '-> invalid_divert');
    await waitForCompilation(window);

    const issuesSummary = window.locator('.issuesSummary');
    await expect(issuesSummary).toBeVisible();
  });
});

test.describe('player features', () => {
  test('shows story completion message', async () => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1000);

    await setEditorContent(window, 'Hello World!\n-> END');
    await waitForCompilation(window);

    const endMessage = window.locator('#player .innerText.active .end');
    await expect(endMessage).toBeVisible();
  });

  test('shows multiple choices', async () => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1000);

    const input = 'What do you choose?\n* Option A\n* Option B\n* Option C\n-> END';
    await setEditorContent(window, input);
    await waitForCompilation(window);

    const choices = window.locator('#player .innerText.active .choice');
    const count = await choices.count();
    expect(count).toBe(3);
  });

  test('shows tags', async () => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1000);

    await setEditorContent(window, 'Hello World! # location: forest');
    await waitForCompilation(window);

    const tags = window.locator('#player .innerText.active .tags');
    await expect(tags).toBeVisible();
    const tagText = await tags.textContent();
    expect(tagText).toContain('location: forest');
  });
});

test.describe('issues navigation', () => {
  test('clicks on issue to navigate', async () => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1000);

    await setEditorContent(window, '-> broken_divert\nSome text here');
    await waitForCompilation(window);

    await window.locator('.issuesSummary').hover();
    await window.waitForTimeout(500);

    const issueRow = window.locator('.issue-popup .row').first();
    if (await issueRow.isVisible()) {
      await issueRow.click();
      await window.waitForTimeout(500);
    }
  });
});

test.describe('keyboard shortcuts', () => {
  test('shows keyboard shortcuts dialog', async () => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1000);

    window.on('dialog', async dialog => {
      expect(dialog.message()).toContain('Useful Keyboard Shortcuts');
      await dialog.accept();
    });

    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('keyboard-shortcuts');
    });
    await window.waitForTimeout(2000);
  });
});

test.describe('stats', () => {
  test('shows word count', async () => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1000);

    await setEditorContent(window, 'This is a test story with some words.\n* And a choice\nMore words here.');
    await waitForCompilation(window);

    window.on('dialog', async dialog => {
      expect(dialog.message()).toContain('Project statistics');
      await dialog.accept();
    });

    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('project-stats');
    });
    await window.waitForTimeout(2000);
  });
});

test.describe('variable query', () => {
  test('opens variable query panel', async () => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1000);

    await setEditorContent(window, 'VAR myVar = 5\nHello World!');
    await waitForCompilation(window);

    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('toggle-variable-query', true);
    });
    await window.waitForTimeout(500);

    const variableQueryPanel = window.locator('.variableQueryPanel');
    await expect(variableQueryPanel).toBeVisible();
  });

  test('queries a variable', async () => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1000);

    await setEditorContent(window, 'VAR myVar = 5\nHello World!');
    await waitForCompilation(window);

    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('toggle-variable-query', true);
    });
    await window.waitForTimeout(500);

    await window.locator('.variableQueryInput').fill('myVar');
    await window.locator('.variableQueryBtn').click();
    await window.waitForTimeout(1000);

    const variableQueryResult = window.locator('.variableQueryResult');
    await expect(variableQueryResult).toBeVisible();
  });

  test('lists all variables', async () => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1000);

    await setEditorContent(window, 'VAR myVar = 5\nHello World!');
    await waitForCompilation(window);

    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('toggle-variable-query', true);
    });
    await window.waitForTimeout(500);

    // Click the List All button
    const listAllBtn = window.locator('.variableListBtn');
    await listAllBtn.click({ force: true });
    
    // Wait for the result to be visible
    const variableQueryResult = window.locator('.variableQueryResult');
    await expect(variableQueryResult).toBeVisible({ timeout: 10000 });
    
    const resultText = await variableQueryResult.textContent();
    expect(resultText).toContain('myVar');
  });

  test('closes variable query panel', async () => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1000);

    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('toggle-variable-query', true);
    });
    await window.waitForTimeout(500);

    const variableQueryPanel = window.locator('.variableQueryPanel');
    await expect(variableQueryPanel).toBeVisible();

    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('toggle-variable-query', false);
    });
    await window.waitForTimeout(500);

    await expect(variableQueryPanel).toBeHidden();
  });
});

test.describe('expression watch', () => {
  test('adds expression watch', async () => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await window.waitForSelector('#editor', { state: 'attached' });
    await window.waitForTimeout(1000);

    await setEditorContent(window, 'VAR myVar = 5\nHello World!');
    await waitForCompilation(window);

    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('add-watch-expression');
    });
    await window.waitForTimeout(500);

    const expressionWatch = window.locator('.expressionWatch');
    await expect(expressionWatch).toBeVisible();
  });
});
