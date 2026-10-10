// Application-level tests: startup/window chrome, single-instance handling,
// file/window routing, and menu-handler robustness. Feature tests moved here
// from app/test/app.test.js when the suite was split into category files; the
// T11/M4/M5 regression tests came from app/test/regression.test.js and
// app/test/robustness.test.js.

const { test, expect } = require('@playwright/test');
const { spawn } = require('child_process');
const path = require('path');
const electronBinary = require('electron');
const { createHarness } = require('./_launch.js');

const h = createHarness(test);

test.describe('application launch tests', () => {
  test('shows an initial window', async () => {
    const window = await h.openWindow();
    expect(window).toBeTruthy();
  });

  test('reads the title', async () => {
    const window = await h.openWindow();
    await window.waitForSelector('h1.title', { state: 'attached' });
    const title = await window.locator('h1.title').textContent();
    expect(title.trim()).toBe('Untitled.ink');
  });

  test('opens the sidebar', async () => {
    const window = await h.openWindow();
    await window.locator('.nav-toggle').click();
    const sidebar = window.locator('.sidebar');
    await expect(sidebar).not.toHaveClass(/hidden/);
  });
});

// ---------------------------------------------------------------------------
// T11: switchToFile() claims any file for any window with an open project
// Bug: projectWindow.js:199-203 returns true whenever mainInkAbsPath is set,
// so main.js:91-98 never opens a new window for files that belong elsewhere.
// ---------------------------------------------------------------------------
test.describe('T11: switchToFile routing', () => {
  test('switchToFile only claims files belonging to the project', async () => {
    const result = await h.electronApp.evaluate(() => {
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

// ---------------------------------------------------------------------------
// M4: menu callbacks with no focused window
// Bug: main.js menu callbacks (toggleTags/nextIssue/gotoAnything/
// addWatchExpression) dereference focusedWindow.webContents with no null
// check — with no focused window (all windows closed/minimized) clicking
// these menu items throws in the main process.
// ---------------------------------------------------------------------------
test.describe('M4: menu commands without a focused window', () => {
  test('story menu handlers are safe when no window is focused', async () => {
    const window = await h.openWindow();

    const result = await h.electronApp.evaluate(({ Menu }) => {
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
// Bug: main.js never calls app.requestSingleInstanceLock(), so launching Inky
// twice runs two full instances that fight over recent-files.json and other
// shared state.
// ---------------------------------------------------------------------------
test.describe('M5: single instance lock', () => {
  test('a second instance quits and leaves the first running', async () => {
    // Launch a second instance directly (not via Playwright) so that an app
    // which quits immediately is observed as a process exit, not as a launch
    // that may or may not hang waiting for a window that never appears.
    const second = spawn(electronBinary, [
      'main-process/main.js', '--test-mode', '--user-data-dir', h.userDataDir,
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
    const alive = await h.electronApp.evaluate(() => 1 + 1);
    expect(alive).toBe(2);
  });
});