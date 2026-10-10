// Project tests: managing the project's files — creating includes, saving,
// save-dialog options, rename/delete, and file-watch warnings for externally
// changed/deleted dirty files. Feature tests moved here from
// app/test/app.test.js when the suite was split into category files; the
// T2–T7, M6b and M9 regression tests came from app/test/regression.test.js and
// app/test/robustness.test.js. Relevant sources: renderer/inkProject.js,
// renderer/inkFile.js, renderer/navView.js, main-process/dialogOptions.js.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { createHarness } = require('./_launch.js');

const h = createHarness(test);

// ---------------------------------------------------------------------------
// Regression helper (from the old regression.test.js)
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

test.describe('include file creation', () => {
  test('creates new include file', async () => {
    const window = await h.openWindow();

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
    const window = await h.openWindow();

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

// ---------------------------------------------------------------------------
// T2: addNewInclude() with an absolute path
// Bug: inkProject.js:91 calls `assert(...)` but never requires it, so adding
// an include from an absolute path dies with ReferenceError.
// ---------------------------------------------------------------------------
test.describe('T2: absolute-path include', () => {
  test('addNewInclude with an absolute path does not crash', async () => {
    const window = await h.openWindow();

    const result = await window.evaluate((dir) => {
      const project = window.InkProject.currentProject;
      project.mainInk.projectDir = dir;
      try {
        const f = project.addNewInclude(require('path').join(dir, 'nested.ink'), false);
        return { ok: !!f, relPath: f ? f.relPath : null };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    }, h.makeTempDir('inky-t2-'));

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
    const window = await h.openWindow();

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
    }, h.makeTempDir('inky-t3-'));

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
    const window = await h.openWindow();

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
    }, h.makeTempDir('inky-t4-'));

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
    const window = await h.openWindow();

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
test.describe('T6: rename/delete menu commands', () => {
  test('rename command keeps the filename label hidden while renaming', async () => {
    const window = await h.openWindow();
    await setupTwoFileProject(window);

    await h.sendToRenderer('project-rename-file');
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
    const window = await h.openWindow();

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
// M6b: unvalidated renderer input in the main process
// Bug: showSaveDialog forwards unvalidated options straight to the native
// dialog.
// ---------------------------------------------------------------------------
test.describe('M6: unvalidated renderer input', () => {
  test('save dialog options are sanitized before reaching the native dialog', async () => {
    const window = await h.openWindow();

    const result = await h.electronApp.evaluate(() => {
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
// M9: external change/deletion of a dirty file is silently ignored
// Bug: inkProject.js file watchers skip clean files (reload them) but do
// nothing at all when a dirty file is changed or deleted on disk — the
// user's local edits are silently at risk.
// ---------------------------------------------------------------------------
test.describe('M9: external changes to dirty files', () => {
  test('external change and deletion of a dirty file notify the user', async () => {
    const dir = h.makeTempDir('inky-m9-');
    const mainPath = path.join(dir, 'story.ink');
    fs.writeFileSync(mainPath, 'Hello.\n');

    const window = await h.openWindow();

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
    await h.setEditorContent(window, 'Hello.\nLocal unsaved edit.\n');
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