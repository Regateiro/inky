const electron = require('electron');
const ipc = electron.ipcMain;
const dialog = electron.dialog;
const BrowserWindow = electron.BrowserWindow;
const path = require("path");
const fs = require("fs");
const Inklecate = require("./inklecate.js").Inklecate;
const Menu = electron.Menu;
const i18n = require("./i18n/i18n.js");

var electronWindowOptions = {
  width: 1300,
  height: 730,
  minWidth: 350,
  minHeight: 250,
  webPreferences: {
    preload: path.join(__dirname, '..', 'renderer', 'preload.js'),
    nodeIntegration: true,
  contextIsolation: false
  },
  
};


if( process.platform == "darwin" ) {
    electronWindowOptions.titleBarStyle = 'hidden';
    electronWindowOptions.titleBarOverlay = true;
}

var windows = [];

const recentFilesPath = path.join(electron.app.getPath("userData"), "recent-files.json");

const viewSettingsPath = path.join(electron.app.getPath("userData"), "view-settings.json");


// Global event handlers (set by main.js)
var globalEventHandlers = {
    onRecentFilesChanged:    (files) => {},
    onViewSettingsChanged:   (settings) => {}
};


function ProjectWindow(filePath) {
    const getThemeFromMenu = () => Menu.getApplicationMenu().items.find(
        e => e.label.toLowerCase() === '&view'
    ).submenu.items.find(
        e => e.label.toLowerCase() === 'theme'
    ).submenu.items.find(
        e => e.checked
    ).label.toLowerCase();

    electronWindowOptions.title = i18n._("Inky");
    this.browserWindow = new BrowserWindow(electronWindowOptions);
    this.browserWindow.loadURL("file://" + __dirname + "/../renderer/index.html");
    this.browserWindow.setSheetOffset(49);

    this.safeToClose = false;
    this.mainInkAbsPath = filePath;
    this.projectState = {
        hasUnsavedChanges: false,
        isReady: false,
        hasProject: false,
        hasActiveFile: false,
        activeFileIsMainInk: true,
    };

    // Per-window event handlers
    this.eventHandlers = {
        onProjectSettingsChanged: (settings) => {},
        onProjectStateFocused: (win) => {}
    };

    // Existing project at specific path
    if( filePath ) {
        this.browserWindow.webContents.on('dom-ready', () => {
            this.browserWindow.setRepresentedFilename(filePath);
            this.browserWindow.webContents.send('set-project-main-ink-filepath', filePath);

            // Try to load settings 
            this.refreshProjectSettings(filePath);
        });
    }
    
    // New project, new settings
    else {
        this.settings = {};
        this.notifySettingsChanged();
    }

    windows.push(this);

    this.browserWindow.on("close", (event) => {
        if( !this.safeToClose ) {
            event.preventDefault();
            this.tryClose();
        }
    })

    this.browserWindow.on("closed", () => {
        var idx = windows.indexOf(this);
        if( idx != -1 )
            windows.splice(idx, 1);
    });

    // Set up theme/zoom from settings
    this.browserWindow.webContents.on('dom-ready', () => {
        this.browserWindow.send("change-theme", getThemeFromMenu());

        let settings = ProjectWindow.getViewSettings();
        this.zoom(settings.zoom);
        this.browserWindow.webContents.send('set-animation-enabled', settings.animationEnabled);
        this.browserWindow.webContents.send('set-autocomplete-disabled', !!settings.autoCompleteDisabled);
    });

    // Project settings may affect menus etc, so we refresh that
    // when changing focus between different windows
    this.browserWindow.on("focus", () => {
        this.notifySettingsChanged();
        this.notifyStateFocused();
    });

    this.browserWindow.on("blur", () => {
        // No action needed - main.js handles blur globally
    });
}

// Per-window notification methods
ProjectWindow.prototype.notifySettingsChanged = function() {
    if( this.eventHandlers.onProjectSettingsChanged )
        this.eventHandlers.onProjectSettingsChanged(this.settings);
}

ProjectWindow.prototype.notifyStateFocused = function() {
    if( this.eventHandlers.onProjectStateFocused )
        this.eventHandlers.onProjectStateFocused(this);
}

ProjectWindow.prototype.newInclude = function() {
    this.browserWindow.webContents.send('project-new-include');
}

ProjectWindow.prototype.renameFile = function() {
    this.browserWindow.webContents.send('project-rename-file');
}

ProjectWindow.prototype.deleteFile = function() {
    this.browserWindow.webContents.send('project-delete-file');
}

ProjectWindow.prototype.save = function() {
    this.browserWindow.webContents.send('project-save');
}

ProjectWindow.prototype.exportJson = function() {
    this.browserWindow.webContents.send('project-export');
}

ProjectWindow.prototype.exportForWeb = function() {
    this.browserWindow.webContents.send('project-export-for-web');
}

ProjectWindow.prototype.exportJSOnly = function() {
    this.browserWindow.webContents.send('project-export-js-only');
}

ProjectWindow.prototype.tryClose = function() {
    this.browserWindow.webContents.send('project-tryClose');
}

ProjectWindow.prototype.stats = function() {
    this.browserWindow.webContents.send('project-stats');
}

ProjectWindow.prototype.keyboardShortcuts = function() {
    this.browserWindow.webContents.send('keyboard-shortcuts');
}

ProjectWindow.prototype.finalClose = function() {
    this.safeToClose = true;
    Inklecate.killSessions(this.browserWindow);
    this.browserWindow.close();
}

ProjectWindow.prototype.openDevTools = function() {
    this.browserWindow.webContents.openDevTools();
}

ProjectWindow.prototype.switchToFile = function(absFilePath) {
    if (!this.mainInkAbsPath) return false;
    this.browserWindow.webContents.send('open-ink-file-by-path', absFilePath);
    return true;
}

ProjectWindow.prototype.zoom = function(amount) {
    this.browserWindow.webContents.send('zoom', amount);
}

// Try to load up an optional <ink_root_file_name>.settings.json file
ProjectWindow.prototype.refreshProjectSettings = function(rootInkFilePath) {
    
    let self = this;


    const resolvedRootPath = path.resolve(rootInkFilePath);
    let basePath = rootInkFilePath;
    if( path.extname(resolvedRootPath) == ".ink" ) {
        basePath = rootInkFilePath.substring(0, resolvedRootPath.length-4)
    }
    const settingsPath = basePath + ".settings.json";


    function completeSettings(settings, err) {
        self.settings = settings;
        self.notifySettingsChanged();

        self.browserWindow.send("project-settings-changed", self.settings);

        if( err ) {
            dialog.showErrorBox("Project Settings Error", err);
        }
    }

    fs.stat(settingsPath, (err, stats) => {
        if( err || !stats.isFile() ) { 
            completeSettings({});
            return;
        }

        fs.readFile(settingsPath, "utf8", (err, fileContent) => {

            if( err ) {
                completeSettings({}, "File read error - failed to load project settings file at: "+settingsPath);
                return;
            }
            if( !fileContent ) {
                completeSettings({}, "Project settings file appeared to be empty: "+settingsPath);
                return;
            }

            let settings = {};
            try {
                settings = JSON.parse(fileContent);
            } catch(error) {
                completeSettings({}, "Project settings file appeared to be invalid JSON: "+settingsPath+": "+error);
                return;
            }

            completeSettings(settings);
        });

    });
}


ProjectWindow.all = () => windows;

ProjectWindow.setGlobalEventHandlers = function(handlers) {
    globalEventHandlers = { ...globalEventHandlers, ...handlers };
}

ProjectWindow.setPerWindowEventHandlers = function(win, handlers) {
    if( win ) {
        win.eventHandlers = { ...win.eventHandlers, ...handlers };
    }
}


ProjectWindow.createEmpty = function() {
    return new ProjectWindow();
}

ProjectWindow.focused = function() {
    var browWin = BrowserWindow.getFocusedWindow();
    if( browWin )
        return ProjectWindow.withWebContents(browWin.webContents);
    else
        return null;
}


ProjectWindow.withWebContents = function(webContents) {
    if( !webContents )
        return null;

    for(var i=0; i<windows.length; i++) {
        if( windows[i].browserWindow.webContents === webContents )
            return windows[i];
    }
    return null;
}


ProjectWindow.withMainkInkPath = function(absPath) {
    if( !absPath ) return null;

    for(var i=0; i<windows.length; i++) {
        if( windows[i].mainInkAbsPath == absPath )
            return windows[i];
    }
    return null;
}


ProjectWindow.getRecentFiles = function() {
    if(!fs.existsSync(recentFilesPath)) {
        return [];
    }
    const json = fs.readFileSync(recentFilesPath, "utf-8");
    try {
        return JSON.parse(json);
    } catch(e) {
        console.error("Error in recent files JSON parsing:", e);
        return [];
    }
}

ProjectWindow.clearRecentFiles = function() {
    if(fs.existsSync(recentFilesPath)) {
        fs.unlinkSync(recentFilesPath);
    }
}

function addRecentFile(filePath) {
    const resolvedFilePath = path.resolve(filePath);
    const recentFiles = ProjectWindow.getRecentFiles();
    const newRecentFiles = recentFiles.indexOf(resolvedFilePath) >= 0 ?
        recentFiles :
        [resolvedFilePath].concat(recentFiles).slice(0, 5);
    fs.writeFileSync(recentFilesPath, JSON.stringify(newRecentFiles), {
        encoding: "utf-8"
    });

    if( globalEventHandlers.onRecentFilesChanged ) {
        globalEventHandlers.onRecentFilesChanged(newRecentFiles);
    }
}

ProjectWindow.open = function(filePath) {
    if( !filePath ) {
        var multiSelectPaths = dialog.showOpenDialogSync({
            title: i18n._("Open main ink file"),
            properties: ['openFile'],
            filters: [
                { name: i18n._('Ink files'), extensions: ['ink'] }
            ]
        });
        if( multiSelectPaths && multiSelectPaths.length > 0 )
            filePath = multiSelectPaths[0];
    }

    if( filePath) {
        const resolvedPath = path.resolve(filePath);
        const existingWin = ProjectWindow.withMainkInkPath(resolvedPath);
        if( existingWin ) {
            existingWin.browserWindow.focus();
            return existingWin;
        }

        addRecentFile(filePath);
        return new ProjectWindow(filePath);
    }
}

ProjectWindow.getViewSettings = function() {
    let viewSettingDefaults = { theme:'light', zoom:'100', animationEnabled:true };

    if(!fs.existsSync(viewSettingsPath)) {
        return viewSettingDefaults;
    }
    
    const json = fs.readFileSync(viewSettingsPath, "utf-8");
    try {
        let loadedSettings = JSON.parse(json);

        // if we've added a new setting or one is missing, make sure they all exist
        for(let requiredKey in viewSettingDefaults) {
            if(loadedSettings[requiredKey] === undefined) {
                loadedSettings[requiredKey] = viewSettingDefaults[requiredKey];
            }
        }

        return loadedSettings;
    } catch(e) {
        console.error('Error in view settings JSON parsing:', e);
        return viewSettingDefaults;
    }
}

ProjectWindow.addOrChangeViewSetting = function(name, data){
    const viewSettings = ProjectWindow.getViewSettings();
    viewSettings[name] = data;
    fs.writeFileSync(viewSettingsPath, JSON.stringify(viewSettings), {
        encoding: "utf-8"
    });
    if(globalEventHandlers.onViewSettingsChanged) {
        globalEventHandlers.onViewSettingsChanged(viewSettings);
    }
}


ipc.on("main-file-saved", (event, absFilePath) => {
    addRecentFile(absFilePath);

    var win = ProjectWindow.withWebContents(event.sender);
    win.mainInkAbsPath = absFilePath;
    win.refreshProjectSettings(absFilePath);
});

ipc.on("project-final-close", (event) => {
    var win = ProjectWindow.withWebContents(event.sender);
    win.finalClose();
});

ipc.on("project-settings-needs-reload", (event, rootInkFilePath) => {
    var win = ProjectWindow.withWebContents(event.sender);
    win.refreshProjectSettings(rootInkFilePath);
});

ipc.on("set-native-window-title", (event, newWindowTitle) => {
    var win = ProjectWindow.withWebContents(event.sender);
    win.browserWindow.title = newWindowTitle;
});

ipc.on("project-state-changed", (event, state) => {
    var win = ProjectWindow.withWebContents(event.sender);
    if( win ) {
        win.projectState = state;
    }
});

exports.ProjectWindow = ProjectWindow;
