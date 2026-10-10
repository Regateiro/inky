// Player tests: how story content is rendered in the play area (rich text
// tags, tooltips, colours) and the player's behaviour (completion message,
// multiple choices, tags). Moved here from app/test/app.test.js when the
// suite was split into category files. Relevant source: renderer/playerView.js.

const { test, expect } = require('@playwright/test');
const { createHarness } = require('./_launch.js');

const h = createHarness(test);

test.describe('html rendering', () => {
  test('renders bold tags properly', async () => {
    const window = await h.openWindow();

    await h.setEditorContent(window, 'This is <b>bold</b> text');
    await h.waitForCompilation(window);

    const playerHtml = await window.evaluate(() => {
      const activeBuffer = document.querySelector('#player .innerText.active');
      return activeBuffer ? activeBuffer.innerHTML : '';
    });
    expect(playerHtml).toContain('<b>');
    expect(playerHtml).toContain('bold');
  });

  test('renders italic tags properly', async () => {
    const window = await h.openWindow();

    await h.setEditorContent(window, 'This is <i>italic</i> text');
    await h.waitForCompilation(window);

    const playerHtml = await window.evaluate(() => {
      const activeBuffer = document.querySelector('#player .innerText.active');
      return activeBuffer ? activeBuffer.innerHTML : '';
    });
    expect(playerHtml).toContain('<i>');
    expect(playerHtml).toContain('italic');
  });

  test('renders tooltip with empty color keeps original font', async () => {
    const window = await h.openWindow();

    const inkSrc = "She saw the {TOOLTIP(\"figure\", \"info\", \"\")} in the distance.\n" +
      "\n" +
      "=== function TOOLTIP(text, tooltip, color)\n" +
      "\t{color:\n" +
      "\t\t~ return \"<span class='ink-tooltip' title='\" + tooltip + \"'><font color='\" + color + \"'>\" + text + \"</font></span>\"\n" +
      "\t- else:\n" +
      "\t\t~ return \"<span class='ink-tooltip' title='\" + tooltip + \"'>\" + text + \"</span>\"\n" +
      "\t}\n";
    await h.setEditorContent(window, inkSrc);
    await h.waitForCompilation(window);

    const playerHtml = await window.evaluate(() => {
      const activeBuffer = document.querySelector('#player .innerText.active');
      return activeBuffer ? activeBuffer.innerHTML : '';
    });
    expect(playerHtml).toContain("ink-tooltip");
    expect(playerHtml).toContain("title=\"info\"");
    expect(playerHtml).toContain("figure");
    expect(playerHtml).not.toContain("<font");

    const playerText = await window.evaluate(() => {
      const activeBuffer = document.querySelector('#player .innerText.active');
      return activeBuffer ? activeBuffer.textContent : '';
    });
    expect(playerText).toContain("She saw the figure in the distance.");
  });

  test('renders tooltip with color applies font color', async () => {
    const window = await h.openWindow();

    const inkSrc = "The {TOOLTIP(\"blood\", \"Careful where you step\", \"red\")} dripped slowly.\n" +
      "\n" +
      "=== function TOOLTIP(text, tooltip, color)\n" +
      "\t{color:\n" +
      "\t\t~ return \"<span class='ink-tooltip' title='\" + tooltip + \"'><font color='\" + color + \"'>\" + text + \"</font></span>\"\n" +
      "\t- else:\n" +
      "\t\t~ return \"<span class='ink-tooltip' title='\" + tooltip + \"'>\" + text + \"</span>\"\n" +
      "\t}\n";
    await h.setEditorContent(window, inkSrc);
    await h.waitForCompilation(window);

    const playerHtml = await window.evaluate(() => {
      const activeBuffer = document.querySelector('#player .innerText.active');
      return activeBuffer ? activeBuffer.innerHTML : '';
    });
    expect(playerHtml).toContain("ink-tooltip");
    expect(playerHtml).toContain("title=\"Careful where you step\"");
    expect(playerHtml).toContain("<font color=\"red\">");
    expect(playerHtml).toContain("blood");

    const playerText = await window.evaluate(() => {
      const activeBuffer = document.querySelector('#player .innerText.active');
      return activeBuffer ? activeBuffer.textContent : '';
    });
    expect(playerText).toContain("The blood dripped slowly.");
  });

  test('COLOR function wraps text in font color', async () => {
    const window = await h.openWindow();

    const inkSrc = "The {COLOR(\"blood\", \"red\")} dripped slowly.\n" +
      "\n" +
      "=== function COLOR(text, color)\n" +
      "\t~ return \"<font color='\" + color + \"'>\" + text + \"</font>\"\n";
    await h.setEditorContent(window, inkSrc);
    await h.waitForCompilation(window);

    const playerHtml = await window.evaluate(() => {
      const activeBuffer = document.querySelector('#player .innerText.active');
      return activeBuffer ? activeBuffer.innerHTML : '';
    });
    expect(playerHtml).toContain("<font color=\"red\">");
    expect(playerHtml).toContain("blood");

    const playerText = await window.evaluate(() => {
      const activeBuffer = document.querySelector('#player .innerText.active');
      return activeBuffer ? activeBuffer.textContent : '';
    });
    expect(playerText).toContain("The blood dripped slowly.");
  });

});

test.describe('player features', () => {
  test('shows story completion message', async () => {
    const window = await h.openWindow();

    await h.setEditorContent(window, 'Hello World!\n-> END');
    await h.waitForCompilation(window);

    const endMessage = window.locator('#player .innerText.active .end');
    await expect(endMessage).toBeVisible();
  });

  test('shows multiple choices', async () => {
    const window = await h.openWindow();

    const input = 'What do you choose?\n* Option A\n* Option B\n* Option C\n-> END';
    await h.setEditorContent(window, input);
    await h.waitForCompilation(window);

    const choices = window.locator('#player .innerText.active .choice');
    const count = await choices.count();
    expect(count).toBe(3);
  });

  test('shows tags', async () => {
    const window = await h.openWindow();

    await h.setEditorContent(window, 'Hello World! # location: forest');
    await h.waitForCompilation(window);

    const tags = window.locator('#player .innerText.active .tags');
    await expect(tags).toBeVisible();
    const tagText = await tags.textContent();
    expect(tagText).toContain('location: forest');
  });
});