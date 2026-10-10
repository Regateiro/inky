// Robustness regression tests for the M-series bugs tracked in app/test/TODO.md.
//
// Each test asserts the CORRECT behaviour. They were written against the
// unfixed code, verified to fail with the bug's exact signature, and pass
// only because the bugs have since been fixed. Keep these green by fixing
// bugs — never by weakening the assertions.

const { _electron: electron } = require('playwright');
const { test, expect } = require('@playwright/test');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
// From plain Node, the electron package resolves to the path of the binary —
// used to launch a second app instance directly (M5).
const electronBinary = require('electron');

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

function makeTempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

// Number of inklecate compiler processes that are direct children of the
// given Electron app process (parallel tests run their own app instances,
// so scoping to our pid keeps this deterministic).
function compilerChildCount(appPid) {
  let out = '';
  try { out = execSync('ps -eo pid=,ppid=,args=').toString(); } catch (e) { return -1; }
  return out.split('\n').filter(l => l.includes('inklecate') && !l.includes('grep')).filter(l => {
    const parts = l.trim().split(/\s+/);
    return parts[1] === String(appPid);
  }).length;
}

const STORY_WITH_CHOICES =
  'Hello World!\n* Choice one\nFirst path.\n-> END\n* Choice two\nSecond path.\n-> END';

// Compile a story that stops at a two-choice prompt and return the id of the
// active play session.
async function startStoryAtChoice(window) {
  await window.evaluate(() => {
    if (!window.__choiceHooked) {
      window.__choiceHooked = true;
      window.__sessionIds = [];
      const ipc = require('electron').ipcRenderer;
      ipc.on('play-generated-choice', (event, choice, sessionId) => {
        window.__sessionIds.push(sessionId);
      });
    }
    window.__sessionIds = [];
  });
  await window.evaluate((text) => {
    ace.edit('editor').setValue(text, -1);
    // Drop anything captured before this edit: the default project may have
    // announced its own choices before we replaced its content.
    window.__sessionIds = [];
  }, STORY_WITH_CHOICES);
  // Wait until the *new* story's session announces its choices. (The DOM may
  // already show choices from the default project's compile, so the DOM alone
  // can't tell us when our story is actually playing.)
  await window.waitForFunction(() => {
    return window.__sessionIds.length > 0 &&
      document.querySelectorAll('#player .innerText.active .choice').length > 0;
  }, { timeout: 20000 });
  return await window.evaluate(() => window.__sessionIds[window.__sessionIds.length - 1]);
}

// ---------------------------------------------------------------------------
// M1: missing compiler binary must not crash the main process
// Bug: inklecate.js spawns the compiler with no 'error' handler. If the
// binary is missing or not executable, the unhandled 'error' event takes
// down the whole main process.
// ---------------------------------------------------------------------------
test.describe('M1: compiler spawn errors', () => {
  test('missing compiler binary reports an error instead of crashing', async () => {
    // Launch a dedicated instance whose compiler path points nowhere.
    await Promise.race([
      electronApp.close(),
      new Promise((r) => setTimeout(r, 8000)),
    ]).catch(() => {});
    try { electronApp.process().kill('SIGKILL'); } catch (e) {}
    const userDataDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'inky-test-ud-'));
    electronApp = await electron.launch({
      args: ['main-process/main.js', '--test-mode', '--user-data-dir', userDataDir2],
      cwd: __dirname + '/..',
      headless: true,
      env: { ...process.env, NODE_ENV: 'test', INKY_INKLECATE_PATH: '/nonexistent/inky-compiler-binary' },
    });
    tempDirs.push(userDataDir2);
    const window = await openWindow();

    const result = await window.evaluate(async () => {
      return await new Promise((resolve) => {
        const ipc = require('electron').ipcRenderer;
        const received = [];
        ipc.on('play-story-unexpected-error', (event, msg) => received.push(String(msg)));
        ipc.on('play-exit-due-to-error', (event, code) => received.push('exit:' + code));
        ipc.send('compile', {
          sessionId: 'm1-test-session',
          namespace: 'm1-test-ns',
          updatedFiles: { 'main.ink': 'Hello from m1\n' },
          mainName: 'main.ink',
          play: true,
        });
        const done = () => resolve({ received });
        setTimeout(done, 6000);
        const check = setInterval(() => {
          if (received.length > 0) { clearInterval(check); done(); }
        }, 50);
      });
    });

    expect(result.received.length, 'renderer should receive an error for the failed spawn').toBeGreaterThan(0);
    expect(result.received[0].length, 'error message should be non-empty').toBeGreaterThan(0);

    // The main process must still be alive and responsive.
    const alive = await electronApp.evaluate(() => 1 + 1);
    expect(alive).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// M2: sends to destroyed windows
// Bug: inklecate.js stdout/stderr/timeout/end-of-story paths call
// requester.send() with no isDestroyed() guard. If the requesting window is
// closed mid-compile, the next send throws inside an event handler and
// crashes the main process.
// ---------------------------------------------------------------------------
test.describe('M2: compiler sends to destroyed windows', () => {
  test('window closing mid-compile does not throw in the main process', async () => {
    const window = await openWindow();

    // Observe uncaught exceptions in the main process directly. Electron
    // responds to an exception in an event handler with an error dialog and
    // keeps running, so "is the main process alive?" can't detect them.
    await electronApp.evaluate(() => {
      globalThis.__mainErrors = [];
      process.on('uncaughtException', (e) => {
        globalThis.__mainErrors.push(String((e && e.message) || e));
      });
    });

    // Create a throwaway window, start a compile-only session (the compiler
    // process exits when done, triggering the end-of-story reply) whose
    // requester is that window's webContents, then destroy the window before
    // inklecate has produced any output.
    await electronApp.evaluate(({ BrowserWindow, ipcMain }) => {
      return new Promise((resolve) => {
        const win = new BrowserWindow({ show: false });
        win.webContents.on('did-finish-load', () => {
          const wc = win.webContents;
          ipcMain.emit('compile', { sender: wc }, {
            sessionId: 'm2-test-session',
            namespace: 'm2-test-ns',
            updatedFiles: { 'main.ink': 'Hello from m2\n' },
            mainName: 'main.ink',
          });
          // Destroy before the child process has produced any output.
          setImmediate(() => { win.destroy(); resolve(wc.isDestroyed()); });
        });
        win.loadURL('data:text/html,<html><body>throwaway</body></html>');
      });
    });

    // Give inklecate time to finish compiling and reply to the destroyed window.
    await new Promise((r) => setTimeout(r, 6000));

    const { errors } = await electronApp.evaluate(() => ({
      errors: globalThis.__mainErrors,
    }));
    expect(errors, 'main process must not throw when replying to a destroyed window').toEqual([]);

    // Main process must still be alive and responsive.
    const alive = await electronApp.evaluate(() => 1 + 1);
    expect(alive, 'main process must survive sends to a destroyed window').toBe(2);
  });
});

// ---------------------------------------------------------------------------
// M3: compiler session ownership + lifecycle
// Bug: inklecate.js keys sessions only by renderer-supplied sessionId, so
// any window can write stdin to another window's session. Sessions are also
// only killed via the polite finalClose flow — a destroyed window leaks its
// compiler process.
// ---------------------------------------------------------------------------
test.describe('M3: compiler session ownership and lifecycle', () => {
  test('a foreign window cannot inject input into another session', async () => {
    const window = await openWindow();
    const sessionId = await startStoryAtChoice(window);
    expect(sessionId, 'story should have an active play session').toBeTruthy();

    const ids = await electronApp.evaluate(() => {
      const pw = process.mainModule.require(process.cwd() + '/main-process/projectWindow.js');
      const other = pw.ProjectWindow.createEmpty();
      const mine = pw.ProjectWindow.all()[0];
      return {
        mine: mine.browserWindow.webContents.id,
        other: other.browserWindow.webContents.id,
      };
    });

    const sendChoice = (senderKey) => electronApp.evaluate(({ BrowserWindow, ipcMain }, payload) => {
      const sender = BrowserWindow.getAllWindows()
        .map(w => w.webContents)
        .find(wc => wc.id === payload.senderId);
      ipcMain.emit('play-continue-with-choice-number', { sender }, 1, payload.sessionId);
    }, { senderId: ids[senderKey], sessionId });

    const getStoryText = () => window.evaluate(() => {
      return [...document.querySelectorAll('#player .innerText.active .storyText')]
        .map(e => e.textContent).join(' ');
    });

    // Another window claims the session and sends a choice - must be rejected.
    await sendChoice('other');
    await new Promise((r) => setTimeout(r, 2000));

    // (Choices stay in the DOM even after the story moves on, so the story
    // text is the reliable signal for whether the input was accepted.)
    let storyText = await getStoryText();
    expect(storyText, 'foreign input must not advance the story').not.toContain('First path.');

    // ...but the owning window still can.
    await sendChoice('mine');
    await new Promise((r) => setTimeout(r, 2000));

    storyText = await getStoryText();
    expect(storyText, 'owning window input should still work').toContain('First path.');
  });

  test('compiler processes do not outlive a destroyed window', async () => {
    const window = await openWindow();
    await startStoryAtChoice(window);

    const appPid = electronApp.process().pid;
    expect(compilerChildCount(appPid), 'a compiler process should be running').toBeGreaterThan(0);

    // Keep a plain window open so that destroying the project window doesn't
    // take the whole app down with it (which would hide the leak behind an
    // app quit that kills all sessions anyway).
    await electronApp.evaluate(({ BrowserWindow }) => new Promise((resolve) => {
      const keeper = new BrowserWindow({ show: false });
      keeper.webContents.on('did-finish-load', () => resolve('ok'));
      keeper.loadURL('data:text/html,<html><body>keeper</body></html>');
    }));

    // Destroy the window directly, bypassing the polite close/finalClose flow.
    await electronApp.evaluate(() => {
      const pw = process.mainModule.require(process.cwd() + '/main-process/projectWindow.js');
      pw.ProjectWindow.all()[0].browserWindow.destroy();
    });

    await new Promise((r) => setTimeout(r, 2500));

    expect(
      compilerChildCount(appPid),
      'compiler session must be cleaned up when its window closes'
    ).toBe(0);

    // Main process must have survived the window's death.
    const alive = await electronApp.evaluate(() => 1 + 1);
    expect(alive).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// M4: menu callbacks with no focused window
// Bug: main.js menu callbacks (toggleTags/nextIssue/gotoAnything/
// addWatchExpression) dereference focusedWindow.webContents with no null
// check — with no focused window (all windows closed/minimized) clicking
// these menu items throws in the main process.
// ---------------------------------------------------------------------------
test.describe('M4: menu commands without a focused window', () => {
  test('story menu handlers are safe when no window is focused', async () => {
    const window = await openWindow();

    const result = await electronApp.evaluate(({ Menu }) => {
      const wanted = ['anything', 'next issue', 'watch expression', 'tags visible'];
      const found = [];
      const findings = [];

      function collect(items) {
        for (const it of items) {
          const label = (it.label || '').replace(/&/g, '').toLowerCase();
          if (it.click && wanted.some(w => label.includes(w))) found.push({ label, item: it });
          if (it.submenu) collect(it.submenu.items);
        }
      }

      const menu = Menu.getApplicationMenu();
      if (menu) collect(menu.items);

      for (const entry of found) {
        try {
          // Invoke exactly as the OS would when nothing is focused.
          entry.item.click(entry.item, null, {});
        } catch (e) {
          findings.push(entry.label + ': ' + e.message);
        }
      }
      return { found: found.map(f => f.label), findings };
    });

    // Sanity: the menu items exist and were exercised.
    expect(result.found.length, 'menu items should be found and invoked').toBeGreaterThanOrEqual(3);
    expect(result.findings, 'menu handlers must not throw without a focused window').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// M5: single instance lock
// Bug: main.js never calls app.requestSingleInstanceLock(), so launching
// Inky twice runs two full instances that fight over recent-files.json and
// other shared state.
// ---------------------------------------------------------------------------
test.describe('M5: single instance lock', () => {
  test('a second instance quits and leaves the first running', async () => {
    // Launch a second instance directly (not via Playwright) so that an app
    // which quits immediately is observed as a process exit, not as a launch
    // that may or may not hang waiting for a window that never appears.
    const second = spawn(electronBinary, [
      'main-process/main.js', '--test-mode', '--user-data-dir', userDataDir,
    ], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, NODE_ENV: 'test' },
      stdio: 'ignore',
    });

    const outcome = await Promise.race([
      new Promise((resolve) => second.on('exit', (code, signal) => {
        resolve({ exited: true, code, signal });
      })),
      new Promise((resolve) => setTimeout(() => resolve({ exited: false }), 12000)),
    ]);

    if (!outcome.exited) {
      second.kill('SIGKILL');
    }

    expect(outcome.exited, 'second instance should quit due to the single-instance lock').toBe(true);

    // First instance must still be alive and responsive.
    const alive = await electronApp.evaluate(() => 1 + 1);
    expect(alive).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// M6: unvalidated renderer input in main process
// Bug: remove-temp-file joins renderer-supplied namespace/relativePath with
// no traversal check, so a renderer (or compromised page) can unlink any
// file the app can write to. showSaveDialog forwards unvalidated options
// straight to the native dialog.
// ---------------------------------------------------------------------------
test.describe('M6: unvalidated renderer input', () => {
  test('remove-temp-file refuses paths outside the temp directory', async () => {
    const window = await openWindow();

    // Decoy file sitting next to (not inside) the compiler temp directory.
    const decoy = path.join(os.tmpdir(), `inky-m6-decoy-${process.pid}.txt`);
    fs.writeFileSync(decoy, 'decoy');
    tempDirs.push(decoy);

    await electronApp.evaluate(({ BrowserWindow, ipcMain }, payload) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      // ".." as namespace escapes the temp dir and reaches the decoy.
      ipcMain.emit('remove-temp-file', { sender: wc }, payload.namespace, payload.relPath);
    }, { namespace: '..', relPath: path.basename(decoy) });

    expect(fs.existsSync(decoy), 'file outside the temp dir must not be deleted').toBe(true);
  });

  test('save dialog options are sanitized before reaching the native dialog', async () => {
    const window = await openWindow();

    const result = await electronApp.evaluate(() => {
      const dialogOptions = process.mainModule.require(
        process.cwd() + '/main-process/dialogOptions.js');
      const sanitize = dialogOptions.sanitizeSaveDialogOptions;

      const dirty = sanitize({
        filters: [{ name: 'Ink', extensions: ['ink'] }],
        defaultPath: '/tmp/story.ink',
        window: { destroy() {} },
        path: '/etc/passwd',
        callback: () => {},
        webContents: {},
      });
      const garbage = sanitize({ filters: 'evil', title: 42, properties: 'nope' });
      const nothing = sanitize(undefined);

      return {
        dirtyKeys: Object.keys(dirty).sort(),
        dirtyFilterOk: Array.isArray(dirty.filters) && dirty.filters[0].extensions[0] === 'ink',
        garbageKeys: Object.keys(garbage).sort(),
        nothingKeys: Object.keys(nothing),
      };
    });

    // Only whitelisted keys survive.
    expect(result.dirtyKeys).toEqual(['defaultPath', 'filters']);
    expect(result.dirtyFilterOk, 'legitimate filters should pass through').toBe(true);
    // Malformed values are dropped, not forwarded.
    expect(result.garbageKeys).toEqual([]);
    expect(result.nothingKeys).toEqual([]);
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
    const window = await openWindow();
    await setEditorContent(window, 'VAR myVar = 5\nHello World!');
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

// ---------------------------------------------------------------------------
// M8: updateIssueSummary mutates the caller's array
// Bug: toolbarView.js sorts the issues array it was handed in place, silently
// reordering the caller's data (LiveCompiler's issues list).
// ---------------------------------------------------------------------------
test.describe('M8: issue summary sorting', () => {
  test('updateIssueSummary does not mutate the caller\'s array', async () => {
    const window = await openWindow();

    const result = await window.evaluate(() => {
      const { ToolbarView } = require('./toolbarView.js');
      const issues = [
        { type: 'TODO', filename: '', lineNumber: 5, message: 'todo one' },
        { type: 'ERROR', filename: '', lineNumber: 2, message: 'error one' },
        { type: 'WARNING', filename: '', lineNumber: 9, message: 'warning one' },
      ];
      const orderBefore = issues.map(i => i.type);
      ToolbarView.updateIssueSummary(issues);
      const orderAfter = issues.map(i => i.type);
      const rows = [...document.querySelectorAll('#toolbar .issue-popup .table .row')]
        .map(r => r.className);
      return { orderBefore, orderAfter, rows };
    });

    expect(result.orderAfter, 'caller array must keep its original order').toEqual(result.orderBefore);
    // The rendered summary must still be priority-sorted (ERROR first).
    expect(result.rows.length).toBe(3);
    expect(result.rows[0], 'rendered issues should still be sorted').toContain('error');
  });
});

// ---------------------------------------------------------------------------
// M9: external change/deletion of a dirty file is silently ignored
// Bug: inkProject.js file watchers skip clean files (reload them) but do
// nothing at all when a dirty file is changed or deleted on disk — the
// user's local edits are silently at risk.
// ---------------------------------------------------------------------------
test.describe('M9: external changes to dirty files', () => {
  test('external change and deletion of a dirty file notify the user', async () => {
    const dir = makeTempDir('inky-m9-');
    const mainPath = path.join(dir, 'story.ink');
    fs.writeFileSync(mainPath, 'Hello.\n');

    const window = await openWindow();

    // Load a real on-disk project so the file watcher is watching a real dir.
    await window.evaluate((p) => {
      window.__alerts = [];
      window.alert = (m) => { window.__alerts.push(String(m)); };
      const { InkProject } = require('./inkProject.js');
      InkProject.currentProject = new InkProject(p);
    }, mainPath);

    await window.waitForFunction(() => {
      const p = window.InkProject && window.InkProject.currentProject;
      return p && p.ready === true;
    }, { timeout: 15000 });

    // Make the file dirty via the editor.
    await setEditorContent(window, 'Hello.\nLocal unsaved edit.\n');
    const dirty = await window.evaluate(() =>
      window.InkProject.currentProject.mainInk.hasUnsavedChanges);
    expect(dirty, 'editor change should mark the file dirty').toBe(true);

    // Externally modify the file on disk.
    fs.writeFileSync(mainPath, 'Hello.\nChanged externally.\n');
    await new Promise((r) => setTimeout(r, 2000));
    let alerts = await window.evaluate(() => window.__alerts);
    expect(alerts.length, 'external change to a dirty file must notify the user').toBeGreaterThan(0);
    expect(alerts.join('\n')).toContain('story.ink');

    // Externally delete it too.
    await window.evaluate(() => { window.__alerts = []; });
    fs.unlinkSync(mainPath);
    await new Promise((r) => setTimeout(r, 2000));
    alerts = await window.evaluate(() => window.__alerts);
    expect(alerts.length, 'external deletion of a dirty file must notify the user').toBeGreaterThan(0);
    expect(alerts.join('\n')).toContain('story.ink');
  });
});

// ---------------------------------------------------------------------------
// M10: find-in-project has no result cap or debounce
// Bug: findInProject.js renders one DOM row per match with no limit — a
// broad search over a large project freezes the renderer.
// ---------------------------------------------------------------------------
test.describe('M10: find-in-project result cap', () => {
  test('broad searches render a bounded number of results', async () => {
    const dir = makeTempDir('inky-m10-');
    const mainPath = path.join(dir, 'story.ink');
    let content = '';
    for (let i = 0; i < 400; i++) content += `line ${i} needle here\n`;
    fs.writeFileSync(mainPath, content);

    const window = await openWindow();

    await window.evaluate((p) => {
      const { InkProject } = require('./inkProject.js');
      InkProject.currentProject = new InkProject(p);
    }, mainPath);

    await electronApp.evaluate(({ BrowserWindow }) => {
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
