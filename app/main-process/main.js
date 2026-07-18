const {app, BrowserWindow, ipcMain, dialog, ipcRenderer, Menu} = require('electron')
const i18n = require("./i18n/i18n.js")
const {ProjectWindow} = require("./projectWindow.js");
const {DocumentationWindow} = require("./documentationWindow.js");
const {AboutWindow} = require("./aboutWindow.js");
const {AppMenus} = require('./appmenus.js');
const {onForceQuit} = require('./forceQuitDetect');
const {Inklecate} = require("./inklecate.js");
const { fstat } = require('original-fs');
const fs = require("fs");

if (process.argv.includes('--disable-gpu')) {
    app.disableHardwareAcceleration();
}


function inkJSNeedsUpdating() {
    return false;
    // dialog.showMessageBox({
    //   type: 'error',
    //   buttons: ['Okay'],
    //   title: 'Export for web unavailable',
    //   message: "Sorry, export for web is currently disabled, until inkjs is updated to support the latest version of ink. You can download a previous version of Inky that supports inkjs and use that instead, although some of the latest features of ink may be missing."
    // });
    // return true;
}

// main
let pendingPathToOpen = null;
let hasFinishedLaunch = false;

// main
ipcMain.on('show-context-menu', (event) => {
    const template = [
        {
            label: 'Cut',
            role: 'cut' 
        },
        {
            label: 'Copy',
            role: 'copy' 
        },
        {
            label: 'Paste',
            role: 'paste' 
        },
      { type: 'separator' },
    ]
    const menu = Menu.buildFromTemplate(template)
    menu.popup(BrowserWindow.fromWebContents(event.sender))
})


ipcMain.handle("showSaveDialog", async (event,saveOptions) => {
    return dialog.showSaveDialog(saveOptions) 

})

ipcMain.handle("try-close", async (event) =>{
    return dialog.showMessageBox({
        type: "warning",
        message: i18n._("Would you like to save changes before exiting?"),
        detail: i18n._("Your changes will be lost if you don't save."),
        buttons: [
            i18n._("Save"),
            i18n._("Don't save"),
            i18n._("Cancel")
        ],
        defaultId: 0
    })
    
})

app.on('will-finish-launching', function () {
app.on("open-file", async function (event, path) {
        ProjectWindow.open(path);
        event.preventDefault();
    });

});

let isQuitting = false;

app.on("open-file", function (event, path) {

    // e.g. Drag and drop onto app to open it.
    // "open-file" seems to come before "will-finish-launching"
    if( !hasFinishedLaunch ) {
        pendingPathToOpen = path;
    }
    
    // Drag and drop onto app while it's already open
    else {

        // See if this file is open in an existing project window
        let handled = false;
        for (let win of ProjectWindow.all()) {
            if (win.switchToFile(path)) {
                win.browserWindow.focus();
                handled = true;
                break;
            }
        }

        if (!handled) {
            ProjectWindow.open(path);       
        }
    }
    
    event.preventDefault();
});

app.on('before-quit', function () {
    // We need this to differentiate between pressing quit (which should quit) or closing all windows
    // (which leaves the app open)
    isQuitting = true;
});

ipcMain.on("project-cancelled-close", (event) => {
    isQuitting = false;
});

ipcMain.on("update-current-filename", (event, filename) => {
    AppMenus.setCurrentFilename(filename);
    AppMenus.refresh();
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', function () {
    
    app.on('window-all-closed', function () {
        if (process.platform != 'darwin' || isQuitting) {
            app.quit();
        }
    });
    
    AppMenus.setCallbacks({
        get isFocusedWindow() { return !!ProjectWindow.focused(); },
        new: () => {
            ProjectWindow.createEmpty();
        },
        newInclude: () => {
            var win = ProjectWindow.focused();
            if (win) win.newInclude();
        },
        renameFile: () => {
            var win = ProjectWindow.focused();
            if (win) win.renameFile();
        },
        deleteFile: () => {
            var win = ProjectWindow.focused();
            if (win) win.deleteFile();
        },
        open: () => {
            console.log("Test!")
            ProjectWindow.open();
        },
        openJson: () => {
            var win = ProjectWindow.focused();
            var targetWindow = win ? win.browserWindow : ProjectWindow.all()[0]?.browserWindow;
            if (!targetWindow) return;
            dialog.showOpenDialog(targetWindow, {
                title: i18n._("Open JSON Story"),
                filters: [{ name: "JSON Files", extensions: ["json"] }],
                properties: ["openFile"]
            }).then(result => {
                if (result.canceled || result.filePaths.length === 0) return;
                var filePath = result.filePaths[0];
                targetWindow.webContents.send("open-json-file", filePath);
            });
        },
        clearRecent: () => {
            ProjectWindow.clearRecentFiles();
            AppMenus.setRecentFiles([]);
            AppMenus.refresh();
        },
        save: () => {
            var win = ProjectWindow.focused();
            if (win) win.save();
        },
        exportJson: () => {
            var win = ProjectWindow.focused();
            if (win) win.exportJson();
        },
        exportForWeb: () => {
            if( inkJSNeedsUpdating() ) return;
            var win = ProjectWindow.focused();
            if (win) win.exportForWeb();
        },
        exportJSOnly: () => {
            if( inkJSNeedsUpdating() ) return;
            var win = ProjectWindow.focused();
            if (win) win.exportJSOnly();
        },
        toggleTags: (item, focusedWindow, event) => {
            focusedWindow.webContents.send("set-tags-visible", item.checked);
        },
        nextIssue: (item, focusedWindow) => {
            focusedWindow.webContents.send("next-issue");
        },
        gotoAnything: (item, focusedWindow) => {
            focusedWindow.webContents.send("goto-anything");
        },
        findInProject: (item, focusedWindow) => {
            if (focusedWindow) focusedWindow.webContents.send("find-in-project");
        },
        addWatchExpression: (item, focusedWindow) => {
            focusedWindow.webContents.send("add-watch-expression");
        },
        showDocs: () => {
            DocumentationWindow.openDocumentation(ProjectWindow.getViewSettings().theme);
        },
        showAbout: () => {
            AboutWindow.showAboutWindow(ProjectWindow.getViewSettings().theme);
        },
        keyboardShortcuts: () => {
            var win = ProjectWindow.focused();
            if (win) win.keyboardShortcuts();
        },
        stats: () => {
            var win = ProjectWindow.focused();
            if (win) win.stats();
        },
        zoomIn: () => {
            var win = ProjectWindow.focused();
            if (win != null) {
                win.zoom(2);
                // Convert change from font size to zoom percentage
                let zoom = ProjectWindow.getViewSettings().zoom;
                zoom = (parseInt(zoom) + Math.floor(2*100/12)).toString();
                ProjectWindow.addOrChangeViewSetting('zoom', zoom);
            }
        },
        zoomOut: () => {
          var win = ProjectWindow.focused();
          if (win != null) {
              win.zoom(-2);
              // Convert change from font size to zoom percentage
              let zoom = ProjectWindow.getViewSettings().zoom
              zoom = (parseInt(zoom) - Math.floor(2*100/12)).toString();
              ProjectWindow.addOrChangeViewSetting('zoom', zoom);
            }
        },
        zoom: (zoom_percent) => {
            var win = ProjectWindow.focused();
            if (win != null) {
                win.zoom(zoom_percent);
                let zoom = zoom_percent.toString();
                ProjectWindow.addOrChangeViewSetting('zoom', zoom)
            }
        },
        toggleAnimation: () => {
            let animEnabled = !ProjectWindow.getViewSettings().animationEnabled;
            ProjectWindow.addOrChangeViewSetting('animationEnabled', animEnabled)

            for(let i=0; i<ProjectWindow.all().length; i++) {
                let eachWindow = ProjectWindow.all()[i];
                eachWindow.browserWindow.webContents.send("set-animation-enabled", animEnabled);
            }
        },
        toggleAutoComplete: () => {
            let autoCompleteDisabled = !ProjectWindow.getViewSettings().autoCompleteDisabled;
            ProjectWindow.addOrChangeViewSetting('autoCompleteDisabled', autoCompleteDisabled)

            for(let i=0; i<ProjectWindow.all().length; i++) {
                let eachWindow = ProjectWindow.all()[i];
                eachWindow.browserWindow.webContents.send("set-autocomplete-disabled", autoCompleteDisabled);
            }
        },
        nextFile: (item, focusedWindow) => {
            if (focusedWindow) focusedWindow.webContents.send("next-file");
        },
        prevFile: (item, focusedWindow) => {
            if (focusedWindow) focusedWindow.webContents.send("prev-file");
        },
        navigateBack: (item, focusedWindow) => {
            if (focusedWindow) focusedWindow.webContents.send("navigate-back");
        },
        navigateForward: (item, focusedWindow) => {
            if (focusedWindow) focusedWindow.webContents.send("navigate-forward");
        },
        followSymbol: (item, focusedWindow) => {
            if (focusedWindow) focusedWindow.webContents.send("follow-symbol");
        },
        insertSnippet: (focussedWindow, snippet) => {
            if( focussedWindow )
            focussedWindow.webContents.send('insertSnippet', snippet);
        },
        changeTheme: (newTheme) => {
            AboutWindow.changeTheme(newTheme);
            DocumentationWindow.changeTheme(newTheme);
            ProjectWindow.addOrChangeViewSetting('theme', newTheme)
        }
    });
    
    AppMenus.setRecentFiles(ProjectWindow.getRecentFiles());
    AppMenus.setTheme(ProjectWindow.getViewSettings().theme);
    AppMenus.setZoom(ProjectWindow.getViewSettings().zoom);
    AppMenus.setAnimationEnabled(ProjectWindow.getViewSettings().animationEnabled);
    AppMenus.setAutoCompleteDisabled(ProjectWindow.getViewSettings().autoCompleteDisabled)

    AppMenus.refresh();
    
    // Set global event handlers (for events that affect all windows)
    ProjectWindow.setGlobalEventHandlers({
        onRecentFilesChanged: (recentFiles) => {
            AppMenus.setRecentFiles(recentFiles);
            AppMenus.refresh();
        },
        onViewSettingsChanged: (viewSettings) => {
            AppMenus.setTheme(viewSettings.theme);
            AppMenus.setZoom(viewSettings.zoom);
            AppMenus.setAnimationEnabled(viewSettings.animationEnabled);
            AppMenus.setAutoCompleteDisabled(viewSettings.autoCompleteDisabled);
            AppMenus.refresh();
        }
    });

    // Helper to set per-window event handlers for a specific window
    function setupWindowEventHandlers(win) {
        ProjectWindow.setPerWindowEventHandlers(win, {
            onProjectSettingsChanged: (settings) => {
                // Only update menus if this window is currently focused
                if( ProjectWindow.focused() === win ) {
                    settings = settings || {};
                    AppMenus.setCustomSnippetMenus(settings.customInkSnippets || []);
                    AppMenus.refresh();
                }
            },
            onProjectStateFocused: (focusedWin) => {
                AppMenus.setProjectState(focusedWin.projectState);
                if( focusedWin.projectState.currentFilename )
                    AppMenus.setCurrentFilename(focusedWin.projectState.currentFilename);
                AppMenus.refresh();
            }
        });
    }

    // Set up handlers for existing windows
    ProjectWindow.all().forEach(setupWindowEventHandlers);

    // Watch for new windows being created
    const originalCreateEmpty = ProjectWindow.createEmpty;
    ProjectWindow.createEmpty = function() {
        const win = originalCreateEmpty();
        setupWindowEventHandlers(win);
        return win;
    };

    const originalOpen = ProjectWindow.open;
    ProjectWindow.open = function(filePath) {
        const win = originalOpen(filePath);
        if( win ) setupWindowEventHandlers(win);
        return win;
    };

    // Handle window blur - reset menus only if no window is focused
    function handleWindowBlur() {
        setTimeout(() => {
            const focused = ProjectWindow.focused();
            if( focused ) return;
            AppMenus.setProjectState({
                hasUnsavedChanges: false,
                isReady: false,
                hasProject: false,
                hasActiveFile: false,
                activeFileIsMainInk: true,
            });
            AppMenus.setCurrentFilename(null);
            AppMenus.setCustomSnippetMenus([]);
            AppMenus.refresh();
        }, 0);
    }

    // Attach blur handler to all existing windows
    ProjectWindow.all().forEach(win => {
        win.browserWindow.on("blur", handleWindowBlur);
    });

    // Watch for new windows to attach blur handler
    const origCreateEmpty = ProjectWindow.createEmpty;
    ProjectWindow.createEmpty = function() {
        const win = origCreateEmpty();
        win.browserWindow.on("blur", handleWindowBlur);
        return win;
    };

    const origOpen = ProjectWindow.open;
    ProjectWindow.open = function(filePath) {
        const win = origOpen(filePath);
        if( win ) win.browserWindow.on("blur", handleWindowBlur);
        return win;
    };

    // Windows passed file to open on command line?
    if (process.platform == "win32" && process.argv.length > 1 && !pendingPathToOpen) {
        for (let i = 1; i < process.argv.length; i++) {
            var arg = process.argv[i].toLowerCase();
            if (arg.endsWith(".ink")) {
                pendingPathToOpen = process.argv[1];
                break;
            }
        }
    }

    // Opened Inky with specific file (e.g. drag and drop or windows command line)
    if( pendingPathToOpen ) {
        ProjectWindow.open(pendingPathToOpen);
        pendingPathToOpen = null;
    }
    
    // Otherwise, open most recent file or show new empty window
    else {
        let recentFiles = ProjectWindow.getRecentFiles();
        let opened = false;
        if (recentFiles.length > 0 && fs.existsSync(recentFiles[0])) {
            try {
                ProjectWindow.open(recentFiles[0]);
                opened = true;
            } catch(e) {
                console.error("Failed to open recent file:", e);
            }
        }
        if (!opened) {
            ProjectWindow.createEmpty();
        }
    }

    // Setup last stored theme
    let theme = ProjectWindow.getViewSettings().theme;
    AboutWindow.changeTheme(theme);
    DocumentationWindow.changeTheme(theme);

    hasFinishedLaunch = true;

    // Debug
    //w.openDevTools();
});

ipcMain.on("project-state-changed", (event, state) => {
    AppMenus.setProjectState(state);
    AppMenus.setCurrentFilename(state.currentFilename);
    AppMenus.refresh();
});

function finalQuit() {
    Inklecate.killSessions();
}

onForceQuit(finalQuit);
app.on("will-quit", finalQuit);
