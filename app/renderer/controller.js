const electron = require("electron");
const ipc = electron.ipcRenderer;

const path = require("path");
const $ = window.jQuery = require('./jquery-2.2.3.min.js');

// Debug
const loadTestInk = false;
//remote.getCurrentWindow().webContents.openDevTools();

const { debug, debugError, debugTrace, DEBUG_ENABLED } = require("./debug.js");

// Helpers in global objects and namespace

require("./util.js");
require("./split.js");

// Set up context menu
require("./contextmenu.js");

const EditorView = require("./editorView.js").EditorView;
const PlayerView = require("./playerView.js").PlayerView;
const ToolbarView = require("./toolbarView.js").ToolbarView;
const NavView = require("./navView.js").NavView;
const ExpressionWatchView = require("./expressionWatchView").ExpressionWatchView;
const LiveCompiler = require("./liveCompiler.js").LiveCompiler;
const InkProject = require("./inkProject.js").InkProject;
const NavHistory = require("./navHistory.js").NavHistory;
const GotoAnything = require("./goto.js").GotoAnything;
const FindInProject = require("./findInProject.js").FindInProject;
const i18n = require("./i18n.js");

window.InkProject = InkProject;

if (DEBUG_ENABLED) {
    debug("Debug mode enabled");
}

InkProject.eventEmitter.on("newProject", (project) => {
    debugTrace("InkProject.newProject", project);
    EditorView.focus();
    LiveCompiler.setProject(project);
    var filename = project.activeInkFile.filename();
    ToolbarView.setTitle(filename);
    NavView.setMainInkFilename(filename);
    NavHistory.reset();
    NavHistory.addStep();
    ipc.send("update-current-filename", filename);
});
InkProject.eventEmitter.on("didSave", () => {
    debugTrace("InkProject.didSave");
    var activeInk = InkProject.currentProject.activeInkFile;
    ToolbarView.setTitle(activeInk.filename());
    NavView.setMainInkFilename(InkProject.currentProject.mainInk.filename());
    NavView.highlightRelativePath(activeInk.relPath);
    ipc.send("update-current-filename", activeInk.filename());
});
InkProject.eventEmitter.on("didSwitchToInkFile", (inkFile) => {
    debugTrace("InkProject.didSwitchToInkFile", inkFile.filename());
    var filename = inkFile.filename();
    ToolbarView.setTitle(filename);
    NavView.highlightRelativePath(inkFile.relPath);
    NavView.setKnots(inkFile);
    var fileIssues = LiveCompiler.getIssuesForFilename(inkFile.relPath);
    setImmediate(() => EditorView.setErrors(fileIssues));
    NavView.updateCurrentKnot(inkFile, EditorView.getCurrentCursorPos());
    NavHistory.addStep();
    ipc.send("update-current-filename", filename);
});

// Wait for DOM to be ready before kicking most stuff off
// (some of the views get confused otherwise)
$(document).ready(() => {
    debugTrace("document.ready");
    if( InkProject.currentProject == null ) {
        debug("Starting new project");
        InkProject.startNew();
        // Debug
        if( loadTestInk ) {
            var testInk = require("fs").readFileSync(path.join(__dirname, "test.ink"), "utf8");
            InkProject.currentProject.mainInk.setValue(testInk);
        }
        NavView.setKnots(InkProject.currentProject.mainInk);
    }
});

function gotoIssue(issue) {
    debugTrace("gotoIssue", issue.filename, issue.lineNumber);
    InkProject.currentProject.showInkFile(issue.filename);
    EditorView.gotoLine(issue.lineNumber);
    NavHistory.addStep();
}

NavHistory.on("goto", (location) => {
    debugTrace("NavHistory.goto", location);
    InkProject.currentProject.showInkFile(location.filePath);
    EditorView.gotoLine(location.position.row+1);
});


LiveCompiler.on("resetting", (sessionId) => {
    debugTrace("LiveCompiler.resetting", sessionId);
});
LiveCompiler.on("compileComplete", (sessionId) => {
    debugTrace("LiveCompiler.compileComplete", sessionId);
    PlayerView.prepareForNewPlaythrough(sessionId);
    EditorView.clearErrors();
    ToolbarView.clearIssueSummary();
    NavView.setErrorFiles([]);
});
LiveCompiler.on("selectIssue", gotoIssue);
LiveCompiler.on("textAdded", (text) => {
    debugTrace("LiveCompiler.textAdded", text);
    PlayerView.addTextSection(text);
});
LiveCompiler.on("tagsAdded", (tags) => {
    debugTrace("LiveCompiler.tagsAdded", tags);
    PlayerView.addTags(tags);
});
LiveCompiler.on("choiceAdded", (choice, isLatestTurn) => {
    debugTrace("LiveCompiler.choiceAdded", choice, isLatestTurn);
    if( isLatestTurn ) {
        PlayerView.addChoice(choice, () => {
            LiveCompiler.choose(choice)
        });
    }
});
LiveCompiler.on("errorsAdded", (errors) => {
    debugTrace("LiveCompiler.errorsAdded", errors.length, "errors");
    var errorFileSet = new Set();
    for(var i=0; i<errors.length; i++) {
        var error = errors[i];
        if( error.filename == InkProject.currentProject.activeInkFile.relPath )
            EditorView.addError(error);

        if( error.type == "RUNTIME ERROR" || error.type == "RUNTIME WARNING" )
            PlayerView.addLineError(error, () => gotoIssue(error));

        if( error.filename )
            errorFileSet.add(error.filename);
    }

    NavView.setErrorFiles(Array.from(errorFileSet));
    ToolbarView.updateIssueSummary(errors);
});
LiveCompiler.on("playerPrompt", (replaying, doneCallback) => {
    debugTrace("LiveCompiler.playerPrompt", "replaying:", replaying);

    var expressionIdx = 0;
    var tryEvaluateNextExpression = () => {

        // Finished evaluating expressions? End of this turn.
        if( expressionIdx >= ExpressionWatchView.numberOfExpressions() ) {
            if( replaying ) {
                PlayerView.addHorizontalDivider();
            } else {
                PlayerView.contentReady();
            }
            doneCallback();
            return;
        }

        // Try to evaluate this expression
        var exprText = ExpressionWatchView.getExpression(expressionIdx);
        LiveCompiler.evaluateExpression(exprText, (result, error) => {
            PlayerView.addEvaluationResult(result, error);
            expressionIdx++;
            tryEvaluateNextExpression();
        });
    };

    tryEvaluateNextExpression();
});
LiveCompiler.on("replayComplete", (sessionId) => {
    debugTrace("LiveCompiler.replayComplete", sessionId);
    PlayerView.showSessionView(sessionId);
});
LiveCompiler.on("storyCompleted", () => {
    debugTrace("LiveCompiler.storyCompleted");
    PlayerView.addTerminatingMessage(i18n._("End of story"), "end");
});
LiveCompiler.on("exitDueToError", () => {
    debugTrace("LiveCompiler.exitDueToError");
    // No need to do anything - errors themselves being displayed are enough
});
LiveCompiler.on("unexpectedError", (error) => {
    debugTrace("LiveCompiler.unexpectedError", error);
    if( error.indexOf("Unhandled Exception") != -1 ) {
        PlayerView.addTerminatingMessage(i18n._("Sorry, the ink compiler crashed ☹"), "error");
        PlayerView.addTerminatingMessage(i18n._("Here is some diagnostic information:"), "error");

        // Make it a bit less verbose and concentrate on the useful stuff
        // [0x000ea] in /Users/blah/blah/blah/blah/ink/ParsedHierarchy/FlowBase.cs:377
        // After replacement:
        // in FlowBase.cs line 377
        error = error.replace(/\[\w+\] in (?:[\w/]+?)(\w+\.cs):(\d+)/g, "in $1 line $2");

        PlayerView.addLongMessage(error, "diagnostic");
    } else {
        PlayerView.addTerminatingMessage(i18n._("Ink compiler had an unexpected error ☹"), "error");
        PlayerView.addLongMessage(error, "error");
    }
});
LiveCompiler.on("compilerBusyChanged", (busy) => {
    debugTrace("LiveCompiler.compilerBusyChanged", busy);
    ToolbarView.setBusySpinnerVisible(busy);
});
LiveCompiler.on("pauseChanged", (paused) => {
    debugTrace("LiveCompiler.pauseChanged", paused);
    ToolbarView.setPauseActive(paused);
    ipc.send("pause-changed", paused);
});

ipc.on("project-stats", (event, visible) => {
    LiveCompiler.getStats((statsObj) => {
        
        let messageLines = [];
        messageLines.push(i18n._("Project statistics:"));
        messageLines.push("");
        
        messageLines.push(`${i18n._("Words")}: ${statsObj["words"]}`);
        messageLines.push("");

        messageLines.push(`${i18n._("Knots")}: ${statsObj["knots"]}`);
        messageLines.push(`${i18n._("Stitches")}: ${statsObj["stitches"]}`);
        messageLines.push(`${i18n._("Functions")}: ${statsObj["functions"]}`);
        messageLines.push("");

        messageLines.push(`${i18n._("Choices")}: ${statsObj["choices"]}`);
        messageLines.push(`${i18n._("Gathers")}: ${statsObj["gathers"]}`);
        messageLines.push(`${i18n._("Diverts")}: ${statsObj["diverts"]}`);
        messageLines.push("");

        messageLines.push(i18n._("Notes: Words should be accurate. Knots include functions. Gathers and diverts may include some implicitly added ones by the compiler, for example in weave. Diverts include END and DONE."));

        alert(messageLines.join("\n"));
    });
});

ipc.on("keyboard-shortcuts", (event, visible) => {
    let messageLines = [];
    messageLines.push(i18n._("Useful Keyboard Shortcuts"));
    messageLines.push("");
    messageLines.push(`${i18n._("Find and Replace")}: Ctrl+H ${i18n._("or")} Cmd+H`);
    messageLines.push("");
    messageLines.push(`${i18n._("Find")}: Ctrl+F ${i18n._("or")} Cmd+F`);
    messageLines.push("");
    messageLines.push(`${i18n._("Go to Anything")}: Ctrl+P ${i18n._("or")} Cmd+P`);
    messageLines.push("");
    messageLines.push(`${i18n._("Toggle Comment")}: Ctrl+/ ${i18n._("or")} Cmd+/`);
    messageLines.push("");
    messageLines.push(`${i18n._("Add Multicursor Above")}: Ctrl+Alt+Up ${i18n._("or")} Ctrl+Option+Up`);
    messageLines.push("");
    messageLines.push(`${i18n._("Add Multicursor Below")}: Ctrl+Alt+Down ${i18n._("or")} Ctrl+Option+Down`);
    messageLines.push("");
    messageLines.push(`${i18n._("Temporarily Fold/Unfold Selection")}: Alt+L ${i18n._("or")} Ctrl+Option+Down`);
    messageLines.push("");
    alert(messageLines.join("\n"));
});


EditorView.on("change", () => {
    debugTrace("EditorView.change");
    LiveCompiler.setEdited();
    if( InkProject.currentProject && InkProject.currentProject.activeInkFile )
        NavView.setKnotsDebounced(InkProject.currentProject.activeInkFile);
});
EditorView.on("jumpToSymbol", (symbolName, contextPos) => {
    debugTrace("EditorView.jumpToSymbol", symbolName, contextPos);
    var foundSymbol = InkProject.currentProject.findSymbol(symbolName, contextPos);
    if( foundSymbol ) {
        InkProject.currentProject.showInkFile(foundSymbol.inkFile);
        EditorView.gotoLine(foundSymbol.row+1, foundSymbol.column);
        NavHistory.addStep();
    }
});
EditorView.on("jumpToInclude", (includePath) => {
    debugTrace("EditorView.jumpToInclude", includePath);
    InkProject.currentProject.showInkFile(includePath);
    NavHistory.addStep();
});
EditorView.on("navigate", () => {
    debugTrace("EditorView.navigate");
    NavHistory.addStep();
});
EditorView.on("changedLine", (pos) =>{
    debugTrace("EditorView.changedLine", pos);
    if (InkProject.currentProject && InkProject.currentProject.activeInkFile){
        NavView.updateCurrentKnot(InkProject.currentProject.activeInkFile, pos);
    }
});

PlayerView.on("jumpToSource", (outputTextOffset) => {
    debugTrace("PlayerView.jumpToSource", outputTextOffset);
    LiveCompiler.getLocationInSource(outputTextOffset, (result) => {
        if( result && result.filename && result.lineNumber ) {
            InkProject.currentProject.showInkFile(result.filename);
            EditorView.gotoLine(result.lineNumber);
        }
    });
});

PlayerView.on("stepBackToTurn", (turnIdx) => {
    debugTrace("PlayerView.stepBackToTurn", turnIdx);
    PlayerView.previewStepBackToTurn(turnIdx);
    LiveCompiler.stepBackToTurn(turnIdx);
});

ExpressionWatchView.eventEmitter.on("change", () => {
    debugTrace("ExpressionWatchView.change");
    LiveCompiler.setEdited();
    $("#player .scrollContainer").css("top", ExpressionWatchView.totalHeight()+"px");
});

ExpressionWatchView.eventEmitter.on("queryVariable", (varName) => {
    debugTrace("ExpressionWatchView.queryVariable", varName);
    // Reload the story to get it into a clean state (not waiting for a choice)
    LiveCompiler.reload();
    LiveCompiler.once("replayComplete", () => {
        LiveCompiler.evaluateExpression(varName, (result, error) => {
            if( error ) {
                ExpressionWatchView.showVariableResult("Error: " + error);
            } else {
                ExpressionWatchView.showVariableResult(varName + " = " + result);
            }
        });
    });
});

ExpressionWatchView.eventEmitter.on("listVariables", () => {
    debugTrace("ExpressionWatchView.listVariables");
    
    // Get all variables from all files
    const inkCompleter = require("./inkCompleter.js").inkCompleter;
    
    const allVariables = new Set();
    inkCompleter.inkFiles.forEach(file => {
        try {
            file.symbols.parse();
            const vars = file.symbols.getCachedVariables();
            vars.forEach(v => allVariables.add(v));
        } catch(e) {
        }
    });
    
    if (allVariables.size === 0) {
        ExpressionWatchView.showVariableResult("No variables found in the project.");
        return;
    }
    
    // Reload the story to get it into a clean state (not waiting for a choice)
    LiveCompiler.reload();
    
    // Wait for the reload to complete, then query variables
    LiveCompiler.once("replayComplete", () => {
        // Query each variable sequentially and collect results
        const results = [];
        const varArray = Array.from(allVariables).sort();
        
        function queryNext(index) {
            if (index >= varArray.length) {
                ExpressionWatchView.showVariableResult(results.join("\n"));
                return;
            }
            
            const varName = varArray[index];
            
            let completed = false;
            const timeout = setTimeout(() => {
                if (!completed) {
                    results.push(`${varName} = <timeout>`);
                    queryNext(index + 1);
                }
            }, 2000);
            
            LiveCompiler.evaluateExpression(varName, (result, error) => {
                completed = true;
                clearTimeout(timeout);
                if (error) {
                    results.push(`${varName} = <error: ${error}>`);
                } else {
                    results.push(`${varName} = ${result}`);
                }
                queryNext(index + 1);
            });
        }
        
        queryNext(0);
    });
});

ToolbarView.on("toggleSidebar", (id, buttonId) => {
    debugTrace("ToolbarView.toggleSidebar", id, buttonId);
    NavView.toggle(id, buttonId);
});
ToolbarView.on("navigateBack", () => {
    debugTrace("ToolbarView.navigateBack");
    NavHistory.back();
});
ToolbarView.on("navigateForward", () => {
    debugTrace("ToolbarView.navigateForward");
    NavHistory.forward();
});
ToolbarView.on("selectIssue", gotoIssue);
ToolbarView.on("stepBack", () => {
    debugTrace("ToolbarView.stepBack");
    PlayerView.previewStepBack();
    LiveCompiler.stepBack();
});
ToolbarView.on("jumpToPath", (path) => {
    debugTrace("ToolbarView.jumpToPath", path);
    LiveCompiler.jumpToPath(path, (result) => {
        if( result ) {
            PlayerView.addTextSection(result);
        }
    });
});
ToolbarView.on("rewind", () => {
    debugTrace("ToolbarView.rewind");
    if ($("#main").hasClass("json-playback")) {
        PlayerView.restartJsonStory();
    } else {
        LiveCompiler.rewind();
    }
});
ToolbarView.on("togglePause", () => {
    debugTrace("ToolbarView.togglePause");
    LiveCompiler.togglePause();
});
ToolbarView.on("didSetTitle", (title) => {
    debugTrace("ToolbarView.didSetTitle", title);
    if( process.platform == "win32" ) {
        ipc.send("set-native-window-title", title);
    }
});

NavView.on("clickFileId", (fileId) => {
    debugTrace("NavView.clickFileId", fileId);
    var inkFile = InkProject.currentProject.inkFileWithId(fileId);
    if( !inkFile ) {
        debugError("NavView.clickFileId: inkFile not found for id", fileId);
        return;
    }
    debug("NavView.clickFileId: switching to", inkFile.filename());
    InkProject.currentProject.showInkFile(inkFile);
    NavHistory.addStep();
});
NavView.on("addInclude", (filename, addToMainInk, callback) => {
    debugTrace("NavView.addInclude", filename, addToMainInk);

    // Force filename to have .ink on the end if it hasn't been done manually by user
    // (Is there ever a scenario where this isn't wanted?)
    // Note that if they write my_file.txt then it will turn into my_file.txt.ink
    if( path.extname(filename) != ".ink" ) filename += ".ink";

    var newInkFile = InkProject.currentProject.addNewInclude(filename, addToMainInk);
    if( newInkFile ) {
        InkProject.currentProject.showInkFile(newInkFile);
        NavHistory.addStep();
        callback(true);
    } else {
        callback(false);
    }
});
NavView.on("jumpToRow", (row) => {
    debugTrace("NavView.jumpToRow", row);
    EditorView.gotoLine(row+1);
});

GotoAnything.on("gotoFile", (file, row) => {
    debugTrace("GotoAnything.gotoFile", file, row);
    InkProject.currentProject.showInkFile(file);
    if( typeof row !== 'undefined' )
        EditorView.gotoLine(row+1);
    NavHistory.addStep();
});
GotoAnything.on("lookupRuntimePath", (path, resultHandler) => {
    debugTrace("GotoAnything.lookupRuntimePath", path);
    LiveCompiler.getRuntimePathInSource(path, resultHandler);
});

ipc.on("set-tags-visible", (event, visible) => {
    debugTrace("ipc.set-tags-visible", visible);
    if( visible )
        $("#main").removeClass("hideTags");
    else
        $("#main").addClass("hideTags");
});

ipc.on("set-animation-enabled", (event, animationEnabled) => {
    debugTrace("ipc.set-animation-enabled", animationEnabled);
    PlayerView.setAnimationEnabled(animationEnabled)
});
ipc.on("set-autocomplete-disabled", (event, autoCompleteDisabled) => {
    debugTrace("ipc.set-autocomplete-disabled", autoCompleteDisabled);
    EditorView.setAutoCompleteDisabled(autoCompleteDisabled)
});

ipc.on("toggle-editor", (event, visible) => {
    debugTrace("ipc.toggle-editor", visible);
    if( visible ) {
        $("#main").removeClass("editor-hidden");
        $("#main").removeClass("player-only");
    } else {
        // Don't hide if player is also hidden
        if( !$("#main").hasClass("player-hidden") ) {
            $("#main").addClass("editor-hidden");
            $("#main").addClass("player-only");
        }
    }
    EditorView.resize();
});

ipc.on("toggle-player", (event, visible) => {
    debugTrace("ipc.toggle-player", visible);
    if( visible ) {
        $("#main").removeClass("player-hidden");
        $("#main").removeClass("editor-only");
    } else {
        // Don't hide if editor is also hidden
        if( !$("#main").hasClass("editor-hidden") ) {
            $("#main").addClass("player-hidden");
            $("#main").addClass("editor-only");
        }
    }
    EditorView.resize();
});

ipc.on("toggle-pause", (event, paused) => {
    debugTrace("ipc.toggle-pause", paused);
    if( paused )
        LiveCompiler.pause();
    else
        LiveCompiler.unpause();
});

ipc.on("toggle-variable-query", (event, visible) => {
    debugTrace("ipc.toggle-variable-query", visible);
    if( visible )
        $(".variableQueryPanel").removeClass("hidden");
    else
        $(".variableQueryPanel").addClass("hidden");
});

$(window).on("resize", () => {
    EditorView.resize();
});



function updateTheme(event, newTheme) {
    let themes = ["dark", "contrast", "focus"];
    themes = themes.filter(e => e !== newTheme);
    if (newTheme && newTheme.toLowerCase() !== 'main')
    {
        $(".window").addClass(newTheme);
    }
    for (const theme of themes) {
        $(".window").removeClass(theme);
    }
    LiveCompiler.setEdited();
}

$(document).ready(() => {
    updateTheme(null, window.localStorage.getItem("theme"));
});
ipc.on("change-theme", (event, newTheme) => {
		updateTheme(event, newTheme);
    window.localStorage.setItem("theme", newTheme);
});



ipc.on("zoom", (event, amount) => {

    // Search manually for element by ID
    // (jQuery wrapping mutates attributes!)
    let editorEl = document.getElementById("editor");
    let playerEl = document.getElementById("player");

    let currentSize = editorEl.style.fontSize;
    
    if(amount > 2) {
        editorEl.style.fontSize = 12 * amount / 100 + "px";
        playerEl.style.fontSize = 14 * amount / 100 + "px";
    } else {

        if(currentSize == "") {

            if(amount > 0) {
                currentSize = "14";
            } else {
                currentSize = "10";
            }

        } else {

            currentSize = currentSize.substring(0, currentSize.length - 2);
            currentSize = parseInt(currentSize);
            currentSize += amount;
        }
        
        editorEl.style.fontSize = currentSize + "px";
        playerEl.style.fontSize = currentSize + "px";
    }

});

ipc.on("insertSnippet", (event, snippetContent) => {
    EditorView.insert(snippetContent);
});

ipc.on("open-json-file", (event, filePath) => {
    var fs = require("fs");
    var inkjs = require("inkjs");
    try {
        var jsonContent = fs.readFileSync(filePath, "utf8");
        var storyContent = JSON.parse(jsonContent);
        var story = new inkjs.Story(storyContent);
        enterJsonPlaybackMode(story, filePath);
    } catch (e) {
        console.error("Failed to load JSON story:", e);
        alert("Failed to load JSON story: " + e.message);
    }
});

function enterJsonPlaybackMode(story, filePath) {
    $("#main").addClass("json-playback");
    $("#main").addClass("editor-hidden");
    $("#main").addClass("player-only");
    $("#toolbar").addClass("json-playback");
    $(".sidebar").addClass("hidden");
    $(".expressionWatch").addClass("hidden");
    $(".variableQueryPanel").addClass("hidden");

    PlayerView.prepareForJsonPlayback(story, filePath);
}

// ---- Keyboard shortcut handlers ----

function cycleFile(direction) {
    debugTrace("cycleFile", direction);
    var project = InkProject.currentProject;
    if (!project) return;
    var files = project.files;
    if (files.length < 2) return;
    var currentIdx = files.indexOf(project.activeInkFile);
    if (currentIdx < 0) return;
    var newIdx = (currentIdx + direction + files.length) % files.length;
    project.showInkFile(files[newIdx]);
}

ipc.on("next-file", () => {
    debugTrace("ipc.next-file");
    cycleFile(1);
});
ipc.on("prev-file", () => {
    debugTrace("ipc.prev-file");
    cycleFile(-1);
});

ipc.on("navigate-back", () => {
    debugTrace("ipc.navigate-back");
    NavHistory.back();
});
ipc.on("navigate-forward", () => {
    debugTrace("ipc.navigate-forward");
    NavHistory.forward();
});

ipc.on("follow-symbol", () => {
    debugTrace("ipc.follow-symbol");
    EditorView.followSymbol();
});
