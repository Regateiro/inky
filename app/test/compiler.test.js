// Compiler tests: the live compile → play loop (writing stories, selecting
// choices, suppress-choice text, TODO reports) plus the player controls that
// drive the compiler session (pause, rewind, step back). Moved here from
// app/test/app.test.js when the suite was split into category files. Relevant
// sources: renderer/liveCompiler.js, main-process/inklecate.js.

const { test, expect } = require('@playwright/test');
const { createHarness } = require('./_launch.js');

const h = createHarness(test);

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