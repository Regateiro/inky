// Debugging tools tests: project statistics, the variable-query panel (single
// query, list-all, and that neither breaks the player's choices), expression
// watching, and the LiveCompiler IPC machinery that backs them (stale replies,
// the query-timeout race and concurrent evaluations). Feature tests moved here
// from app/test/app.test.js when the suite was split into category files; the
// T1/T10/M7 regression tests came from app/test/regression.test.js and
// app/test/robustness.test.js. Relevant sources: renderer/expressionWatchView.js,
// renderer/liveCompiler.js.

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

// ---------------------------------------------------------------------------
// T1: stale compiler IPC replies must not throw
// Bug: liveCompiler.js reads `xxxObj.sessionId` before checking `xxxObj`,
// and invokes the stats callback without a null guard. Any late, duplicate or
// unsolicited reply crashes inside the ipc listener.
// ---------------------------------------------------------------------------
test.describe('T1: stale compiler IPC replies', () => {
  test('reply with no pending callback must not throw', async () => {
    const window = await h.openWindow();

    const attempts = await window.evaluate(() => {
      const { ipcRenderer } = require('electron');
      const results = {};
      const tryEmit = (name, fn) => {
        try { fn(); results[name] = 'ok'; }
        catch (e) { results[name] = String(e); }
      };
      // All callback slots are empty on a freshly started app.
      tryEmit('expression', () =>
        ipcRenderer.emit('play-evaluated-expression', {}, 'text', 'no-such-session'));
      tryEmit('expressionError', () =>
        ipcRenderer.emit('play-evaluated-expression-error', {}, 'err', 'no-such-session'));
      tryEmit('location', () =>
        ipcRenderer.emit('return-location-from-source', {}, 'no-such-session', {}));
      tryEmit('variables', () =>
        ipcRenderer.emit('return-variables-list', {}, 'list', 'no-such-session'));
      // No stats request in flight => currentStatsSessionId === null
      tryEmit('stats', () => ipcRenderer.emit('return-stats', {}, {}, null));
      return results;
    });

    for (const [name, outcome] of Object.entries(attempts)) {
      expect(outcome, `handler '${name}' threw for a stale reply`).toBe('ok');
    }
  });
});

// ---------------------------------------------------------------------------
// T10: "query all variables" timeout race
// Bug: controller.js:357-385 — the 2s timeout advances to the next variable
// but never marks the request completed, so a late response walks the chain a
// second time and duplicates results.
// ---------------------------------------------------------------------------
test.describe('T10: variable query timeout race', () => {
  test('late response after timeout must not duplicate results', async () => {
    const window = await h.openWindow();

    await h.setEditorContent(window, 'VAR alpha_num = 1\nVAR beta_num = 2\n');
    await window.waitForTimeout(500);

    const result = await window.evaluate(async () => {
      const { LiveCompiler } = require(process.cwd() + '/renderer/liveCompiler.js');
      const { ExpressionWatchView } =
        require(process.cwd() + '/renderer/expressionWatchView.js');

      const origEvaluate = LiveCompiler.evaluateExpression;
      let lateCallback = null;
      const queried = [];
      LiveCompiler.evaluateExpression = (expr, cb) => {
        queried.push(expr);
        if (!lateCallback) lateCallback = cb; // first variable: never answered now
        else cb('0', null);                   // later variables answer immediately
      };

      const readResult = () => {
        const el = document.querySelector('#player .variableQueryResult');
        return el ? el.textContent : '';
      };

      ExpressionWatchView.eventEmitter.emit('listVariables');
      await new Promise((r) => setTimeout(r, 2400)); // let the 2s timeout fire
      const before = readResult();

      if (lateCallback) lateCallback('42', null); // response arrives too late
      await new Promise((r) => setTimeout(r, 300));
      const after = readResult();

      LiveCompiler.evaluateExpression = origEvaluate;
      return { before, after, queried };
    });

    const count = (text, name) => (text.match(new RegExp(name, 'g')) || []).length;
    expect(result.queried.length, 'sanity: variables were queried').toBeGreaterThanOrEqual(2);
    expect(count(result.after, 'alpha_num'),
      'late response re-advanced the query chain (alpha duplicated)').toBe(1);
    expect(count(result.after, 'beta_num'),
      'late response re-queried the chain (beta duplicated)').toBe(1);
  });
});

// ---------------------------------------------------------------------------
// M7: LiveCompiler single-slot callbacks
// Bug: liveCompiler.js keeps one callback slot per request type. A second
// evaluateExpression (or variables-list) request orphans the first forever —
// and the surviving slot receives the *first* request's result, so the
// caller gets the wrong answer.
// ---------------------------------------------------------------------------
test.describe('M7: concurrent compiler requests', () => {
  test('concurrent expression evaluations all get their own answer', async () => {
    const window = await h.openWindow();
    await h.setEditorContent(window, 'VAR myVar = 5\nHello World!');
    await window.waitForFunction(() => {
      const el = document.querySelector('#player .innerText.active');
      return el && el.textContent.includes('Hello World!');
    }, { timeout: 20000 });

    const results = await window.evaluate(async () => {
      return await new Promise((resolve) => {
        const { LiveCompiler } = require('./liveCompiler.js');
        const got = [];
        LiveCompiler.evaluateExpression('myVar', (r) => { got.push(['a', r]); });
        LiveCompiler.evaluateExpression('1+1', (r) => { got.push(['b', r]); });
        const done = () => resolve(got);
        setTimeout(done, 8000);
        const check = setInterval(() => {
          if (got.length >= 2) { clearInterval(check); done(); }
        }, 50);
      });
    });

    expect(results.length, 'both callbacks must fire').toBe(2);
    expect(results[0], 'first request must get the first answer').toEqual(['a', '5']);
    expect(results[1], 'second request must get the second answer').toEqual(['b', '2']);
  });
});