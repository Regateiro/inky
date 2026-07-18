const EventEmitter = require("events");
const ipc = require("electron").ipcRenderer;
const _ = require("lodash");
const randomstring = require("randomstring");
const i18n = require('./i18n.js');
const { debug, debugTrace, debugError } = require("./debug.js");

var namespace = null;
var sessionIdx = 0;

var currentPlaySessionId = null;
var currentExportSessionId = null;
var currentStatsSessionId = null;
var exportCompleteCallback = null;
var statsCompleteCallback = null;

var lastEditorChange = null;
var reloadPending = false;
var paused = false;
var compilePending = false;

var choiceSequence = [];
var currentTurnIdx = -1;
var replaying = false;

var issues = [];
var selectedIssueIdx = -1;

var locationInSourceCallbackObj = null;
var expressionEvaluationObj = null;
var variablesListCallbackObj = null;
var jumpToPathCallbackObj = null;

var project = null;

const LiveCompiler = new EventEmitter();

var compilerBusy = false;

function setProject(p) {
    debugTrace("liveCompiler.setProject", p.mainInk.filename());
    project = p;

    // Generate the namespace just once so it stays constant all the while the project/app is open
    // otherwise when the name changes, the temp folder could go out of sync
    var namespaceCode = randomstring.generate(7);
    namespace = project.mainInk.filename().replace(/\./g, "_") + "_" + namespaceCode;

    reloadPending = true;
}

function resetErrors() {
    issues = [];
    selectedIssueIdx = -1;
}

function buildCompileInstruction() {

    sessionIdx += 1;

    // Construct instruction object to send to inklecate.js
    var compileInstruction = {
        mainName: project.mainInk.filename(),
        updatedFiles: {},
        sessionId: `${namespace}_${sessionIdx}`,
        namespace: namespace
    };

    project.files.forEach((inkFile) => {
        // Add Ink Files with changes to be saved before the next compile
        // If we're running for the first time, add all because non of the files has been saved to tempInkPath
        if( inkFile.compilerVersionDirty ) {
            compileInstruction.updatedFiles[inkFile.relPath] = inkFile.getValue();
            inkFile.compilerVersionDirty = false;
        }
    });

    return compileInstruction;
}

function sessionIsCurrent(id) {
    return id == currentPlaySessionId || id == currentExportSessionId;
}

function updateCompilerIsBusy(isBusy) {
    if( isBusy != compilerBusy ) {
        compilerBusy = isBusy;
        LiveCompiler.emit("compilerBusyChanged", compilerBusy);
    }
}

function reloadInklecateSession() {
    debugTrace("liveCompiler.reloadInklecateSession");

    if( project == null || !project.ready ) {
        debug("liveCompiler.reloadInklecateSession: project not ready, setting reloadPending");
        reloadPending = true;
        updateCompilerIsBusy(true);
        return;
    }

    lastEditorChange = null;
    reloadPending = false;

    if( currentPlaySessionId  )
        stopInklecateSession(currentPlaySessionId);

    replaying = true;
    currentTurnIdx = 0;

    var instr = buildCompileInstruction();
    instr.play = true;

    LiveCompiler.emit("resetting", instr.sessionId);

    resetErrors();

    currentPlaySessionId = instr.sessionId;

    debug("liveCompiler.reloadInklecateSession: sending compile instruction for session", instr.sessionId);
    ipc.send("compile", instr);

    updateCompilerIsBusy(true);
}

function exportJson(inkJsCompatible, callback) {
    exportCompleteCallback = callback;

    var instr = buildCompileInstruction();
    instr.export = true;
    instr.inkJsCompatible = inkJsCompatible;
    currentExportSessionId = instr.sessionId;

    ipc.send("compile", instr);

    updateCompilerIsBusy(true);
}

function getStats(callback) {
    statsCompleteCallback = callback;

    var instr = buildCompileInstruction();
    instr.stats = true;
    instr.inkJsCompatible = false;
    currentStatsSessionId = instr.sessionId;

    ipc.send("compile", instr);

    updateCompilerIsBusy(true);
}

function completeExport(error, path) {
    var callback = exportCompleteCallback;
    exportCompleteCallback = null;
    if( error )
        callback(error.message);
    else
        callback(null, path);

    updateCompilerIsBusy(false);
}

function stopInklecateSession(idToStop) {
    ipc.send("play-stop-ink", idToStop);

    updateCompilerIsBusy(false);
}

function choose(choice) {
    ipc.send("play-continue-with-choice-number", choice.number, choice.sourceSessionId);
    choiceSequence.push(choice.number);
    currentTurnIdx++;
}

function rewind() {
    choiceSequence = [];
    currentTurnIdx = -1;
    reloadInklecateSession();
}

function stepBack() {
    if( choiceSequence.length > 0 )
        choiceSequence.splice(-1, 1);
    reloadInklecateSession();
}

function stepBackToTurn(turnIdx) {
    if( turnIdx >= 0 && turnIdx < choiceSequence.length ) {
        choiceSequence.splice(turnIdx);
        reloadInklecateSession();
    }
}

function jumpToPath(path, callback) {
    ipc.send("jump-to-path", path, currentPlaySessionId);
    jumpToPathCallbackObj = { callback: callback, sessionId: currentPlaySessionId };
}

function listVariables(callback) {
    ipc.send("list-variables", currentPlaySessionId);
    variablesListCallbackObj = { callback: callback, sessionId: currentPlaySessionId };
}

function getLocationInSource(offset, callback) {
    ipc.send("get-location-in-source", offset, currentPlaySessionId);
    locationInSourceCallbackObj = { callback: callback, sessionId: currentPlaySessionId };
}

function getRuntimePathInSource(runtimePath, callback) {
    ipc.send("get-runtime-path-in-source", runtimePath, currentPlaySessionId);
    locationInSourceCallbackObj = { callback: callback, sessionId: currentPlaySessionId };
}

function evaluateExpression(expressionText, callback) {
    ipc.send("evaluate-expression", expressionText, currentPlaySessionId);
    expressionEvaluationObj = { callback: callback,  sessionId: currentPlaySessionId };
}

// --------------------------------------------------------
// Live re-compile loop
// --------------------------------------------------------

// Do first compile
// Really just for debug when loading ink immediately
// other actions will cause editor changes
setTimeout(reloadInklecateSession, 1000);

// compile loop - detect changes every 0.25 and make sure
// user has paused before actually compiling
setInterval(() => {
    if( paused ) return;
    if( lastEditorChange !== null && Date.now() - lastEditorChange > 500 || reloadPending ) {
        reloadInklecateSession();
    }
}, 250);

// --------------------------------------------------------
// IPC event from the native menu option to cycle issues
// --------------------------------------------------------

ipc.on("next-issue", () => {
    if( issues.length > 0 ) {
        selectedIssueIdx++;
        if( selectedIssueIdx >= issues.length )
            selectedIssueIdx = 0;

        LiveCompiler.emit("selectIssue", issues[selectedIssueIdx]);
    }
});

// --------------------------------------------------------
// IPC Events from inklecate.js
// --------------------------------------------------------

ipc.on("compile-complete", (event, fromSessionId) => {
    debugTrace("liveCompiler.ipc.compile-complete", fromSessionId);
    if( fromSessionId != currentPlaySessionId ) return;

    updateCompilerIsBusy(false);

    LiveCompiler.emit("compileComplete", fromSessionId);
});


ipc.on("play-generated-text", (event, result, fromSessionId) => {
    debugTrace("liveCompiler.ipc.play-generated-text", fromSessionId);

    if( fromSessionId != currentPlaySessionId ) return;

    // May have just finished compiling, have text
    updateCompilerIsBusy(false);

    LiveCompiler.emit("textAdded", result);
});

ipc.on("play-generated-errors", (event, errors, fromSessionId) => {
    debugTrace("liveCompiler.ipc.play-generated-errors", fromSessionId, errors.length, "errors");

    if( !sessionIsCurrent(fromSessionId) ) return;

    // Finished compiling for sure
    updateCompilerIsBusy(false);

    issues = errors;
    LiveCompiler.emit("errorsAdded", errors);
});

ipc.on("play-generated-tags", (event, tags, fromSessionId) => {

    if( fromSessionId != currentPlaySessionId ) return;

    // May have finished compiling
    updateCompilerIsBusy(false);

    LiveCompiler.emit("tagsAdded", tags);
});

ipc.on("play-generated-choice", (event, choice, fromSessionId) => {

    if( fromSessionId != currentPlaySessionId ) return;

    choice.sourceSessionId = fromSessionId;

    // May have finished compiling
    updateCompilerIsBusy(false);

    // If there's one choice, that means there are two turns/chunks
    var turnCount = choiceSequence.length+1;
    var isLatestTurn = currentTurnIdx >= turnCount-1;
    LiveCompiler.emit("choiceAdded", choice, isLatestTurn);
});

ipc.on("play-requires-input", (event, fromSessionId) => {

    if( fromSessionId != currentPlaySessionId )
        return;

    // May have finished compiling
    updateCompilerIsBusy(false);

    var justCompletedReplay = false;
    if( replaying && currentTurnIdx >= choiceSequence.length ) {
        replaying = false;
        justCompletedReplay = true;
    }

    LiveCompiler.emit("playerPrompt", replaying, () => {
        if( replaying ) {
            var replayChoiceNumber = choiceSequence[currentTurnIdx];
            currentTurnIdx++;
            ipc.send("play-continue-with-choice-number", replayChoiceNumber, fromSessionId);
        } 

        if( justCompletedReplay ) 
            LiveCompiler.emit("replayComplete", currentPlaySessionId);
    });
});

ipc.on("inklecate-complete", (event, fromSessionId, exportJsonPath) => {

    if( fromSessionId == currentPlaySessionId ) {
        LiveCompiler.emit("storyCompleted");

        updateCompilerIsBusy(false);

        if( replaying ) {
            replaying = false;
            LiveCompiler.emit("replayComplete", currentPlaySessionId);
        }
    }
    else if( fromSessionId == currentExportSessionId ) {
        completeExport(null, exportJsonPath);
    }
});

ipc.on("play-exit-due-to-error", (event, exitCode, fromSessionId) => {

    if( !sessionIsCurrent(fromSessionId) ) return;

    if( fromSessionId == currentExportSessionId ) {
        completeExport({message: i18n._("Ink has errors - please fix them before exporting.")});
    } else {
        if( replaying ) {
            replaying = false;
            LiveCompiler.emit("replayComplete", fromSessionId);
        }

        LiveCompiler.emit("exitDueToError");

        updateCompilerIsBusy(false);
    }
});

ipc.on("play-story-unexpected-error", (event, error, fromSessionId) => {

    if( !sessionIsCurrent(fromSessionId) ) return;

    if( fromSessionId == currentExportSessionId ) {
        completeExport({message: i18n._("Unexpected error")});
    } else {
        if( replaying ) {
            replaying = false;
            LiveCompiler.emit("replayComplete", fromSessionId);
        }

        LiveCompiler.emit("unexpectedError", error);

        updateCompilerIsBusy(false);
    }
});

ipc.on("play-story-stopped", (event, fromSessionId) => {
    // Commented out since we get a play-story-stopped immediately after pressing the
    // reset button, which causes the busy-spinner to hide even though it's just started
    // recompiling the ink.
    // updateCompilerIsBusy(false);
});

ipc.on("return-location-from-source", (event, fromSessionId, locationInfo) => {
    if( fromSessionId == locationInSourceCallbackObj.sessionId ) {
        var callback = locationInSourceCallbackObj.callback;
        locationInSourceCallbackObj = null;
        callback(locationInfo);
    }
});

ipc.on("play-evaluated-expression", (event, textResult, fromSessionId) => {
    if( fromSessionId == expressionEvaluationObj.sessionId && expressionEvaluationObj ) {
        var callback = expressionEvaluationObj.callback;
        expressionEvaluationObj = null;
        callback(textResult);
    }
});

ipc.on("play-evaluated-expression-error", (event, errorMessage, fromSessionId) => {
    if( fromSessionId == expressionEvaluationObj.sessionId && expressionEvaluationObj ) {
        var callback = expressionEvaluationObj.callback;
        expressionEvaluationObj = null;
        callback(null, errorMessage);
    }
});

ipc.on("return-variables-list", (event, variablesText, fromSessionId) => {
    if( fromSessionId == variablesListCallbackObj.sessionId && variablesListCallbackObj ) {
        var callback = variablesListCallbackObj.callback;
        variablesListCallbackObj = null;
        callback(variablesText);
    }
});

ipc.on("return-stats", (event, statsObj, fromSessionId) => {

    if( fromSessionId != currentStatsSessionId ) return;
    
    var callback = statsCompleteCallback;
    statsCompleteCallback = null;
    callback(statsObj);

    updateCompilerIsBusy(false);

    currentStatsSessionId = null
});


function removeTempFile(relativePath) {
    if( namespace )
        ipc.send("remove-temp-file", namespace, relativePath);
}

function setEdited() {
    lastEditorChange = Date.now();
    if( paused ) {
        compilePending = true;
    }
}

function pause() {
    debugTrace("liveCompiler.pause");
    paused = true;
    LiveCompiler.emit("pauseChanged", true);
}

function unpause() {
    debugTrace("liveCompiler.unpause");
    paused = false;
    LiveCompiler.emit("pauseChanged", false);
    if( compilePending ) {
        compilePending = false;
        reloadInklecateSession();
    }
}

function togglePause() {
    debugTrace("liveCompiler.togglePause", "currently paused:", paused);
    if( paused )
        unpause();
    else
        pause();
}

function isPaused() {
    return paused;
}

exports.LiveCompiler = Object.assign(LiveCompiler, {
    setProject: setProject,
    reload: reloadInklecateSession,
    exportJson: exportJson,
    setEdited: setEdited,
    getIssues: () => { return issues; },
    getIssuesForFilename: (filename) => _.filter(issues, i => i.filename == filename),
    choose: choose,
    rewind: rewind,
    stepBack: stepBack,
    stepBackToTurn: stepBackToTurn,
    jumpToPath: jumpToPath,
    listVariables: listVariables,
    getLocationInSource: getLocationInSource,
    getRuntimePathInSource: getRuntimePathInSource,
    evaluateExpression: evaluateExpression,
    getStats: getStats,
    removeTempFile: removeTempFile,
    pause: pause,
    unpause: unpause,
    togglePause: togglePause,
    isPaused: isPaused
})
