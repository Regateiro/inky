// Debugging tools tests: project statistics, the variable-query panel (single
// query, list-all, and that neither breaks the player's choices) and
// expression watching. Moved here from app/test/app.test.js when the suite
// was split into category files. Relevant source:
// renderer/expressionWatchView.js.

const { test, expect } = require('@playwright/test');
const { createHarness } = require('./_launch.js');

const h = createHarness(test);

test.describe('stats', () => {
  test('shows word count', async () => {
    const window = await h.openWindow();

    await h.setEditorContent(window, 'This is a test story with some words.\n* And a choice\nMore words here.');
    await h.waitForCompilation(window);

    window.on('dialog', async dialog => {
      expect(dialog.message()).toContain('Project statistics');
      await dialog.accept();
    });

    await h.electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('project-stats');
    });
    await window.waitForTimeout(2000);
  });
});

test.describe('variable query', () => {
  test('opens variable query panel', async () => {
    const window = await h.openWindow();

    await h.setEditorContent(window, 'VAR myVar = 5\nHello World!');
    await h.waitForCompilation(window);

    await h.electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('toggle-variable-query', true);
    });
    await window.waitForTimeout(500);

    const variableQueryPanel = window.locator('.variableQueryPanel');
    await expect(variableQueryPanel).toBeVisible();
  });

  test('queries a variable', async () => {
    const window = await h.openWindow();

    await h.setEditorContent(window, 'VAR myVar = 5\nHello World!');
    await h.waitForCompilation(window);

    await h.electronApp.evaluate(({ BrowserWindow }) => {
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
    const window = await h.openWindow();

    await h.setEditorContent(window, 'VAR myVar = 5\nHello World!');
    await h.waitForCompilation(window);

    await h.electronApp.evaluate(({ BrowserWindow }) => {
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

  test('single variable query does not break choices', async () => {
    const window = await h.openWindow();

    await h.setEditorContent(window, 'VAR myVar = 5\nHello World!\n* Choice 1\n* Choice 2\n- The end.\n-> END');
    await h.waitForCompilation(window);

    // Wait for choices to appear
    const choice = window.locator('#player .innerText.active .choice').first();
    await expect(choice).toBeVisible({ timeout: 5000 });

    await h.electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('toggle-variable-query', true);
    });
    await window.waitForTimeout(500);

    // Query a single variable
    await window.locator('.variableQueryInput').fill('myVar');
    await window.locator('.variableQueryBtn').click();
    
    // Wait for the result to be visible
    const variableQueryResult = window.locator('.variableQueryResult');
    await expect(variableQueryResult).toBeVisible({ timeout: 5000 });
    
    // Now try to make a choice - this should not crash
    // The variable query panel should not overlap with choices anymore
    await expect(choice).toBeVisible();
    await choice.click();
    
    // Wait for the story to continue
    await window.waitForTimeout(2000);
    
    // Verify we got another story text
    const storyTexts = window.locator('#player .innerText.active .storyText');
    const count = await storyTexts.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('list all variables does not break choices', async () => {
    const window = await h.openWindow();

    await h.setEditorContent(window, 'VAR myVar = 5\nHello World!\n* Choice 1\n* Choice 2\n- The end.\n-> END');
    await h.waitForCompilation(window);

    // Wait for choices to appear
    const choice = window.locator('#player .innerText.active .choice').first();
    await expect(choice).toBeVisible({ timeout: 5000 });

    await h.electronApp.evaluate(({ BrowserWindow }) => {
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
    
    // Now try to make a choice - this should not crash
    // The variable query panel should not overlap with choices anymore
    await expect(choice).toBeVisible();
    await choice.click();
    
    // Wait for the story to continue
    await window.waitForTimeout(1000);
    
    // Verify we got "The end." text
    const storyTexts = window.locator('#player .innerText.active .storyText');
    const count = await storyTexts.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('closes variable query panel', async () => {
    const window = await h.openWindow();

    await h.electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('toggle-variable-query', true);
    });
    await window.waitForTimeout(500);

    const variableQueryPanel = window.locator('.variableQueryPanel');
    await expect(variableQueryPanel).toBeVisible();

    await h.electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('toggle-variable-query', false);
    });
    await window.waitForTimeout(500);

    await expect(variableQueryPanel).toBeHidden();
  });
});

test.describe('expression watch', () => {
  test('adds expression watch', async () => {
    const window = await h.openWindow();

    await h.setEditorContent(window, 'VAR myVar = 5\nHello World!');
    await h.waitForCompilation(window);

    await h.electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('add-watch-expression');
    });
    await window.waitForTimeout(500);

    const expressionWatch = window.locator('.expressionWatch');
    await expect(expressionWatch).toBeVisible();
  });
});