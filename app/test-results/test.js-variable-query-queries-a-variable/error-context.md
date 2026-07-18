# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: test.js >> variable query >> queries a variable
- Location: test/test.js:741:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator:  locator('.variableQueryResult')
Expected: visible
Received: hidden
Timeout:  5000ms

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('.variableQueryResult')
    14 × locator resolved to <div class="variableQueryResult hidden"></div>
       - unexpected value "hidden"

```

```yaml
- text:    
- paragraph: No issues.
- textbox "Jump to path..."
- text: Go   
- textbox: "\x01\x01"
- text: 1 2 VAR myVar = 5 Hello World!
- table:
  - rowgroup
- textbox "Query variable...": myVar
- text: Query List All
- paragraph: Hello World!
- paragraph: End of story
- paragraph: Once upon a time...
- paragraph:
  - link "There were two choices.":
    - /url: "#"
- paragraph:
  - link "There were four lines of content.":
    - /url: "#"
- textbox "File name, stitch, knot, line number, or text"
- list
```

# Test source

```ts
  661 |     await window.waitForSelector('#editor', { state: 'attached' });
  662 |     await window.waitForTimeout(1000);
  663 | 
  664 |     await setEditorContent(window, '-> broken_divert\nSome text here');
  665 |     await waitForCompilation(window);
  666 | 
  667 |     await window.locator('.issuesSummary').hover();
  668 |     await window.waitForTimeout(500);
  669 | 
  670 |     const issueRow = window.locator('.issue-popup .row').first();
  671 |     if (await issueRow.isVisible()) {
  672 |       await issueRow.click();
  673 |       await window.waitForTimeout(500);
  674 |     }
  675 |   });
  676 | });
  677 | 
  678 | test.describe('keyboard shortcuts', () => {
  679 |   test('shows keyboard shortcuts dialog', async () => {
  680 |     const window = await electronApp.firstWindow();
  681 |     await window.waitForLoadState('domcontentloaded');
  682 |     await window.waitForSelector('#editor', { state: 'attached' });
  683 |     await window.waitForTimeout(1000);
  684 | 
  685 |     window.on('dialog', async dialog => {
  686 |       expect(dialog.message()).toContain('Useful Keyboard Shortcuts');
  687 |       await dialog.accept();
  688 |     });
  689 | 
  690 |     await electronApp.evaluate(({ BrowserWindow }) => {
  691 |       const win = BrowserWindow.getAllWindows()[0];
  692 |       win.webContents.send('keyboard-shortcuts');
  693 |     });
  694 |     await window.waitForTimeout(2000);
  695 |   });
  696 | });
  697 | 
  698 | test.describe('stats', () => {
  699 |   test('shows word count', async () => {
  700 |     const window = await electronApp.firstWindow();
  701 |     await window.waitForLoadState('domcontentloaded');
  702 |     await window.waitForSelector('#editor', { state: 'attached' });
  703 |     await window.waitForTimeout(1000);
  704 | 
  705 |     await setEditorContent(window, 'This is a test story with some words.\n* And a choice\nMore words here.');
  706 |     await waitForCompilation(window);
  707 | 
  708 |     window.on('dialog', async dialog => {
  709 |       expect(dialog.message()).toContain('Project statistics');
  710 |       await dialog.accept();
  711 |     });
  712 | 
  713 |     await electronApp.evaluate(({ BrowserWindow }) => {
  714 |       const win = BrowserWindow.getAllWindows()[0];
  715 |       win.webContents.send('project-stats');
  716 |     });
  717 |     await window.waitForTimeout(2000);
  718 |   });
  719 | });
  720 | 
  721 | test.describe('variable query', () => {
  722 |   test('opens variable query panel', async () => {
  723 |     const window = await electronApp.firstWindow();
  724 |     await window.waitForLoadState('domcontentloaded');
  725 |     await window.waitForSelector('#editor', { state: 'attached' });
  726 |     await window.waitForTimeout(1000);
  727 | 
  728 |     await setEditorContent(window, 'VAR myVar = 5\nHello World!');
  729 |     await waitForCompilation(window);
  730 | 
  731 |     await electronApp.evaluate(({ BrowserWindow }) => {
  732 |       const win = BrowserWindow.getAllWindows()[0];
  733 |       win.webContents.send('toggle-variable-query', true);
  734 |     });
  735 |     await window.waitForTimeout(500);
  736 | 
  737 |     const variableQueryPanel = window.locator('.variableQueryPanel');
  738 |     await expect(variableQueryPanel).toBeVisible();
  739 |   });
  740 | 
  741 |   test('queries a variable', async () => {
  742 |     const window = await electronApp.firstWindow();
  743 |     await window.waitForLoadState('domcontentloaded');
  744 |     await window.waitForSelector('#editor', { state: 'attached' });
  745 |     await window.waitForTimeout(1000);
  746 | 
  747 |     await setEditorContent(window, 'VAR myVar = 5\nHello World!');
  748 |     await waitForCompilation(window);
  749 | 
  750 |     await electronApp.evaluate(({ BrowserWindow }) => {
  751 |       const win = BrowserWindow.getAllWindows()[0];
  752 |       win.webContents.send('toggle-variable-query', true);
  753 |     });
  754 |     await window.waitForTimeout(500);
  755 | 
  756 |     await window.locator('.variableQueryInput').fill('myVar');
  757 |     await window.locator('.variableQueryBtn').click();
  758 |     await window.waitForTimeout(1000);
  759 | 
  760 |     const variableQueryResult = window.locator('.variableQueryResult');
> 761 |     await expect(variableQueryResult).toBeVisible();
      |                                       ^ Error: expect(locator).toBeVisible() failed
  762 |   });
  763 | 
  764 |   test('lists all variables', async () => {
  765 |     const window = await electronApp.firstWindow();
  766 |     await window.waitForLoadState('domcontentloaded');
  767 |     await window.waitForSelector('#editor', { state: 'attached' });
  768 |     await window.waitForTimeout(1000);
  769 | 
  770 |     await setEditorContent(window, 'VAR myVar = 5\nVAR anotherVar = "test"\nHello World!');
  771 |     await waitForCompilation(window);
  772 | 
  773 |     await electronApp.evaluate(({ BrowserWindow }) => {
  774 |       const win = BrowserWindow.getAllWindows()[0];
  775 |       win.webContents.send('toggle-variable-query', true);
  776 |     });
  777 |     await window.waitForTimeout(500);
  778 | 
  779 |     await window.locator('.variableListBtn').click();
  780 |     await window.waitForTimeout(5000);
  781 | 
  782 |     const variableQueryResult = window.locator('.variableQueryResult');
  783 |     await expect(variableQueryResult).toBeVisible();
  784 |     
  785 |     const resultText = await variableQueryResult.textContent();
  786 |     expect(resultText).toContain('myVar');
  787 |   });
  788 | 
  789 |   test('closes variable query panel', async () => {
  790 |     const window = await electronApp.firstWindow();
  791 |     await window.waitForLoadState('domcontentloaded');
  792 |     await window.waitForSelector('#editor', { state: 'attached' });
  793 |     await window.waitForTimeout(1000);
  794 | 
  795 |     await electronApp.evaluate(({ BrowserWindow }) => {
  796 |       const win = BrowserWindow.getAllWindows()[0];
  797 |       win.webContents.send('toggle-variable-query', true);
  798 |     });
  799 |     await window.waitForTimeout(500);
  800 | 
  801 |     const variableQueryPanel = window.locator('.variableQueryPanel');
  802 |     await expect(variableQueryPanel).toBeVisible();
  803 | 
  804 |     await electronApp.evaluate(({ BrowserWindow }) => {
  805 |       const win = BrowserWindow.getAllWindows()[0];
  806 |       win.webContents.send('toggle-variable-query', false);
  807 |     });
  808 |     await window.waitForTimeout(500);
  809 | 
  810 |     await expect(variableQueryPanel).toBeHidden();
  811 |   });
  812 | });
  813 | 
  814 | test.describe('expression watch', () => {
  815 |   test('adds expression watch', async () => {
  816 |     const window = await electronApp.firstWindow();
  817 |     await window.waitForLoadState('domcontentloaded');
  818 |     await window.waitForSelector('#editor', { state: 'attached' });
  819 |     await window.waitForTimeout(1000);
  820 | 
  821 |     await setEditorContent(window, 'VAR myVar = 5\nHello World!');
  822 |     await waitForCompilation(window);
  823 | 
  824 |     await electronApp.evaluate(({ BrowserWindow }) => {
  825 |       const win = BrowserWindow.getAllWindows()[0];
  826 |       win.webContents.send('add-watch-expression');
  827 |     });
  828 |     await window.waitForTimeout(500);
  829 | 
  830 |     const expressionWatch = window.locator('.expressionWatch');
  831 |     await expect(expressionWatch).toBeVisible();
  832 |   });
  833 | });
  834 | 
```