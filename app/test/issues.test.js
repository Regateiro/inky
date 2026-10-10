// Issues tests: the compile-issues summary — its styling (selectable text),
// navigation from an issue row back to the source, and the toolbar summary's
// sorting behaviour. Feature tests moved here from app/test/app.test.js when
// the suite was split into category files; the M8 regression test came from
// app/test/robustness.test.js. Relevant sources: renderer/toolbarView.js,
// renderer/controller.js.

const { test, expect } = require('@playwright/test');
const { createHarness } = require('./_launch.js');

const h = createHarness(test);

test.describe('issue popup styling', () => {
  test('issue popup text is selectable', async () => {
    const window = await h.openWindow();

    await h.setEditorContent(window, '-> broken_divert\nSome text here');
    await h.waitForCompilation(window);

    await window.locator('.issuesSummary').hover();
    await window.waitForTimeout(500);

    const issuePopup = window.locator('.issue-popup');
    await expect(issuePopup).toBeVisible();

    const popupStyles = await window.evaluate(() => {
      const popup = document.querySelector('.issue-popup');
      if (!popup) return null;
      const issueElement = popup.querySelector('.issue');
      const lineNoElement = popup.querySelector('.line-no');
      return {
        issue: issueElement ? window.getComputedStyle(issueElement).userSelect : null,
        lineNo: lineNoElement ? window.getComputedStyle(lineNoElement).userSelect : null,
      };
    });

    expect(popupStyles).toBeTruthy();
    expect(popupStyles.issue).toBe('text');
    expect(popupStyles.lineNo).toBe('text');
  });
});

test.describe('issues navigation', () => {
  test('clicks on issue to navigate', async () => {
    const window = await h.openWindow();

    await h.setEditorContent(window, '-> broken_divert\nSome text here');
    await h.waitForCompilation(window);

    await window.locator('.issuesSummary').hover();
    await window.waitForTimeout(500);

    const issueRow = window.locator('.issue-popup .row').first();
    if (await issueRow.isVisible()) {
      await issueRow.click();
      await window.waitForTimeout(500);
    }
  });
});

// ---------------------------------------------------------------------------
// M8: updateIssueSummary mutates the caller's array
// Bug: toolbarView.js sorts the issues array it was handed in place, silently
// reordering the caller's data (LiveCompiler's issues list).
// ---------------------------------------------------------------------------
test.describe('M8: issue summary sorting', () => {
  test('updateIssueSummary does not mutate the caller\'s array', async () => {
    const window = await h.openWindow();

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