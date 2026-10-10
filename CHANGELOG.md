# Changelog

All notable changes to Inky are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.18.0] - 2026-10-10

A robustness, security and testing release: the interactive compiler and the
main process were hardened against crashes, cross-window input injection and
path traversal, and the app gained a permanent regression/robustness test
suite. The app is now Linux-only, and the bundled `inklecate` compiler binary
is updated from the latest inkle/ink release via `make update-deps` (Git LFS).

### Added

- **Regression test suite** (`app/test/regression.test.js`, T-series) with 11
  tests, each reproducing a previously verified bug and now guarding its fix.
- **Robustness test suite** (`app/test/robustness.test.js`, M-series) with 12
  tests covering the main process and the compiler session lifecycle.
- **`app/test/TODO.md`** tracking the known bugs, their fixes and the
  pre/post-fix validation records for both suites.
- **`--user-data-dir` support** so each launch (and each test) can use an
  isolated profile instead of the real one.
- **Second-instance handling**: a second launch quits and focuses/restores the
  existing instance's windows rather than running alongside it.
- **`INKY_INKLECATE_PATH`** environment override for the compiler binary
  (used by the test harness and useful for custom `inklecate` installs).
- **`main-process/dialogOptions.js`** providing `sanitizeSaveDialogOptions()`.
- **`Makefile`** with Linux AppImage `build` and `install` targets.
- External-change and deletion warnings when a file with unsaved edits is
  modified or removed on disk.

### Changed

- **Linux-only app**: macOS and Windows support was removed. The compiler
  binary path (`inklecate.js`), the packaging script (`build-package.js`), the
  GitHub Actions build workflow and the README only cover Linux now.
- **`inklecate` compiler binary** (`app/main-process/ink/inklecate_linux`)
  is updated from the latest inkle/ink release via
  `make update-deps`/`build/update-inklecate.sh`, and is stored with Git LFS.
  It now matches the official inkle/ink v1.2.1 release asset (previously the
  repo carried a differently-built binary of the same version), and
  `build/update-inklecate.sh` keeps `app/main-process/ink/version.txt` (shown
  in the About dialog) in sync with the release tag.
- **Live compiler replies** now use FIFO callback queues instead of single
  callback slots, and the main process counts outstanding expression
  evaluations and variable listings instead of using a single flag.
- **Find in project** now debounces input (150 ms) and renders at most 200
  result rows while still reporting the true match count.
- **Test launches** use an isolated user data directory and a hardened
  teardown (close raced against a timeout plus `SIGKILL`).

### Fixed

- A missing or non-executable compiler binary no longer crashes the whole app:
  the spawned process's `error` event is handled and reported to the renderer.
- Sending to a destroyed/closed window is now routed through `safeSend()`
  instead of throwing `Object has been destroyed` from inside main-process
  event handlers.
- Compiler processes are now killed when their window is destroyed directly
  (`destroy()` bypasses the polite close flow), so orphaned `inklecate`
  processes no longer leak.
- Story menu commands (toggle tags, next issue, go to anything, add watch
  expression) no longer throw when invoked with no focused window.
- Stale, duplicate or unsolicited compiler IPC replies no longer throw in the
  renderer (callback slots are null-checked before use).
- Save-completion callback now fires when the main ink save fails while
  includes are still pending (previously save-and-close hung forever).
- `InkFile.save()` without a callback no longer throws
  `afterSaveCallback is not a function` when the write fails.
- `InkFile.tryLoadFromDisk()` no longer crashes (and now fires its callback)
  when an `INCLUDE` points at a directory.
- `InkProject.addNewInclude()` with an absolute path on an unsaved project now
  fails gracefully with a message instead of `ReferenceError: assert is not
  defined`.
- Rename and delete menu commands are no longer registered twice, so renaming
  no longer fights over focus and re-shows the filename label.
- Clicking outside the "add include" form now closes it
  (`.length == 0` instead of a never-true comparison).
- Go-to-anything cancels its in-flight result-build interval when the query is
  cleared or the panel is hidden, eliminating stale "phantom" results.
- Changing the theme no longer triggers a full story recompile and replay.
- A variable-query response arriving after the 2 s timeout no longer walks the
  chain twice and duplicates results.
- `ProjectWindow.switchToFile()` only claims a file that belongs to its
  project (resolved-path match, or a renderer-confirmed include), so opening
  another `.ink` no longer routes to the wrong window.
- `updateIssueSummary()` no longer sorts the caller's array in place.

### Security

- **Compiler session ownership**: every stdin command (`stop`, choice,
  evaluate, list variables, debug source/path, jump) is now checked against
  the window that started the session, so a foreign renderer can no longer
  inject input into another window's story.
- **`remove-temp-file` traversal guard**: the resolved path must stay inside
  the temp directory, so a renderer can no longer unlink arbitrary files.
- **Save dialog sanitisation**: renderer-supplied options are whitelisted
  (`title`, `message`, `buttonLabel`, `defaultPath`, `filters`, `properties`)
  before reaching the native dialog.

### Removed

- macOS and Windows inklecate binaries (`inklecate_mac`, `inklecate_win.exe`)
  and their `inkjs-compatible/` copies.
- macOS packaging resources (`Icon.icns`, `Info.plist`, `appdmg.json`,
  `appdmg-background.png`, `appdmg-background@2x.png`, `makeIcns.command`)
  and the Windows icon (`Icon1024.png.ico`), plus the `appdmg` npm dependency.
- Per-platform build scripts (`BUILD_FOR_LINUX.sh`, `BUILD_FOR_MAC.command`,
  `BUILD_FOR_MAC_SIGN_AND_MAKE_DMG.command`, `BUILD_FOR_WINDOWS.bat`,
  `INSTALL_AND_RUN.command`, `RUN.command`, `BUILD_PACKAGE.command`),
  superseded by the `Makefile`.
