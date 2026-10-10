// Regression tests for known bugs (tracked in app/test/TODO.md).
//
// Each test asserts the CORRECT behaviour. They were written against the
// unfixed code, verified to fail with the bug's exact error signature, and
// pass only because the bugs have since been fixed. Keep these green by
// fixing bugs — never by weakening the assertions.

const { _electron: electron } = require('playwright');
const { test, expect } = require('@playwright/test');
const os = require('os');
const fs = require('fs');
const path = require('path');

let electronApp;
let userDataDir;
const tempDirs = [];

test.beforeEach(async () => {
  // Isolated user data dir per test: tests never touch the real profile, and
  // the single-instance lock (which is per user data dir) can't leak between
  // parallel test files.
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inky-test-ud-'));
  electronApp = await electron.launch({
    args: ['main-process/main.js', '--test-mode', '--user-data-dir', userDataDir],
    cwd: __dirname + '/..',
    headless: true,
    env: { ...process.env, NODE_ENV: 'test' },
  });
});

test.afterEach(async () => {
  if (electronApp) {
    // Guard against teardown hangs: force-kill if close doesn't finish.
    await Promise.race([
      electronApp.close(),
      new Promise((r) => setTimeout(r, 8000)),
    ]).catch(() => {});
    try { electronApp.process().kill('SIGKILL'); } catch (e) {}
    electronApp = null;
  }
  if (userDataDir) {
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
    userDataDir = null;
  }
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  }
});

async function openWindow() {
  const window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForSelector('#editor', { state: 'attached' });
  await window.waitForTimeout(1500);
  return window;
}

async function setEditorContent(window, text) {
  await window.evaluate((text) => {
    ace.edit('editor').setValue(text, -1);
  }, text);
}

// Send an IPC message to the renderer, as the native menus do.
async function sendToRenderer(channel, ...args) {
  await electronApp.evaluate(({ BrowserWindow }, payload) => {
    BrowserWindow.getAllWindows()[0].webContents.send(payload.channel, ...payload.args);
  }, { channel, args });
}

function makeTempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// T1: stale compiler IPC replies must not throw
// Bug: liveCompiler.js reads `xxxObj.sessionId` before checking `xxxObj`,
// and invokes the stats callback without a null guard. Any late, duplicate or
// unsolicited reply crashes inside the ipc listener.
// ---------------------------------------------------------------------------
test.describe('T1: stale compiler IPC replies', () => {
  test('reply with no pending callback must not throw', async () => {
    const window = await openWindow();

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
// T2: addNewInclude() with an absolute path
// Bug: inkProject.js:91 calls `assert(...)` but never requires it, so adding
// an include from an absolute path dies with ReferenceError.
// ---------------------------------------------------------------------------
test.describe('T2: absolute-path include', () => {
  test('addNewInclude with an absolute path does not crash', async () => {
    const window = await openWindow();

    const result = await window.evaluate((dir) => {
      const project = window.InkProject.currentProject;
      project.mainInk.projectDir = dir;
      try {
        const f = project.addNewInclude(require('path').join(dir, 'nested.ink'), false);
        return { ok: !!f, relPath: f ? f.relPath : null };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    }, makeTempDir('inky-t2-'));

    expect(result.error, 'absolute-path include threw').toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.relPath).toBe('nested.ink');

    // With an unsaved main ink (no project directory to relativise against)
    // it must fail gracefully — null + a message — instead of throwing.
    const unsaved = await window.evaluate(() => {
      const project = window.InkProject.currentProject;
      project.mainInk.projectDir = null;
      let alerted = null;
      window.alert = (msg) => { alerted = msg; };
      try {
        const f = project.addNewInclude('/tmp/inky-unsaved-include.ink', false);
        return { threw: false, ret: f, alerted };
      } catch (e) {
        return { threw: true, error: String(e), alerted };
      }
    });
    expect(unsaved.error, 'absolute-path include on unsaved project threw').toBeUndefined();
    expect(unsaved.ret).toBeNull();
    expect(unsaved.alerted, 'graceful failure should explain what went wrong').toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// T3: tryLoadFromDisk() when the target is a directory
// Bug: inkFile.js:256 does `err.message` when err is null (stat succeeded but
// the path is a directory) => TypeError, and the load callback never fires.
// ---------------------------------------------------------------------------
test.describe('T3: INCLUDE pointing at a directory', () => {
  test('reports an error instead of throwing', async () => {
    const window = await openWindow();

    const result = await window.evaluate(async (dir) => {
      require('fs').mkdirSync(require('path').join(dir, 'adir'));
      const project = window.InkProject.currentProject;
      project.mainInk.projectDir = dir;

      let captured = null;
      const onUncaught = (err) => { captured = String(err && err.message || err); };
      process.on('uncaughtException', onUncaught);

      let loadError = null;
      project.createInkFile('adir', true, (err) => { loadError = err || 'called-without-error'; });

      await new Promise((r) => setTimeout(r, 800));
      process.removeListener('uncaughtException', onUncaught);
      return { captured, loadError };
    }, makeTempDir('inky-t3-'));

    expect(result.captured, 'uncaught exception while loading a directory').toBeNull();
    expect(result.loadError, 'load callback never fired for a directory INCLUDE').toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// T4: InkFile.save() failing with no callback
// Bug: inkFile.js:209/212 call afterSaveCallback(false/true) unguarded (the
// success path at :201 guards it) => TypeError inside the fs callback whenever
// a programmatic save without callback fails.
// ---------------------------------------------------------------------------
test.describe('T4: save failure without callback', () => {
  test('write failure with no callback must not throw', async () => {
    const window = await openWindow();

    const result = await window.evaluate(async (dir) => {
      const fs = require('fs');
      const p = require('path');
      const project = window.InkProject.currentProject;
      project.mainInk.projectDir = dir;

      const inkFile = project.createInkFile('wfile.ink', true);
      // Make the target path unwritable as a file: replace it with a directory
      // so fs.writeFile fails with EISDIR.
      const abs = p.join(dir, 'wfile.ink');
      try { fs.unlinkSync(abs); } catch (e) {}
      fs.mkdirSync(abs);

      let captured = null;
      const onUncaught = (err) => { captured = String(err && err.message || err); };
      process.on('uncaughtException', onUncaught);

      inkFile.save(); // no callback, as several programmatic paths do

      await new Promise((r) => setTimeout(r, 800));
      process.removeListener('uncaughtException', onUncaught);
      return { captured };
    }, makeTempDir('inky-t4-'));

    expect(result.captured, 'uncaught exception in save failure path').toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T5: project.save() callback when the main-ink save fails
// Bug: inkProject.js:345-393 only invokes afterSaveCallback from
// singleFileSaveComplete when filesRemaining hits 0. If the main ink fails
// while includes are pending, the count never reaches 0 => the save-and-close
// flow waits forever.
// ---------------------------------------------------------------------------
test.describe('T5: save callback on main-ink failure', () => {
  test('afterSaveCallback fires when the main ink save fails', async () => {
    const window = await openWindow();

    const result = await window.evaluate(async () => {
      const project = window.InkProject.currentProject;
      project.addNewInclude('chapter_inc.ink', false);

      const origSave = project.mainInk.save;
      project.mainInk.save = (cb) => setTimeout(() => cb(false), 10);

      const called = await new Promise((resolve) => {
        let settled = false;
        project.save((success) => { settled = true; resolve(success); });
        setTimeout(() => { if (!settled) resolve(null); }, 900);
      });

      project.mainInk.save = origSave;
      project.saveActive = false;
      return { called };
    });

    expect(result.called, 'afterSaveCallback was never invoked (save-and-close would hang)')
      .toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T6: rename/delete menu commands registered twice
// Bug: 'project-rename-file' and 'project-delete-file' each have TWO
// ipcRenderer.on handlers (navView.js:121,131 and inkProject.js:1026,1035),
// so a single menu command runs both code paths.
//
// Observable effect of the duplicate rename: startRenameFile runs twice, the
// second input steals focus from the first, and the first input's blur-commit
// re-shows the filename label — so the old name stays visible *next to* the
// input the user is typing in. (The second input itself survives because the
// first commit is a no-op when the name is unchanged.)
//
// For delete the duplicate registration is self-suppressing: the first
// handler switches activeInkFile back to mainInk, and the second handler's
// `activeFile != mainInk` guard then skips — so only rename is observable.
// ---------------------------------------------------------------------------
async function setupTwoFileProject(window) {
  await window.locator('.nav-toggle').click();
  await window.waitForTimeout(400);
  await window.locator('.add-include-button').click();
  await window.locator('.new-include-form input[type="text"]').fill('chapter1.ink');
  await window.locator('#add-include').click();
  await window.waitForTimeout(800);

  // Select the include (makes it both the active file and the nav selection).
  await window.locator('#file-nav-wrapper .nav-group-item', { hasText: 'chapter1.ink' }).click();
  await window.waitForTimeout(300);
  await window.evaluate(() => {
    // Belt and braces: navView resolves the selection via .active
    document.querySelectorAll('#file-nav-wrapper .nav-group-item').forEach((el) => {
      if (el.textContent.includes('chapter1.ink')) el.classList.add('active');
    });
  });

  const activeIsInclude = await window.evaluate(() => {
    const p = window.InkProject.currentProject;
    return p.activeInkFile && p.activeInkFile.relPath === 'chapter1.ink';
  });
  expect(activeIsInclude, 'precondition: include file is active').toBe(true);
}

test.describe('T6: rename/delete menu commands', () => {
  test('rename command keeps the filename label hidden while renaming', async () => {
    const window = await openWindow();
    await setupTwoFileProject(window);

    await sendToRenderer('project-rename-file');
    await window.waitForTimeout(500);

    const renameInputs = await window.locator('.rename-input').count();
    expect(renameInputs, 'one rename command must start exactly one rename').toBe(1);

    // With a single startRenameFile the filename stays hidden until commit.
    // The duplicate handler's blur-commit re-shows it while the input is open.
    const filenameVisible = await window
      .locator('#file-nav-wrapper .nav-group-item.active .filename')
      .isVisible();
    expect(filenameVisible,
      'filename label is visible next to the open rename input (duplicate handler ran)')
      .toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T7: click-outside never closes the add-include form
// Bug: navView.js:270 `$target.closest(".split") == 0` compares a jQuery
// object to 0 (always false) instead of `.length === 0`.
// ---------------------------------------------------------------------------
test.describe('T7: click outside include form', () => {
  test('clicking outside closes the add-include form', async () => {
    const window = await openWindow();

    await window.locator('.nav-toggle').click();
    await window.waitForTimeout(400);
    await window.locator('.add-include-button').click();

    const footer = window.locator('.sidebar .footer');
    await expect(footer).toHaveClass(/showingForm/);

    // A plain bubbled click whose target is neither in the footer nor in a
    // .split pane (i.e. exactly the case the handler intends to catch).
    await window.evaluate(() => {
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await window.waitForTimeout(300);

    await expect(footer, 'form should close when clicking outside it')
      .not.toHaveClass(/showingForm/);
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
    const window = await openWindow();

    // Enough matches that the chunked build (10 per 35ms tick) can't finish
    // before we clear the query.
    const lines = [];
    for (let i = 0; i < 300; i++) lines.push(`phantom clue number ${i}`);
    await setEditorContent(window, lines.join('\n'));

    await sendToRenderer('goto-anything');
    await window.waitForTimeout(300);

    await window.locator('#goto-anything input').fill('phantom');
    await window.waitForTimeout(250); // build interval now running

    await window.locator('#goto-anything input').fill('');
    await window.waitForTimeout(500); // stale interval keeps appending

    const count = await window.locator('#goto-anything .results li').count();
    expect(count, 'stale build interval rendered phantom results into an empty list').toBe(0);
  });
});

// ---------------------------------------------------------------------------
// T9: changing the theme triggers a full recompile + replay
// Bug: controller.js:557 updateTheme() calls LiveCompiler.setEdited(), which
// makes the compile loop restart and replay the story ~500ms later.
// ---------------------------------------------------------------------------
test.describe('T9: theme change', () => {
  test('changing the theme does not recompile the story', async () => {
    const window = await openWindow();

    await window.evaluate(() => {
      const { LiveCompiler } = require(process.cwd() + '/renderer/liveCompiler.js');
      window.__resetCount = 0;
      LiveCompiler.on('resetting', () => { window.__resetCount++; });
    });

    // Make an edit so the compile loop definitely runs at least once and the
    // listener is proven to work.
    await setEditorContent(window, 'Hello world. This is a regression test.');
    await window.waitForTimeout(3000);

    const baseline = await window.evaluate(() => window.__resetCount);
    expect(baseline, 'sanity: app compiled after an edit').toBeGreaterThan(0);

    await window.evaluate(() => { window.__resetCount = 0; });
    await sendToRenderer('change-theme', 'dark');
    await window.waitForTimeout(1800);

    const after = await window.evaluate(() => window.__resetCount);
    expect(after, 'theme change must not trigger a recompile/replay').toBe(0);
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
    const window = await openWindow();

    await setEditorContent(window, 'VAR alpha_num = 1\nVAR beta_num = 2\n');
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
// T11: switchToFile() claims any file for any window with an open project
// Bug: projectWindow.js:199-203 returns true whenever mainInkAbsPath is set,
// so main.js:91-98 never opens a new window for files that belong elsewhere.
// ---------------------------------------------------------------------------
test.describe('T11: switchToFile routing', () => {
  test('switchToFile only claims files belonging to the project', async () => {
    const result = await electronApp.evaluate(() => {
      const pw = process.mainModule.require(
        process.cwd() + '/main-process/projectWindow.js');
      const win = pw.ProjectWindow.all()[0];
      const projectMain = '/tmp/inky-regression-main.ink';
      const unrelated = '/tmp/inky-regression-unrelated.ink';

      const hadProject = win.mainInkAbsPath;
      win.mainInkAbsPath = projectMain;
      try {
        return {
          hadProject,
          unrelated: win.switchToFile(unrelated),
          related: win.switchToFile(projectMain),
        };
      } finally {
        win.mainInkAbsPath = hadProject;
      }
    });

    expect(result.unrelated,
      'switchToFile claimed a file that belongs to no open project').toBe(false);
    expect(result.related,
      'switchToFile must still handle its own project main file').toBe(true);
  });
});
