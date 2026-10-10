// Compiler tests: the live compile → play loop and the compiler session
// lifecycle (writing stories, selecting choices, TODO reports, pause/rewind)
// plus the main-process robustness fixes around spawning, sending to dead
// windows, session ownership/cleanup and temp-file handling. Feature tests
// moved here from app/test/app.test.js when the suite was split into category
// files; the M1/M2/M3/M6a regression tests came from app/test/robustness.test.js.
// Relevant sources: renderer/liveCompiler.js, main-process/inklecate.js.

const { test, expect } = require('@playwright/test');
const { execSync } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { createHarness } = require('./_launch.js');

const h = createHarness(test);

// ---------------------------------------------------------------------------
// Robustness helpers (from the old robustness.test.js)
// ---------------------------------------------------------------------------

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

test.describe('compiles hello world game', () => {
  test('writes and reads hello world', async () => {
    const window = await h.openWindow();

    await h.setEditorContent(window, 'Hello World!');
    await h.waitForCompilation(window);

    const playerText = await window.evaluate(() => {
      const activeBuffer = document.querySelector('#player .innerText.active');
      return activeBuffer ? activeBuffer.textContent : '';
    });
    expect(playerText).toContain('Hello World!');
  });

  test('writes and selects a choice', async () => {
    const window = await h.openWindow();

    const input = 'Hello World!\n* Hello back\nNice to hear from you!\n-> END';
    await h.setEditorContent(window, input);
    await h.waitForCompilation(window);

    const choice = window.locator('#player .innerText.active .choice').last();
    await expect(choice).toBeVisible();
    await choice.click();
    await h.waitForCompilation(window);

    const storyTexts = window.locator('#player .innerText.active .storyText');
    const count = await storyTexts.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('suppresses choice text', async () => {
    const window = await h.openWindow();

    const input = 'Hello World!\n* [Hello back]\nNice to hear from you!\n-> END';
    await h.setEditorContent(window, input);
    await h.waitForCompilation(window);

    const choice = window.locator('#player .innerText.active .choice').last();
    await expect(choice).toBeVisible();
    await choice.click();
    await h.waitForCompilation(window);

    const storyTexts = window.locator('#player .innerText.active .storyText');
    const count = await storyTexts.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('shows TODOs', async () => {
    const window = await h.openWindow();

    const input = '-\n* Rock\n* Paper\n* Scissors\nTODO: Make this more interesting';
    await h.setEditorContent(window, input);
    await h.waitForCompilation(window);

    const issuesSummary = window.locator('.issuesSummary');
    await expect(issuesSummary).toBeVisible();
  });
});

test.describe('pause compilation', () => {
  test('toggles pause state', async () => {
    const window = await h.openWindow();

    await window.locator('.pause-toggle').click();
    await window.waitForTimeout(500);

    const pauseBtn = window.locator('.pause-toggle');
    await expect(pauseBtn).toHaveClass(/selected/);
  });
});

test.describe('rewind and step back', () => {
  test('rewinds story', async () => {
    const window = await h.openWindow();

    const input = 'Hello World!\n* Choice 1\nResponse 1\n-> END';
    await h.setEditorContent(window, input);
    await h.waitForCompilation(window);

    const choice = window.locator('#player .innerText.active .choice').last();
    await choice.click();
    await h.waitForCompilation(window);

    await window.locator('.rewind').click();
    await h.waitForCompilation(window);

    const storyTexts = window.locator('#player .innerText.active .storyText');
    const count = await storyTexts.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('steps back one choice', async () => {
    const window = await h.openWindow();

    const input = 'Hello World!\n* Choice 1\nResponse 1\n-> END';
    await h.setEditorContent(window, input);
    await h.waitForCompilation(window);

    const choice = window.locator('#player .innerText.active .choice').last();
    await choice.click();
    await h.waitForCompilation(window);

    await window.locator('.step-back').click();
    await window.waitForTimeout(500);

    const dividers = window.locator('#player .innerText.active .turnDivider');
    const count = await dividers.count();
    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// M1: missing compiler binary must not crash the main process
// Bug: inklecate.js spawns the compiler with no 'error' handler. If the
// binary is missing or not executable, the unhandled 'error' event takes
// down the whole main process.
// ---------------------------------------------------------------------------
test.describe('M1: compiler spawn errors', () => {
  test('missing compiler binary reports an error instead of crashing', async () => {
    // Relaunch with the compiler path pointing nowhere.
    await h.relaunch({ INKY_INKLECATE_PATH: '/nonexistent/inky-compiler-binary' });
    const window = await h.openWindow();

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
    const alive = await h.electronApp.evaluate(() => 1 + 1);
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
    const window = await h.openWindow();

    // Observe uncaught exceptions in the main process directly. Electron
    // responds to an exception in an event handler with an error dialog and
    // keeps running, so "is the main process alive?" can't detect them.
    await h.electronApp.evaluate(() => {
      globalThis.__mainErrors = [];
      process.on('uncaughtException', (e) => {
        globalThis.__mainErrors.push(String((e && e.message) || e));
      });
    });

    // Create a throwaway window, start a compile-only session (the compiler
    // process exits when done, triggering the end-of-story reply) whose
    // requester is that window's webContents, then destroy the window before
    // inklecate has produced any output.
    await h.electronApp.evaluate(({ BrowserWindow, ipcMain }) => {
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

    const { errors } = await h.electronApp.evaluate(() => ({
      errors: globalThis.__mainErrors,
    }));
    expect(errors, 'main process must not throw when replying to a destroyed window').toEqual([]);

    // Main process must still be alive and responsive.
    const alive = await h.electronApp.evaluate(() => 1 + 1);
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
    const window = await h.openWindow();
    const sessionId = await startStoryAtChoice(window);
    expect(sessionId, 'story should have an active play session').toBeTruthy();

    const ids = await h.electronApp.evaluate(() => {
      const pw = process.mainModule.require(process.cwd() + '/main-process/projectWindow.js');
      const other = pw.ProjectWindow.createEmpty();
      const mine = pw.ProjectWindow.all()[0];
      return {
        mine: mine.browserWindow.webContents.id,
        other: other.browserWindow.webContents.id,
      };
    });

    const sendChoice = (senderKey) => h.electronApp.evaluate(({ BrowserWindow, ipcMain }, payload) => {
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
    const window = await h.openWindow();
    await startStoryAtChoice(window);

    const appPid = h.electronApp.process().pid;
    expect(compilerChildCount(appPid), 'a compiler process should be running').toBeGreaterThan(0);

    // Keep a plain window open so that destroying the project window doesn't
    // take the whole app down with it (which would hide the leak behind an
    // app quit that kills all sessions anyway).
    await h.electronApp.evaluate(({ BrowserWindow }) => new Promise((resolve) => {
      const keeper = new BrowserWindow({ show: false });
      keeper.webContents.on('did-finish-load', () => resolve('ok'));
      keeper.loadURL('data:text/html,<html><body>keeper</body></html>');
    }));

    // Destroy the window directly, bypassing the polite close/finalClose flow.
    await h.electronApp.evaluate(() => {
      const pw = process.mainModule.require(process.cwd() + '/main-process/projectWindow.js');
      pw.ProjectWindow.all()[0].browserWindow.destroy();
    });

    await new Promise((r) => setTimeout(r, 2500));

    expect(
      compilerChildCount(appPid),
      'compiler session must be cleaned up when its window closes'
    ).toBe(0);

    // Main process must have survived the window's death.
    const alive = await h.electronApp.evaluate(() => 1 + 1);
    expect(alive).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// M6a: unvalidated renderer input in the main process
// Bug: remove-temp-file joins renderer-supplied namespace/relativePath with
// no traversal check, so a renderer (or compromised page) can unlink any
// file the app can write to.
// ---------------------------------------------------------------------------
test.describe('M6: unvalidated renderer input', () => {
  test('remove-temp-file refuses paths outside the temp directory', async () => {
    const window = await h.openWindow();

    // Decoy file sitting next to (not inside) the compiler temp directory.
    const decoy = h.track(path.join(os.tmpdir(), `inky-m6-decoy-${process.pid}.txt`));
    fs.writeFileSync(decoy, 'decoy');

    await h.electronApp.evaluate(({ BrowserWindow, ipcMain }, payload) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      // ".." as namespace escapes the temp dir and reaches the decoy.
      ipcMain.emit('remove-temp-file', { sender: wc }, payload.namespace, payload.relPath);
    }, { namespace: '..', relPath: path.basename(decoy) });

    expect(fs.existsSync(decoy), 'file outside the temp dir must not be deleted').toBe(true);
  });
});