# TODO

## Implementation Order

Items are organized by phase. Within each phase, items are ordered by priority.

### Phase 1: Bug Fixes
### Phase 2: Refactoring
### Phase 3: New Features

Status key: `NOT STARTED` | `IN PROGRESS` | `DONE` | `BLOCKED`

---

## Phase 1: Bug Fixes

### 1. Ace editor highlights not removed when switching files
- **Status:** DONE
- **Issue:** Markers persist when switching between files. Occurs when fixing an error in another file that resolves it in the original.
- **Root cause:** `editorMarkers` is module-level, not per-session. `clearErrors()` in `showInkFile()` only clears the array, but old session markers may not be tracked.
- **Plan:**
    1. In `editorView.js`, store markers per-session (e.g., `Map<EditSession, markerIds[]>`)
    2. In `showInkFile()`, clear markers from the outgoing session before switching
    3. In `clearErrors()`, clear markers from the current session
- **Files:** `app/renderer/editorView.js` (lines 8, 107-153, 167-171)

### 2. `/tmp` never gets cleared - removed files still compile
- **Status:** DONE
- **Issue:** Deleted files in the project (e.g. via Finder) still compile because temp copies remain.
- **Root cause:** `deleteInkFile()` removes from `this.files` but doesn't clean up inklecate's temp directory.
- **Plan:**
    1. In `inkProject.js` `deleteInkFile()`, also remove the temp copy from the compiler's working directory
    2. In the `unlink` watcher handler, ensure temp cleanup happens even when the file is already removed from `this.files`
- **Files:** `app/renderer/inkProject.js` (lines 269-281, 586-597), `app/renderer/inkFile.js` (line 212-216)

### 3. Replay transition issue
- **Status:** DONE
- **Issue:** jQuery fades in the last chunk during replay; view height shrinks temporarily.
- **Root cause:** `playerView.js` fade-in animation runs on all chunks including replay.
- **Plan:**
    1. In `playerView.js`, check `isReplaying` flag before applying fade-in animation
    2. Ensure view height never shrinks by using `min-height` on the scroll container during replay
- **Files:** `app/renderer/playerView.js` (lines 24-45, 47-63)

### 4. Cmd-D for "don't save" option
- **Status:** DONE
- **Issue:** No keyboard shortcut to dismiss the save dialog with "don't save".
- **Plan:**
    1. In `inkProject.js` `tryClose()`, handle Cmd-D before the dialog appears, or
    2. Use Electron's `dialog.showMessageBox` with custom button labels and handle keyboard input
- **Files:** `app/renderer/inkProject.js` (lines 544-568)

### 5. Multiple windows flakiness (VERIFY)
- **Status:** DONE - Fixed
- **Issue:** Saving vs compiling can conflict across windows.
- **Finding:** No race conditions confirmed. Menu state pollution between windows and lack of duplicate project prevention.
- **Fix:** 
  - Added duplicate project prevention in `ProjectWindow.open()`
  - Implemented per-window event routing to fully isolate menu state
  - Removed shared `events` object, replaced with per-window handlers
  - Menu updates only occur for the focused window, eliminating flicker

### 6. Story reloading reliability (DONE?)
- **Status:** DONE - Fixed
- **Issue:** Sometimes fails to reload.
- **Fix:** Pass `fromSessionId` to `events.replayComplete()` in error handler.
- **Additional fixes:** Added 30s timeout for inklecate compiler to prevent indefinite hangs. Added error handling for `mkdirp.sync` calls.

### 7. Copies of inklecate left open (DONE?)
- **Status:** DONE - Bug found and fixed
- **Issue:** Zombie compiler processes.
- **Finding:** In `inklecate.js:89-96`, when `compile()` is called, it unconditionally spawns a new inklecate process and overwrites `sessions[sessionId]` without killing the previous process. The old process becomes orphaned.
- **Fix:** Kill any existing session for the same `sessionId` before spawning a new one in `compile()`.

---

## Phase 2: Refactoring

### 8. InkFile.path simplification
- **Status:** DONE
- **Current:** `relPath` stored internally, `relativePath()` returns it, `absolutePath()` computes it.
- **Plan:**
    1. Make `relPath` the canonical property (already is internally)
    2. Deprecate `relativePath()` - replace all call sites with direct `.relPath` access
    3. Keep `absolutePath()` as the special case since it requires `projectDir`
    4. Update all call sites (~20 locations)
- **Files:**
    - `app/renderer/inkFile.js` (lines 130-142)
    - `app/renderer/inkProject.js` (lines 95, 104, 115, 138, 142, 274, 289, 578-579)
    - `app/renderer/navView.js` (lines 235-293, 300-313)
    - `app/renderer/controller.js` (lines 44, 49, 51, 112)
    - `app/renderer/liveCompiler.js`
    - `app/renderer/goto.js`

### 9. Convert ad-hoc events to NodeJS EventEmitters
- **Status:** DONE
- **Current:** All modules use `setEvents(obj)` pattern.
- **Plan:**
    1. Start with one module as proof of concept (e.g., `EditorView`)
    2. Replace `setEvents()` with `EventEmitter` methods
    3. Update `controller.js` wiring to use `.on()` / `.emit()`
    4. Migrate remaining modules one by one
- **Files:** All renderer modules and `controller.js`

---

## Phase 3: New Features

### 10. Keyboard shortcuts
- **Status:** DONE
- **Priority:** High
- **Complexity:** Low-Medium
- **Plan:**
    1. **Ctrl-(shift)-tab**: Add Electron menu accelerators or global shortcuts to cycle through `InkProject.files` in usage order or sidebar order
    2. **Back/forward (Cmd-Opt-Left/Right)**: Wire to `NavHistory.back()`/`NavHistory.forward()` via menu accelerators in `appmenus.js`
    3. **Follow symbol (Cmd-Opt-Return)**: Add Ace command to read token under cursor and call `events.jumpToSymbol()`
- **Files:** `app/main-process/appmenus.js`, `app/renderer/editorView.js`, `app/renderer/controller.js`

### 11. Highlight files in nav that have errors
- **Status:** DONE
- **Priority:** High
- **Complexity:** Low
- **Plan:**
    1. In `controller.js` `errorsAdded` handler, collect filenames with errors
    2. In `navView.js` `setFiles()`, add `has-errors` CSS class to matching file nav items
    3. Add CSS styling (red dot or warning icon)
- **Files:** `app/renderer/controller.js` (lines 109-119), `app/renderer/navView.js` (lines 235-293)

### 12. Add filenames to issue browser
- **Status:** DONE
- **Priority:** Medium
- **Complexity:** Low
- **Plan:**
    1. In `toolbarView.js` `updateIssueSummary()`, prepend filename to issue descriptions when in multi-file mode
- **Files:** `app/renderer/toolbarView.js` (lines 12-106)

### 13. File renaming and deletion
- **Status:** DONE
- **Priority:** High
- **Complexity:** Medium
- **Plan:**
    1. Add `rename(newPath)` method to `InkFile` that updates `relPath`, renames on disk, and updates all INCLUDE references
    2. Add `renameInkFile(inkFile, newPath)` to `InkProject`
    3. Add right-click context menu in `navView.js` with Rename/Delete options
    4. Add "File > Rename" menu item in `appmenus.js`
    5. For Mac-style return-to-rename: make nav items editable on Return key press
- **Files:** `app/renderer/inkFile.js`, `app/renderer/inkProject.js`, `app/renderer/navView.js`, `app/main-process/appmenus.js`

### 14. Find in project
- **Status:** DONE
- **Priority:** High
- **Complexity:** Medium-High
- **Plan:**
    1. Create `findInProject.js` view module
    2. Use Ace's search API for single-file find/replace
    3. For multi-file search, iterate through all `InkFile.aceDocument` instances
    4. Add Cmd+Shift+F accelerator
    5. Create search panel UI similar to GotoAnything overlay
- **Files:** New file `app/renderer/findInProject.js`, `app/renderer/controller.js`, `app/main-process/appmenus.js`

### 15. Go to symbol in project
- **Status:** DONE
- **Priority:** Medium
- **Complexity:** Low-Medium
- **Plan:**
    1. Extend `GotoAnything` to index all symbols across all project files
    2. Add a "Symbols" category to the results
    3. Prioritize active file symbols in results
- **Files:** `app/renderer/goto.js`

### 16. Proper include hierarchy view
- **Status:** DONE
- **Priority:** Medium
- **Complexity:** Medium-High
- **Plan:**
    1. Modify `navView.js` `setFiles()` to build a tree structure from the include graph
    2. `InkProject.refreshIncludes()` already tracks parent-child relationships; expose as tree
    3. Render nested `<nav-group>` elements with indentation
- **Files:** `app/renderer/navView.js` (lines 235-293), `app/renderer/inkProject.js` (lines 113-168)

### 17. Drag/drop includes between groups
- **Status:** DONE
- **Priority:** Low
- **Complexity:** High
- **Plan:**
    1. Add HTML5 drag/drop handlers to nav items
    2. On drop, update the INCLUDE line in the source file
    3. Handle edge cases (circular includes, cross-group moves)
- **Files:** `app/renderer/navView.js`, `app/renderer/inkFile.js`

### 18. Toggle editor/player views
- **Status:** DONE
- **Priority:** Medium
- **Complexity:** Low-Medium
- **Plan:**
    1. Add View menu items for toggling editor and player
    2. In `controller.js`, toggle CSS classes on `#editor` and `#player`
    3. Add focus mode with margins when both visible and window is wide
- **Files:** `app/renderer/controller.js`, `app/main-process/appmenus.js`, `app/renderer/index.html`

### 19. Pause live compilation/playing
- **Status:** DONE
- **Priority:** Low
- **Complexity:** Medium
- **Plan:**
    1. Add `paused` flag in `LiveCompiler`
    2. Add toggle in toolbar or menu
    3. When paused, queue edits and batch-compile on unpause
- **Files:** `app/renderer/liveCompiler.js`, `app/renderer/toolbarView.js`

### 20. Dynamic menu item titles
- **Status:** DONE
- **Priority:** Low
- **Complexity:** Low
- **Plan:**
    1. In `appmenus.js`, store references to menu items
    2. Send IPC from renderer with current filename
    3. Update `label` properties dynamically (e.g., "Save jolly.ink")
- **Files:** `app/main-process/appmenus.js`, `app/renderer/controller.js`

### 21. Menu item enabling behaviour
- **Status:** DONE
- **Priority:** Low
- **Complexity:** Low
- **Plan:**
    1. In `appmenus.js`, set `enabled` properties based on project state
    2. Send state updates from renderer via IPC (`hasUnsavedChanges`, `isPlaying`, etc.)
    3. Disable Save when no unsaved changes, disable Export when not ready, etc.
- **Files:** `app/main-process/appmenus.js`, `app/renderer/inkProject.js`, `app/renderer/controller.js`

### 22. Player debugging features
- **Status:** DONE
- **Priority:** Medium
- **Complexity:** Medium-High
- **Plan:**
    1. Toolbar UI for path jumping (text input + go button)
    2. Variable query panel similar to `ExpressionWatchView`
    3. Step-back buttons per turn chunk in player view
- **Files:** `app/renderer/toolbarView.js`, `app/renderer/playerView.js`, `app/renderer/expressionWatchView.js`

### 23. Error checking for file system operations
- **Status:** DONE
- **Priority:** Medium
- **Complexity:** Low-Medium
- **Plan:**
    1. Audit all `fs.writeFile`, `fs.readFile`, `fs.unlink` calls
    2. Add error handling with user-facing alerts
    3. Ensure graceful degradation when operations fail
- **Files:** `app/renderer/inkFile.js`, `app/renderer/inkProject.js`

### 24. Switch to specific ink file when opening externally
- **Status:** DONE
- **Priority:** Low
- **Complexity:** Low-Medium
- **Plan:**
    1. On external file open, check if file is part of current project
    2. If so, switch to that file instead of opening new window
- **Files:** `app/main-process/main.js`, `app/main-process/projectWindow.js`

### 25. Load & play JSON file
- **Status:** DONE
- **Priority:** Low
- **Complexity:** Medium
- **Plan:**
    1. Add menu item "File > Open JSON..."
    2. Load JSON, create `inkjs.Story` instance
    3. Hide editor/player editing controls
    4. Run story in read-only mode
- **Files:** `app/main-process/appmenus.js`, `app/renderer/controller.js`, `app/renderer/playerView.js`

### 26. Toolbar UI for path jumping during play
- **Status:** DONE (merged with item 22 - Player debugging features)
- **Priority:** Low
- **Complexity:** Medium
- **Plan:**
    1. Add text input in toolbar for entering story path
    2. Wire to LiveCompiler to jump to specific path
    3. Add "Go" button to execute the jump
- **Files:** `app/renderer/toolbarView.js`, `app/renderer/liveCompiler.js`

---

## Completed Items

### Phase 1: Bug Fixes
1. Ace editor highlights not removed when switching files - Fixed with per-session marker tracking
2. `/tmp` never gets cleared - Added temp file cleanup on file deletion
3. Replay transition issue - Added `isReplaying` flag to skip fade-in animations
4. Cmd-D for "don't save" - Added custom save dialog with Cmd-D shortcut
5. Multiple windows flakiness - Fixed menu state pollution and added duplicate project prevention
6. Story reloading reliability - Fixed missing `sessionId`, added compiler timeout and mkdirp error handling
7. Copies of inklecate left open - Added process cleanup before spawning new compiler

### Phase 2: Refactoring
8. InkFile.path simplification - Removed `relativePath()` method, updated all call sites to use `.relPath`
9. Convert ad-hoc events to NodeJS EventEmitters - Migrated all modules to EventEmitter pattern

### Phase 3: New Features
10. Keyboard shortcuts - Added Ctrl-Tab, Cmd-Opt-Left/Right, Cmd-Opt-Return
11. Highlight files in nav that have errors - Red filename color for files with errors
12. Add filenames to issue browser - File headings in multi-file mode
13. File renaming and deletion - Context menu, inline rename, INCLUDE line updates
14. Find in project - Cmd+Shift+F with multi-file search and replace
15. Go to symbol in project - Extended GotoAnything with cross-file symbol search
16. Proper include hierarchy view - Tree structure with indentation
17. Drag/drop includes between groups - HTML5 drag/drop with visual feedback
18. Toggle editor/player views - View menu toggles with focus mode
19. Pause live compilation - Toolbar toggle with pending changes queue
20. Dynamic menu item titles - Menu items show current filename
21. Menu item enabling behaviour - Contextual enable/disable based on project state
22. Player debugging features - Path jumping, variable query, step-back buttons
23. Error checking for file system operations - Added error handling with user alerts
24. Switch to specific ink file when opening externally - Reuses existing window for project files
25. Load & play JSON file - File > Open JSON with read-only playback mode
26. Toolbar UI for path jumping - Merged with item 22

### Phase 4: Code TODO Cleanup
27. `inkProject.js:182` - Optimized `refreshUnsavedChanges` to use lightweight `NavView.refreshFileStates()` instead of rebuilding entire nav view
28. `inkProject.js:259` - Added `scheduleRefreshIncludes()` with 100ms debounce to prevent spam on file watcher events
29. `inkFile.js:75,281` - Verified `justLoadedContent` flag is necessary (setValue triggers change event), replaced TODOs with clear explanations
30. `navView.js:314` - Added `setKnotsDebounced()` with 200ms debounce to prevent symbol parsing on every keystroke

### Phase 5: Bug Fixes (Regression Fixes)
31. Theme not applied on startup - Fixed by wrapping `updateTheme()` call in `$(document).ready()` in controller.js
32. Busy spinner always visible - Fixed by adding `display: none` to `.busySpinner` CSS in main.css
33. Busy spinner overlapping toolbar buttons - Fixed by repositioning from `right: 75px` to `right: 250px` in main.css
34. Cannot close editor - Fixed by adding callback parameter to `InkProject.prototype.save()` method (was being called with callback but didn't accept one)

---

## Remaining TODOs (Not Actionable)

| File | Line | TODO | Status |
|------|------|------|--------|
| `inkProject.js` | 274 | Ask user if they want to overwrite on external file change? | UX decision - author was unsure |
| `expressionWatchView.js` | 56 | Find a way to set InkMode without creating new document/session | Ace API limitation - not easily fixable |
