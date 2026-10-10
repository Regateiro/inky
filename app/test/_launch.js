// Shared Electron launch harness for the Inky test suite (see app/test/TODO.md).
//
// Every test file launches a fresh, isolated Electron instance per test:
//   - `--user-data-dir <mkdtemp>` so tests never touch the real profile and
//     the per-user-data-dir single-instance lock can't leak between parallel
//     test files.
//   - `--test-mode` (read in main-process/main.js) so tests can drive IPC.
//
// Teardown races `close()` against a timeout and then SIGKILLs, so a runaway
// Electron process can never poison later runs (see the suite-level TODO in
// app/test/TODO.md).
//
// Playwright only runs `*.test.js` files (`testMatch` in playwright.config.js),
// so this helper is deliberately not named with a `.test.js` suffix.

const { _electron: electron } = require('playwright');
const os = require('os');
const fs = require('fs');
const path = require('path');

const APPDIR = path.resolve(__dirname, '..');

// createHarness(test) registers per-test launch/teardown hooks via the file's
// own `test` object and returns the helpers the tests use.
function createHarness(test) {
  const state = {
    electronApp: null,
    userDataDir: null,
    tempDirs: [],
  };

  test.beforeEach(async () => {
    state.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inky-test-ud-'));
    state.electronApp = await electron.launch({
      args: ['main-process/main.js', '--test-mode', '--user-data-dir', state.userDataDir],
      cwd: APPDIR,
      headless: true,
      env: { ...process.env, NODE_ENV: 'test' },
    });
  });

  test.afterEach(async () => {
    if (state.electronApp) {
      await Promise.race([
        state.electronApp.close(),
        new Promise((r) => setTimeout(r, 8000)),
      ]).catch(() => {});
      try { state.electronApp.process().kill('SIGKILL'); } catch (e) {}
      state.electronApp = null;
    }
    if (state.userDataDir) {
      try { fs.rmSync(state.userDataDir, { recursive: true, force: true }); } catch (e) {}
      state.userDataDir = null;
    }
    while (state.tempDirs.length) {
      const dir = state.tempDirs.pop();
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
    }
  });

  return {
    get electronApp() { return state.electronApp; },
    get userDataDir() { return state.userDataDir; },

    // Open the app's main window and wait for the editor to be ready.
    async openWindow() {
      const window = await state.electronApp.firstWindow();
      await window.waitForLoadState('domcontentloaded');
      await window.waitForSelector('#editor', { state: 'attached' });
      await window.waitForTimeout(1500);
      return window;
    },

    async setEditorContent(window, text) {
      await window.evaluate((text) => {
        ace.edit('editor').setValue(text, -1);
      }, text);
    },

    // Give the live compiler time to compile and replay the current buffer.
    waitForCompilation(window) {
      return window.waitForTimeout(2000);
    },

    // Send an IPC message to the renderer, as the native menus do.
    async sendToRenderer(channel, ...args) {
      await state.electronApp.evaluate(({ BrowserWindow }, payload) => {
        BrowserWindow.getAllWindows()[0].webContents.send(payload.channel, ...payload.args);
      }, { channel, args });
    },

    makeTempDir(prefix) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
      state.tempDirs.push(dir);
      return dir;
    },
  };
}

module.exports = { createHarness };