// Issues tests: the compile-issues summary popup — its styling
// (selectable text) and navigation from an issue row back to the source.
// Moved here from app/test/app.test.js when the suite was split into category
// files. Relevant sources: renderer/toolbarView.js, renderer/controller.js.

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