const EventEmitter = require("events");
const editor = ace.edit("editor");
const Range = ace.require("ace/range").Range;
const TokenIterator = ace.require("ace/token_iterator").TokenIterator;
const language_tools = ace.require("ace/ext/language_tools");

const inkCompleter = require("./inkCompleter.js").inkCompleter;
const { debug, debugTrace } = require("./debug.js");

var editorAnnotations = [];
const sessionMarkers = new Map();

// Used when reloading files so that cursor doesn't jump back to the top
var savedCursorPos = null;
var savedScrollRow = null;

class EditorViewClass extends EventEmitter {
}

const EditorView = new EditorViewClass();

editor.setShowPrintMargin(false);
editor.setOptions({
    enableBasicAutocompletion: true, // defaults only, will be overriden by setAutoCompleteDisabled
    enableLiveAutocompletion: true,
});
editor.on("change", () => {
    debugTrace("ace.editor.change");
    EditorView.emit("change");
});
editor.on("changeSelection", ()=>{
    debugTrace("ace.editor.changeSelection");
    EditorView.emit("changedLine", editor.getCursorPosition());
})

// Exclude language_tools.textCompleter but add the Ink completer
editor.completers = editor.completers.filter(
    (completer) => completer !== language_tools.textCompleter);
editor.completers.push(inkCompleter);

// Unbind windows CTRL-P: "Jump to matching bracket" since it collides with
// our "go to anything" command.
editor.commands.removeCommand("jumptomatching")

// Unbind CMD-ALT-S from Ace so we can use it for save js only
editor.commands.removeCommand("sortlines");

// Unfortunately standard jquery events don't work since 
// Ace turns pointer events off
editor.on("click", function(e){

    if( e.domEvent.altKey ) {
        tryClickCodeLink(e);
    } else {
        setImmediate(() => EditorView.emit("navigate"));
    }
});

function tryClickCodeLink(event) {
    var editor = event.editor;
    var pos = editor.getCursorPosition();
    var searchToken = editor.session.getTokenAt(pos.row, pos.column);

    if( searchToken && searchToken.type == "include.filepath" ) {
        EditorView.emit("jumpToInclude", searchToken.value);
        return;
    }

    if( searchToken && searchToken.type == "divert.target" ) {
        event.preventDefault();
        var targetPath = searchToken.value;
        EditorView.emit("jumpToSymbol", targetPath, pos);
        return;
    }
}

// Unfortunately standard CSS for hover doesn't work in the editor
// since they turn pointer events off.
editor.on("mousemove", function (e) {

    var editor = e.editor;

    // Have to hold down modifier key to jump
    if( e.domEvent.altKey ) {

        var character = editor.renderer.screenToTextCoordinates(e.x, e.y);
        var token = editor.session.getTokenAt(character.row, character.column);
        if( !token )
            return;

        var tokenStartPos = editor.renderer.textToScreenCoordinates(character.row, token.start);
        var tokenEndPos = editor.renderer.textToScreenCoordinates(character.row, token.start + token.value.length);

        const lineHeight = 12;
        if( e.x >= tokenStartPos.pageX && e.x <= tokenEndPos.pageX && e.y >= tokenStartPos.pageY && e.y <= tokenEndPos.pageY+lineHeight) {
            if( token ) {
                if( token.type == "divert.target" || token.type == "include.filepath" ) {
                    editor.renderer.setCursorStyle("pointer");
                    return;
                }
            }
        }
    }
    
    editor.renderer.setCursorStyle("default");
});

function addError(error) {

    var editorErrorType = "error";
    var editorClass = "ace-error";
    if( error.type == "WARNING" ) {
        editorErrorType = "warning";
        editorClass = "ace-warning";
    }
    else if( error.type == "TODO" ) {
        editorErrorType = "information";
        editorClass = 'ace-todo';
    }

    editorAnnotations.push({
        row: error.lineNumber-1,
        column: 0,
        text: error.message,
        type: editorErrorType
    });
    editor.getSession().setAnnotations(editorAnnotations);

    var markerId = editor.session.addMarker(
        new Range(error.lineNumber-1, 0, error.lineNumber, 0),
        editorClass, 
        "line",
        false
    );
    const session = editor.getSession();
    if (!sessionMarkers.has(session)) {
        sessionMarkers.set(session, []);
    }
    sessionMarkers.get(session).push(markerId);
}

function setErrors(errors) {
    clearErrors();
    errors.forEach(addError);
}

function clearErrors() {

    var editorSession = editor.getSession();
    editorSession.clearAnnotations();
    editorAnnotations = [];

    const markers = sessionMarkers.get(editorSession);
    if (markers) {
        for(var i=0; i<markers.length; i++) {
            editorSession.removeMarker(markers[i]);
        }
        sessionMarkers.delete(editorSession);
    }
}

function followSymbol() {
    var pos = editor.getCursorPosition();
    var searchToken = editor.session.getTokenAt(pos.row, pos.column);

    if (!searchToken) return;

    if (searchToken.type == "include.filepath") {
        EditorView.emit("jumpToInclude", searchToken.value);
        return;
    }

    if (searchToken.type == "divert.target") {
        EditorView.emit("jumpToSymbol", searchToken.value, pos);
        return;
    }
}

exports.EditorView = Object.assign(EditorView, {
    clearErrors: () => {
        debugTrace("EditorView.clearErrors");
        clearErrors();
    },
    getValue: () => {
        debugTrace("EditorView.getValue");
        return editor.getValue();
    },
    setValue: (v) => {
        debugTrace("EditorView.setValue", v ? v.length : 0, "chars");
        editor.setValue(v);
    },
    insert: (txt) => {
        debugTrace("EditorView.insert", txt ? txt.length : 0, "chars");
        editor.insert(txt);
    },
    gotoLine: (row, col) => {
        debugTrace("EditorView.gotoLine", row, col);
        editor.gotoLine(row, col);
        editor.focus();
    },
    addError: (error) => {
        debugTrace("EditorView.addError", error);
        addError(error);
    },
    setErrors: (errors) => {
        debugTrace("EditorView.setErrors", errors.length, "errors");
        setErrors(errors);
    },
    followSymbol: () => {
        debugTrace("EditorView.followSymbol");
        followSymbol();
    },
    setFiles: (inkFiles) => {
        debugTrace("EditorView.setFiles", inkFiles.length, "files");
        inkCompleter.inkFiles = inkFiles;
    },
    showInkFile: (inkFile) => {
        debugTrace("EditorView.showInkFile", inkFile.filename());
        const oldSession = editor.getSession();
        if (oldSession) {
            const markers = sessionMarkers.get(oldSession);
            if (markers) {
                for (var i = 0; i < markers.length; i++) {
                    oldSession.removeMarker(markers[i]);
                }
                sessionMarkers.delete(oldSession);
            }
            oldSession.clearAnnotations();
        }
        editorAnnotations = [];
        editor.setSession(inkFile.getAceSession());
        editor.focus();
    },
    focus: () => {
        debugTrace("EditorView.focus");
        editor.focus();
    },
    saveCursorPos: () => { 
        debugTrace("EditorView.saveCursorPos");
        savedCursorPos = editor.getCursorPosition(); 
        savedScrollRow = editor.getFirstVisibleRow(); 
    },
    restoreCursorPos: () => { 
        debugTrace("EditorView.restoreCursorPos", savedCursorPos, savedScrollRow);
        if( savedCursorPos ) {
            editor.moveCursorToPosition(savedCursorPos); 
            editor.scrollToRow(savedScrollRow);
        } 
    },
    getCurrentCursorPos: ()=>{
        return editor.getCursorPosition();
    },
    setAutoCompleteDisabled: (autoCompleteDisabled) => {
        debugTrace("EditorView.setAutoCompleteDisabled", autoCompleteDisabled);
        editor.setOptions({
            enableBasicAutocompletion: !autoCompleteDisabled,
            enableLiveAutocompletion: !autoCompleteDisabled
        });
    },
    resize: () => {
        debugTrace("EditorView.resize");
        editor.resize();
    },
});