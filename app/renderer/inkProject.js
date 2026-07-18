const EventEmitter = require("events");
const {ipcRenderer} = require("electron");
const path = require("path");
const fs = require("fs");
const _ = require("lodash");
const chokidar = require('chokidar');
const mkdirp = require('mkdirp');
const i18n = require('./i18n.js');
const { InkMode } = require('./ace-ink-mode/ace-ink.js');
const { PlayerView } = require('./playerView.js');

const EditorView = require("./editorView.js").EditorView;
const NavView = require("./navView.js").NavView;

const InkFile = require("./inkFile.js").InkFile;
const LiveCompiler = require("./liveCompiler.js").LiveCompiler;
const { debug, debugTrace, debugError } = require("./debug.js");

// -----------------------------------------------------------------
// InkProject
// -----------------------------------------------------------------

InkProject.eventEmitter = new EventEmitter();
InkProject.currentProject = null;

// mainInkFilePath is optional, if creating a brand new untitled project
// Can also be absolute, if loading a project.
function InkProject(mainInkFilePath) {
    this.files = [];
    this.hasUnsavedChanges = false;
    this.unsavedFiles = [];

    // Default ink mode for syntax highlighting. This may be replace if
    // the user has a project settings file that customises the instructionPrefix
    this.inkMode = new InkMode("");

    this.mainInk = null;
    this.mainInk = this.createInkFile(mainInkFilePath || null, mainInkFilePath === undefined);

    EditorView.setFiles(this.files);
    this.showInkFile(this.mainInk);

    // Wait for all project files to be found before starting first compilation
    this.ready = false;

    // Make sure a project save is atomic   
    this.saveActive = false;

    this.startFileWatching();
}

InkProject.prototype.createInkFile = function(anyPath, isBrandNew, loadErrorCallback) {
    var inkFile = new InkFile(anyPath || null, this.mainInk, isBrandNew, this.inkMode);

    inkFile.on("fileChanged", () => { 
        if( inkFile.hasUnsavedChanges && !this.unsavedFiles.contains(inkFile) ) {
            this.unsavedFiles.push(inkFile);
            this.refreshUnsavedChanges();
        }

        // When a file is changed its state may change to have unsaved changes,
        // which should be reflected in the sidebar (unsaved files are bold).
        // Newly added INCLUDE lines get the callback includesChanged, below.
        this.refreshIncludes();
    });

    // Called when InkFile finds an INCUDE line in the contents of the file
    inkFile.on("includesChanged", () => {         
        this.refreshIncludes();
        if( inkFile.includes.length > 0  )
            NavView.initialShow();
    });

    if( loadErrorCallback ) {
        inkFile.on("loadError", (err) => {
            loadErrorCallback(err);
        });
    }

    this.files.push(inkFile);

    this.sortFileList();
    
    return inkFile;
}

InkProject.prototype.addNewInclude = function(newIncludePath, addToMainInk) {

    // Convert new include path to relative if it's not already
    if( path.isAbsolute(newIncludePath) ) {
        assert(this.mainInk.projectDir, "Main ink needs to be saved before we start loading includes with absolute paths.");
        newIncludePath = path.relative(this.mainInk.projectDir, newIncludePath);
    }

    // Make sure it doesn't already exist
    var alreadyExists = _.some(this.files, (f) => f.relPath == newIncludePath);
    if( alreadyExists ) {
        alert(`${i18n._("Could not create new include file at")} ${newIncludePath} ${i18n._("because it already exists!")}`);
        return null;
    }

    var newIncludeFile = this.createInkFile(newIncludePath || null, true);

    if( addToMainInk )
        this.mainInk.addIncludeLine(newIncludeFile.relPath);

    NavView.setFiles(this.mainInk, this.files, this.buildIncludeHierarchy());
    EditorView.setFiles(this.files);
    return newIncludeFile;
}

InkProject.prototype.scheduleRefreshIncludes = function() {
    if( this._refreshIncludesTimer ) clearTimeout(this._refreshIncludesTimer);
    this._refreshIncludesTimer = setTimeout(() => {
        this._refreshIncludesTimer = null;
        this.refreshIncludes();
    }, 100);
}

// - Load any newly discovered includes
// - Refresh nav hierarchy in sidebar
InkProject.prototype.refreshIncludes = function() {

    var existingRelFilePaths = _.map(_.without(this.files, this.mainInk), f => f.relPath);

    var relPathsFromINCLUDEs = [];
    var addIncludePathsFromFile = (inkFile) => {
        if( inkFile.includes.length == 0 )
            return;

        inkFile.includes.forEach(incPath => {
            let alreadyDone = relPathsFromINCLUDEs.contains(incPath);

            relPathsFromINCLUDEs.push(incPath);

            var recurseInkFile = this.inkFileWithRelativePath(incPath);
            if( recurseInkFile && !alreadyDone )
                addIncludePathsFromFile(recurseInkFile);
        });
    }
    addIncludePathsFromFile(this.mainInk);

    // Includes that we don't have in this.files yet that are mentioned in other files
    var includeRelPathsToLoad = _.difference(relPathsFromINCLUDEs, existingRelFilePaths)

    // Files that are in this.files that aren't actually mentioned anywhere
    var spareRelFilePaths = _.difference(existingRelFilePaths,  relPathsFromINCLUDEs);

    // Mark files that are spare, so they go in a special category at the bottom
    this.files.forEach(f => {
        f.isSpare = spareRelFilePaths.indexOf(f.relPath) != -1;
    });

    // Load up newly mentioned include files, if they exist
    if( this.mainInk.projectDir ) {
        includeRelPathsToLoad.forEach(newIncludeRelPath => {
            let absPath = path.join(this.mainInk.projectDir, newIncludeRelPath);
            fs.stat(absPath, (err, stats) => {
                // If it exists, and double check that it hasn't already been created during the async fs.stat
                if( !!stats && stats.isFile() &&  !_.some(this.files, f => f.relPath == newIncludeRelPath) ) {
                    let newFile = this.createInkFile(newIncludeRelPath, false, err => {
                        alert(`${i18n._("Failed to load ink file:")} ${err}`);
                        this.files.remove(newFile);
                        this.refreshIncludes();
                    });
                }
            });
            
        });

        this.sortFileList();
    }

    NavView.setFiles(this.mainInk, this.files, this.buildIncludeHierarchy());
    EditorView.setFiles(this.files);
    LiveCompiler.setEdited();
}

InkProject.prototype.sortFileList = function() {
    var mainInkFile = this.mainInk;
    this.files.sort(function(a,b) {
        return mainInkFile.includes.indexOf(a.relPath) - mainInkFile.includes.indexOf(b.relPath) 
    } );
}

InkProject.prototype.refreshUnsavedChanges = function() {

    this.hasUnsavedChanges = this.unsavedFiles.length > 0;

    // Update NavView for whether files are bold or not
    NavView.refreshFileStates(this.files);

    // Overall, are there *any* unsaved changes, and has the state changed?
    // Change the dot in the Mac close window button
    ipcRenderer.send("change-mac-dot", this.hasUnsavedChanges);

    this.sendProjectState();
}

InkProject.prototype.sendProjectState = function() {
    ipcRenderer.send("project-state-changed", {
        hasUnsavedChanges: this.hasUnsavedChanges,
        isReady: this.ready,
        hasProject: !!this.mainInk,
        hasActiveFile: !!this.activeInkFile,
        activeFileIsMainInk: this.activeInkFile === this.mainInk,
        currentFilename: this.activeInkFile ? this.activeInkFile.filename() : null,
    });
}

InkProject.prototype.startFileWatching = function() {
    if( !this.mainInk.projectDir ) {
        this.ready = true;
        return;
    }

    if( this.fileWatcher ) {
        try {
            this.fileWatcher.close();
        } catch (closeErr) {
            console.error("Failed to close file watcher:", closeErr);
        }
    }

    this.fileWatcher = chokidar.watch(this.mainInk.projectDir, {
        disableGlobbing: true
    });

    const isInkFile = fileAbsPath => {
        return fileAbsPath.split(".").pop() == "ink";
    };

    const tryUpdateSettingsFile = fileAbsPath => {
        const mainInkPath = this.mainInk.absolutePath();
        let basePath = mainInkPath;
        if( path.extname(basePath) == ".ink" ) {
            basePath = basePath.substring(0, basePath.length-4);
        }
        
        let expectedSettingsPath = basePath + ".settings.json";
        if( expectedSettingsPath != fileAbsPath ) {
            return false; // not a settings file
        }

        ipcRenderer.send("project-settings-needs-reload", mainInkPath);

        return true; // yes, it was a settings file
    }

    this.fileWatcher.on("add", newlyFoundAbsFilePath => {
        if( this.saveActive ) return; // ignore file watching while atomic save is active
        if( tryUpdateSettingsFile(newlyFoundAbsFilePath) ) return;
        if (!isInkFile(newlyFoundAbsFilePath)) { return; }

        var relPath = path.relative(this.mainInk.projectDir, newlyFoundAbsFilePath);
        var existingFile = _.find(this.files, f => f.relPath == relPath);
        if( !existingFile ) {
            console.log("Watch found new file - creating it: "+relPath);

            let newFile = this.createInkFile(newlyFoundAbsFilePath, false, err => {
                alert(`${i18n._("Failed to load ink file:")} ${err}`);
                this.files.remove(newFile);
                this.refreshIncludes();
            });

            this.scheduleRefreshIncludes();
        } else {
            console.log("Watch found file but it already existed: "+relPath);
        }
    });

    this.fileWatcher.on("change", updatedAbsFilePath => {
        if( this.saveActive ) return; // ignore file watching while atomic save is active
        if( tryUpdateSettingsFile(updatedAbsFilePath) ) return;
        if (!isInkFile(updatedAbsFilePath)) { return; }

        var relPath = path.relative(this.mainInk.projectDir, updatedAbsFilePath);
        var inkFile = _.find(this.files, f => f.relPath == relPath);
        if( inkFile ) {
            // TODO: maybe ask user if they want to overwrite? not sure I want to though
            if( !inkFile.hasUnsavedChanges ) {

                if( this.activeInkFile == inkFile )
                    EditorView.saveCursorPos();

                inkFile.tryLoadFromDisk(err => {
                    if( !err && this.activeInkFile == inkFile )
                        setImmediate(() => EditorView.restoreCursorPos());
                });
            }
        }
    });
    this.fileWatcher.on("unlink", removedAbsFilePath => {
        if( this.saveActive ) return; // ignore file watching while atomic save is active
        if( tryUpdateSettingsFile(removedAbsFilePath) ) return;
        if (!isInkFile(removedAbsFilePath)) { return; }

        var relPath = path.relative(this.mainInk.projectDir, removedAbsFilePath);
        var inkFile = _.find(this.files, f => f.relPath == relPath);
        if( inkFile ) {
            if( !inkFile.hasUnsavedChanges && inkFile != this.mainInk ) {
                this.deleteInkFile(inkFile);
            }
        }
    });

    this.fileWatcher.on("ready", () => {
        this.ready = true;
        this.sendProjectState();
    });

    this.fileWatcher.on("error", (error) => {
        console.error("File watcher error:", error);
        alert(`${i18n._("File watching error:")} ${error.message}`);
    });
}

InkProject.prototype.showInkFile = function(inkFile) {
    debugTrace("inkProject.showInkFile", typeof inkFile === 'string' ? inkFile : inkFile.filename());

    if( _.isString(inkFile) )
        inkFile = this.inkFileWithRelativePath(inkFile);

    if( inkFile && inkFile != this.activeInkFile ) {
        if( this.activeInkFile )
            this.activeInkFile.isActive = false;

        this.activeInkFile = inkFile;

        if( this.activeInkFile )
            this.activeInkFile.isActive = true;

        debug("inkProject.showInkFile: switching to", inkFile.filename(), "id:", inkFile.id);
        EditorView.showInkFile(inkFile);
        InkProject.eventEmitter.emit("didSwitchToInkFile", this.activeInkFile);

        this.sendProjectState();
    } else if (!inkFile) {
        debugError("inkProject.showInkFile: inkFile is null or undefined");
    } else {
        debug("inkProject.showInkFile: already showing", inkFile.filename());
    }
}

InkProject.prototype.save = function(afterSaveCallback) {

    // Make saving atomic, don't save again if we're already saving
    if( this.saveActive ) return;
    this.saveActive = true;

    var wasUnsaved = !this.mainInk.projectDir;

    var filesRemaining = this.files.length;
    var includeFiles = _.filter(this.files, f => f != this.mainInk);

    var allSuccess = true;

    var singleFileSaveComplete = (file, success) => {
        allSuccess = allSuccess && success;
        if( success ) this.unsavedFiles.remove(file);

        filesRemaining--;
        if( filesRemaining == 0 ) {
            this.refreshUnsavedChanges();

            if( allSuccess )
                InkProject.eventEmitter.emit("didSave");

            this.saveActive = false;
            if( afterSaveCallback )
                afterSaveCallback(allSuccess);
        }
    }

    // Save main ink to ensure the other files have a base directory path
    this.mainInk.save(success => {
        singleFileSaveComplete(this.mainInk, success);

        ipcRenderer.send("main-file-saved", this.mainInk.absolutePath());

        // May not be a success if cancelled, in which case we stop early
        if( success ) {

            if( wasUnsaved ) this.startFileWatching();

            includeFiles.forEach(f => f.save(success => singleFileSaveComplete(f, success)));
        } 
        
        // Cancel the save process because main ink file save failed
        else {
            this.saveActive = false;
        }
    });
}

// Helper to copy a file whilst optionally transforming the content
function copyFile(source, destination, transform) {
    fs.readFile(source, "utf8", (err, fileContent) => {
        if( err ) {
            console.error(`Failed to read file '${source}':`, err);
            alert(`${i18n._("Failed to read file:")} '${source}' - ${err.message}`);
            return;
        }
        if( !fileContent ) {
            console.error(`File is empty: '${source}'`);
            alert(`${i18n._("Failed to copy file:")} '${source}' ${i18n._("is empty")}`);
            return;
        }
        if( transform ) fileContent = transform(fileContent);
        if( fileContent.length < 1 ) {
            console.error(`Transformed content is empty for: '${source}'`);
            alert(`${i18n._("Failed to copy file:")} transformed content is empty`);
            return;
        }
        
        fs.writeFile(destination, fileContent, "utf8", err => {
            if( err ) {
                console.error(`Failed to write file '${destination}':`, err);
                alert(`${i18n._("Failed to save file:")} '${destination}' - ${err.message}`);
            }
        });
    });
}

// exportType is "json", "web", or "js"
InkProject.prototype.export = function(exportType) {

    if( !this.ready ) {
        alert(i18n._("Project not quite fully loaded! Please try exporting again in a couple of seconds..."));
        return;
    }

    // Always start by building the JSON
    var inkJsCompatible = exportType == "js" || exportType == "web";
    LiveCompiler.exportJson(inkJsCompatible, (err, compiledJsonTempPath) => {
        if( err ) {
            alert(`${i18n._("Could not export:")} ${err}`);
            return;
        }

        if( !this.defaultExportPath && this.mainInk.absolutePath() ) {
            this.defaultExportPath = this.mainInk.absolutePath();
        }

        if( this.defaultExportPath ) {
            var pathObj = path.parse(this.defaultExportPath);
            if( exportType == "json" ) {
                pathObj.ext = ".json";
            } else if( exportType == "js" ) {
                // If we already have a default export path specifically for JS files
                // then we use that, otherwise let's use the standard JS naming scheme
                if( pathObj.ext != ".js" )
                    pathObj.base = path.basename(this.jsFilename());
                pathObj.ext = ".js";
            } else {
                // Strip existing extension
                pathObj.base = path.basename(pathObj.base, pathObj.ext);
                pathObj.ext = "";
            }

            this.defaultExportPath = path.format(pathObj);
        }

        var saveOptions = {
            defaultPath: this.defaultExportPath
        }

        if( exportType == "json" ) {
            saveOptions.filters = [
                { name: i18n._("JSON files"), extensions: ["json"] }
            ]
        } else if( exportType == "js" ) {
            saveOptions.filters = [
                { name: i18n._("JavaScript files"), extensions: ["js"] }
            ]
        }

        ipcRenderer.invoke('showSaveDialog', saveOptions).then((result) => {
            let targetSavePath = result.filePath;
            if( targetSavePath ) { 
                this.defaultExportPath = targetSavePath;
    
                // JSON export - simply move compiled json into place
                if( exportType == "json" || exportType == "js" ) {
                    fs.stat(targetSavePath, (err, stats) => {
    
                        if( err && err.code != "ENOENT" ) {
                            console.error("Error checking export path:", err);
                            alert(`${i18n._("Sorry, could not save to")} ${targetSavePath}: ${err.message}`);
                            return;
                        }
    
                        if( !err ) {
                            if( stats.isFile() ) {
                                try {
                                    fs.unlinkSync(targetSavePath);
                                } catch (unlinkErr) {
                                    console.error("Failed to remove existing file for export:", unlinkErr);
                                    alert(`${i18n._("Could not replace existing file:")} ${unlinkErr.message}`);
                                    return;
                                }
                            }
    
                            if( stats.isDirectory() ) {
                                alert(i18n._("Could not save because directory exists with the given name"));
                                return
                            }
                        }
    
                        // JS file: 
                        if( exportType == "js" ) {
                            this.convertJSONToJS(compiledJsonTempPath, targetSavePath);
                        } 
    
                        // JSON: Just copy into p
                        else {
                            copyFile(compiledJsonTempPath, targetSavePath);
                        }
    
                    });
                }
    
                // Web export
                else {
                    this.buildForWeb(compiledJsonTempPath, targetSavePath);
                }
            }
        });

    });
}

InkProject.prototype.exportJson = function() {
    this.export("json");
}

InkProject.prototype.exportForWeb = function() {
    this.export("web");
}

InkProject.prototype.exportJSOnly = function() {
    this.export("js");
}

InkProject.prototype.jsFilename = function() {
    // Derive story content js file from root ink filename
    // Remove .ink extension if it's ".ink"
    var mainInkRootName = this.mainInk.filename();
    if( path.extname(mainInkRootName) == ".ink" )
        mainInkRootName = path.basename(mainInkRootName, ".ink");
    var jsContentFilename = mainInkRootName+".js";

    // Avoid naming collision with our own main.js
    // (if user chose "main.ink" for their root ink)
    if( jsContentFilename == "main.js" ) {
        jsContentFilename = "story.js";
    }

    return jsContentFilename;
}

// Convert JSON to JS file with "var storyContent = "
InkProject.prototype.convertJSONToJS = function(jsonFilePath, targetJSPath) {
    copyFile(jsonFilePath, targetJSPath, (jsonContent) => {
        return `var storyContent = ${jsonContent};`;
    });
}

InkProject.prototype.buildForWeb = function(jsonFilePath, targetDirectory) {

    var templateDir = path.join(__dirname, "../export-for-web-template");

    // Derive story title from save name
    var storyTitle = path.basename(targetDirectory);
    
    // Unless the writer explicitly provided a tag with the title
    var mainInkTagDict = this.mainInk.symbols.globalDictionaryStyleTags;
    if( mainInkTagDict && mainInkTagDict["title"] ) {
        storyTitle = mainInkTagDict["title"];
    }

    try {
        mkdirp.sync(targetDirectory);
    } catch (mkdirErr) {
        console.error("Failed to create export directory:", mkdirErr);
        alert(`${i18n._("Could not create export directory:")} ${mkdirErr.message}`);
        return;
    }

    // Create JS story file with correct name
    var jsFullPath = path.join(targetDirectory, this.jsFilename());
    this.convertJSONToJS(jsonFilePath, jsFullPath);

    // Copy index.html:
    //  - inserting the filename as the <title> and <h1>
    //  - Inserting the correct name of the javascript file
    copyFile(path.join(templateDir, "index.html"), 
             path.join(targetDirectory, "index.html"), 
             (fileContent) => {
        fileContent = fileContent.replace(/##STORY TITLE##/g, storyTitle);
        fileContent = fileContent.replace(/##JAVASCRIPT FILENAME##/g, this.jsFilename());
        return fileContent;
    });

    // Copy other files verbatim
    copyFile(path.join(__dirname, "../node_modules/inkjs/dist/ink.js"),
             path.join(targetDirectory, "ink.js"));

    copyFile(path.join(templateDir, "style.css"), 
             path.join(targetDirectory, "style.css"));

    copyFile(path.join(templateDir, "main.js"), 
         path.join(targetDirectory, "main.js"));
}

InkProject.prototype.tryClose = function() {
    if( this.hasUnsavedChanges ) {
        this.showSaveDialog();
    }
    // Nothing to save, just exit
    else {
        this.closeImmediate();
    }
}

InkProject.prototype.showSaveDialog = function() {
    var self = this;
    var overlay = document.getElementById('save-dialog-overlay');
    overlay.classList.remove('hidden');

    function handleKeyDown(e) {
        if( (e.metaKey || e.ctrlKey) && e.key === 'd' ) {
            e.preventDefault();
            cleanup();
            self.closeImmediate();
        }
        if( e.key === 'Escape' ) {
            e.preventDefault();
            cleanup();
            ipcRenderer.send("project-cancelled-close");
        }
    }

    function cleanup() {
        document.removeEventListener('keydown', handleKeyDown);
        overlay.classList.add('hidden');
        overlay.querySelector('.save-dialog-save').removeEventListener('click', onSave);
        overlay.querySelector('.save-dialog-dont-save').removeEventListener('click', onDontSave);
        overlay.querySelector('.save-dialog-cancel').removeEventListener('click', onCancel);
    }

    function onSave() {
        cleanup();
        self.save(function() {
            self.closeImmediate();
        });
    }

    function onDontSave() {
        cleanup();
        self.closeImmediate();
    }

    function onCancel() {
        cleanup();
        ipcRenderer.send("project-cancelled-close");
    }

    document.addEventListener('keydown', handleKeyDown);
    overlay.querySelector('.save-dialog-save').addEventListener('click', onSave);
    overlay.querySelector('.save-dialog-dont-save').addEventListener('click', onDontSave);
    overlay.querySelector('.save-dialog-cancel').addEventListener('click', onCancel);
}

// Response from the close menu


InkProject.prototype.closeImmediate = function() {
    ipcRenderer.send("project-final-close");
}

InkProject.prototype.getIncludedFilesFor = function(inkFile) {
    return _.map(inkFile.includes, relPath => this.inkFileWithRelativePath(relPath)).filter(f => !!f);
}

InkProject.prototype.buildIncludeHierarchy = function() {
    var hierarchy = {};
    this.files.forEach(f => {
        hierarchy[f.id] = this.getIncludedFilesFor(f);
    });
    return hierarchy;
}

InkProject.prototype.inkFileWithRelativePath = function(relativePath) {
    var result = _.find(this.files, f => f.relPath.replace('\\', '/') == relativePath);
    debugTrace("inkProject.inkFileWithRelativePath", relativePath, "found:", !!result);
    return result;
}

InkProject.prototype.inkFileWithAbsolutePath = function(absPath) {
    if( !this.mainInk || !this.mainInk.projectDir ) return null;
    var result = _.find(this.files, f => {
        let fileAbsPath = f.absolutePath();
        return fileAbsPath && path.resolve(fileAbsPath) === path.resolve(absPath);
    });
    debugTrace("inkProject.inkFileWithAbsolutePath", absPath, "found:", !!result);
    return result;
}

InkProject.prototype.inkFileWithId = function(id) {
    var result = _.find(this.files, f => f.id == id);
    debugTrace("inkProject.inkFileWithId", id, "found:", !!result);
    return result;
}

InkProject.prototype.deleteInkFile = function(inkFile) {

    if( this.activeInkFile == inkFile )
        this.showInkFile(this.mainInk);

    LiveCompiler.removeTempFile(inkFile.relPath);

    inkFile.deleteFromDisk();

    this.files.remove(inkFile);

    NavView.setFiles(this.mainInk, this.files, this.buildIncludeHierarchy());
    EditorView.setFiles(this.files);
}

InkProject.prototype.renameInkFile = function(inkFile, newRelPath) {
    var oldRelPath = inkFile.relPath;
    var oldFilename = inkFile.filename();
    inkFile.rename(newRelPath);

    this.files.forEach(f => {
        if( f !== inkFile ) {
            f.replaceIncludeInDocument(oldRelPath, newRelPath);
            f.includes = f.includes.map(inc => inc === oldRelPath ? newRelPath : inc);
        }
    });

    this.sortFileList();
    this.refreshIncludes();
    NavView.setFiles(this.mainInk, this.files, this.buildIncludeHierarchy());
    EditorView.setFiles(this.files);
}

InkProject.prototype.deleteInkFileWithIncludes = function(inkFile) {
    this.files.forEach(f => {
        if( f !== inkFile ) {
            f.replaceIncludeInDocument(inkFile.relPath, "");
        }
    });

    this.deleteInkFile(inkFile);
}

InkProject.prototype.moveInclude = function(fileId, newParentId) {
    var draggedFile = this.inkFileWithId(fileId);
    if( !draggedFile || draggedFile === this.mainInk ) return false;

    var findCurrentParent = (file) => {
        for( var i = 0; i < this.files.length; i++ ) {
            if( this.files[i].includes.indexOf(file.relPath) !== -1 )
                return this.files[i];
        }
        return null;
    };

    var currentParent = findCurrentParent(draggedFile);

    if( newParentId === null ) {
        if( currentParent ) currentParent.removeIncludeLine(draggedFile.relPath);
        this.refreshIncludes();
        return true;
    }

    var newParent = this.inkFileWithId(newParentId);
    if( !newParent || newParent === draggedFile ) return false;

    var wouldCauseCircular = false;
    var checkFile = newParent;
    while( checkFile ) {
        if( checkFile === draggedFile ) { wouldCauseCircular = true; break; }
        checkFile = findCurrentParent(checkFile);
    }
    if( wouldCauseCircular ) return false;

    if( currentParent === newParent ) return false;

    if( currentParent ) currentParent.removeIncludeLine(draggedFile.relPath);
    newParent.addIncludeLine(draggedFile.relPath);

    this.sortFileList();
    this.refreshIncludes();
    return true;
}

InkProject.prototype.findSymbol = function(name, posContext) {

    // Name components
    var nameComps = name.split(".");
    var baseName = nameComps[0];
    var tailNameComps = nameComps.slice(1);

    // Find starting symbol based on the context
    var symbolContext = this.activeInkFile.symbols.symbolAtPos(posContext);

    // Helper function to search downward into a symbol to find a single name
    function findWithinSymbolDeep(withinSymbol, targetName) {
        if( withinSymbol.innerSymbols ) {
            var foundSym = withinSymbol.innerSymbols[targetName];
            if( foundSym ) {
                return foundSym;
            } else {
                for(var innerSymName in withinSymbol.innerSymbols) {
                    foundSym = findWithinSymbolDeep(withinSymbol.innerSymbols[innerSymName])
                    if( foundSym )
                        return foundSym;
                }
            }
        }
    }

    // Try searching towards leaves first
    var baseSymbol = findWithinSymbolDeep(symbolContext, baseName);

    // Otherwise, work our way up to a broader and broader scope to
    // find the a symbol that contains the base name we're looking for
    if( !baseSymbol ) {
        while(symbolContext) {
            if( symbolContext.innerSymbols ) {
                var found = symbolContext.innerSymbols[baseName];
                if( found ) {
                    baseSymbol = found;
                    break;
                }
            }
            symbolContext = symbolContext.parent;
        }
    }

    // Finally, try to search within all files scope
    if( !baseSymbol ) {

        // Collect all symbols
        var allSymbols = {};
        for(var i=0; i<this.files.length; i++) {
            var file = this.files[i];
            var fileSymbols = file.symbols.getSymbols();
            var found = fileSymbols[baseName];
            if( found ) {
                baseSymbol = found;
                break;
            }
        }
    }
    
    if( !baseSymbol ) {
        console.log("Failed to find base symbol: "+baseName);
        return null;
    }

    // Resolve the rest of the path
    var symbol = baseSymbol;
    for(var i=0; i<tailNameComps.length; i++) {
        var tailComp = tailNameComps[i];
        var tailSymbol = findWithinSymbolDeep(symbol, tailComp);
        if( !tailSymbol ) {
            console.log("Failed to find complete path due to not finding: "+tailComp);
            return symbol;
        }
        
        symbol = tailSymbol;
    }

    console.log("Found "+symbol.name);
    return symbol;
}


InkProject.prototype.refreshProjectSettings = function(newProjectSettings) {
    if( this.instructionPrefix != newProjectSettings.instructionPrefix ) {
        this.instructionPrefix = newProjectSettings.instructionPrefix;

        PlayerView.setInstructionPrefix(this.instructionPrefix);
        
        // Refresh the InkMode, which affects syntax highlighting.
        // This allows users to customise the "instructionPrefix", which
        // is the game-specific convension to use something like ">>> CAMERA: Wide angle"
        this.inkMode = new InkMode(this.instructionPrefix);

        for(let inkFile of this.files) {
            inkFile.setInkMode(this.inkMode);
        }
    }
}


InkProject.setEvents = function(e) {
    for (const [key, handler] of Object.entries(e)) {
        InkProject.eventEmitter.on(key, handler);
    }
}

InkProject.startNew = function() {
    InkProject.setProject(new InkProject());
}

InkProject.loadProject = function(mainInkPath) {
    InkProject.setProject(new InkProject(mainInkPath));
}

InkProject.setProject = function(project) {
    InkProject.currentProject = project;
    InkProject.eventEmitter.emit("newProject", project);
    project.sendProjectState();
}

ipcRenderer.on("set-project-main-ink-filepath", (event, filePath) => {
    InkProject.loadProject(filePath);
});

ipcRenderer.on("open-main-ink", (event) => {
    if( InkProject.currentProject ) {
        InkProject.currentProject.showInkFile(InkProject.currentProject.mainInk);
    }
});

ipcRenderer.on("open-ink-file-by-path", (event, absPath) => {
    if( !InkProject.currentProject ) return;
    let inkFile = InkProject.currentProject.inkFileWithAbsolutePath(absPath);
    if( inkFile ) {
        InkProject.currentProject.showInkFile(inkFile);
    }
});

ipcRenderer.on("project-new-include", () => {
    if( InkProject.currentProject ) {
        NavView.show();
        NavView.showAddIncludeForm();
    }
});

ipcRenderer.on("project-save", (event) => {
    if( InkProject.currentProject ) {
        InkProject.currentProject.save();
    }
});

ipcRenderer.on("project-export", (event) => {
    if( InkProject.currentProject ) {
        InkProject.currentProject.exportJson();
    }
});

ipcRenderer.on("project-export-for-web", (event) => {
    if( InkProject.currentProject ) {
        InkProject.currentProject.exportForWeb();
    }
});

ipcRenderer.on("project-export-js-only", (event) => {
    if( InkProject.currentProject ) {
        InkProject.currentProject.exportJSOnly();
    }
});

ipcRenderer.on("project-tryClose", (event) => {
    if( InkProject.currentProject ) {
        InkProject.currentProject.tryClose();
    }
});

ipcRenderer.on("project-settings-changed", (event, settings) => {
    if( InkProject.currentProject ) {
        InkProject.currentProject.refreshProjectSettings(settings);
    }
});

NavView.on("renameFileId", (fileId) => {
    NavView.startRenameFile(fileId);
});

NavView.on("deleteFileId", (fileId) => {
    if( !InkProject.currentProject ) return;
    var inkFile = InkProject.currentProject.inkFileWithId(fileId);
    if( inkFile && inkFile != InkProject.currentProject.mainInk ) {
        InkProject.currentProject.deleteInkFileWithIncludes(inkFile);
    }
});

NavView.on("moveInclude", (fileId, targetId) => {
    if( !InkProject.currentProject ) return;
    InkProject.currentProject.moveInclude(fileId, targetId);
});

NavView.on("renameFileConfirmed", (fileId, newName) => {
    if( !InkProject.currentProject ) return;
    var inkFile = InkProject.currentProject.inkFileWithId(fileId);
    if( !inkFile ) return;

    var oldDir = path.dirname(inkFile.relPath);
    var newRelPath = oldDir === "." ? newName : path.join(oldDir, newName);

    var alreadyExists = _.some(InkProject.currentProject.files, f => f.relPath === newRelPath && f !== inkFile);
    if( alreadyExists ) {
        alert(`A file named "${newName}" already exists.`);
        return;
    }

    var mainInk = InkProject.currentProject.mainInk;
    var oldAbsPath = inkFile.absolutePath();
    var newAbsPath = path.join(mainInk.projectDir, newRelPath);

    fs.rename(oldAbsPath, newAbsPath, (err) => {
        if( err ) {
            alert(`Failed to rename file: ${err.message}`);
            return;
        }
        InkProject.currentProject.renameInkFile(inkFile, newRelPath);
    });
});

ipcRenderer.on("project-rename-file", (event) => {
    if( InkProject.currentProject && InkProject.currentProject.activeInkFile ) {
        var activeFile = InkProject.currentProject.activeInkFile;
        if( activeFile != InkProject.currentProject.mainInk ) {
            NavView.startRenameFile(activeFile.id);
        }
    }
});

ipcRenderer.on("project-delete-file", (event) => {
    if( InkProject.currentProject && InkProject.currentProject.activeInkFile ) {
        var activeFile = InkProject.currentProject.activeInkFile;
        if( activeFile != InkProject.currentProject.mainInk ) {
            InkProject.currentProject.deleteInkFileWithIncludes(activeFile);
        }
    }
});


exports.InkProject = InkProject;