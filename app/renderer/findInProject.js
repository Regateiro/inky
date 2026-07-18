const EventEmitter = require("events");
const path = require("path");
const electron = require("electron");
const ipc = electron.ipcRenderer;
const _ = require("lodash");
const $ = window.jQuery = require('./jquery-2.2.3.min.js');

const InkProject = require("./inkProject.js").InkProject;
const EditorView = require("./editorView.js").EditorView;

const i18n = require("./i18n.js");

var $container = null;
var $panel = null;
var $searchInput = null;
var $replaceInput = null;
var $results = null;
var $matchCount = null;

var isOpen = false;

const FindInProject = new EventEmitter();

function show() {
    if( isOpen ) {
        $searchInput.focus();
        $searchInput.select();
        return;
    }

    EditorView.saveCursorPos();

    isOpen = true;

    $container.removeClass("hidden");
    $panel.removeClass("hidden");

    $searchInput.val("");
    $replaceInput.val("");
    $results.empty();
    $matchCount.text("");

    $searchInput.focus();
}

function hide() {
    if( !isOpen ) return;

    isOpen = false;

    $panel.addClass("hidden");
    $container.addClass("hidden");

    EditorView.focus();
    EditorView.restoreCursorPos();
}

function toggle() {
    if( isOpen )
        hide();
    else
        show();
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function doSearch() {
    var query = $searchInput.val();

    $results.empty();
    $matchCount.text("");

    if( !query || !InkProject.currentProject ) return;

    var useRegex = document.getElementById("fip-regex").checked;
    var caseSensitive = document.getElementById("fip-case-sensitive").checked;
    var wholeWord = document.getElementById("fip-whole-word").checked;

    var searchRegex;
    try {
        if( useRegex ) {
            searchRegex = new RegExp(query, caseSensitive ? "g" : "gi");
        } else {
            var escaped = escapeRegex(query);
            if( wholeWord )
                escaped = "\\b" + escaped + "\\b";
            searchRegex = new RegExp(escaped, caseSensitive ? "g" : "gi");
        }
    } catch(e) {
        return;
    }

    var files = InkProject.currentProject.files;
    var totalMatches = 0;

    files.forEach(function(file) {
        var content = file.getValue();
        var lines = content.split("\n");
        var fileMatches = [];

        lines.forEach(function(line, row) {
            searchRegex.lastIndex = 0;
            var match;
            while( (match = searchRegex.exec(line)) !== null ) {
                fileMatches.push({
                    row: row,
                    column: match.index,
                    line: line,
                    match: match[0]
                });
                totalMatches++;
            }
        });

        if( fileMatches.length > 0 ) {
            var $fileHeader = $('<li class="fip-file-header">')
                .text(file.relPath + " (" + fileMatches.length + ")");
            $results.append($fileHeader);

            fileMatches.forEach(function(m) {
                var displayLine = m.line.trim();
                if( displayLine.length > 100 )
                    displayLine = displayLine.substring(0, 100) + "...";

                var $match = $('<li class="fip-match">')
                    .data({ file: file, row: m.row, column: m.column })
                    .append($('<span class="fip-line-no">').text(m.row + 1))
                    .append($('<span class="fip-line-text">').text(displayLine));

                $match.on("click", function() {
                    InkProject.currentProject.showInkFile(file);
                    EditorView.gotoLine(m.row + 1, m.column);
                });

                $results.append($match);
            });
        }
    });

    $matchCount.text(totalMatches + " match" + (totalMatches !== 1 ? "es" : "") + " in " + files.length + " file" + (files.length !== 1 ? "s" : ""));
}

function doReplace() {
    if( !InkProject.currentProject ) return;

    var query = $searchInput.val();
    var replacement = $replaceInput.val();
    if( !query ) return;

    var useRegex = document.getElementById("fip-regex").checked;
    var caseSensitive = document.getElementById("fip-case-sensitive").checked;
    var wholeWord = document.getElementById("fip-whole-word").checked;

    var selected = $results.children("li.fip-match.selected");
    if( selected.length > 0 ) {
        var data = selected.data();
        var file = data.file;
        var row = data.row;
        var column = data.column;

        InkProject.currentProject.showInkFile(file);

        var session = file.getAceSession();
        var line = session.getLine(row);

        var searchRegex;
        if( useRegex ) {
            searchRegex = new RegExp(query, caseSensitive ? "" : "i");
        } else {
            var escaped = escapeRegex(query);
            if( wholeWord )
                escaped = "\\b" + escaped + "\\b";
            searchRegex = new RegExp(escaped, caseSensitive ? "" : "i");
        }

        var match = searchRegex.exec(line);
        if( match && match.index === column ) {
            var endColumn = column + match[0].length;
            session.replace(
                { start: { row: row, column: column }, end: { row: row, column: endColumn } },
                replacement
            );
        }

        doSearch();
    }
}

function doReplaceAll() {
    if( !InkProject.currentProject ) return;

    var query = $searchInput.val();
    var replacement = $replaceInput.val();
    if( !query ) return;

    var useRegex = document.getElementById("fip-regex").checked;
    var caseSensitive = document.getElementById("fip-case-sensitive").checked;
    var wholeWord = document.getElementById("fip-whole-word").checked;

    var searchRegex;
    if( useRegex ) {
        searchRegex = new RegExp(query, caseSensitive ? "g" : "gi");
    } else {
        var escaped = escapeRegex(query);
        if( wholeWord )
            escaped = "\\b" + escaped + "\\b";
        searchRegex = new RegExp(escaped, caseSensitive ? "g" : "gi");
    }

    var files = InkProject.currentProject.files;
    files.forEach(function(file) {
        var content = file.getValue();
        var newContent = content.replace(searchRegex, replacement);
        if( newContent !== content ) {
            file.aceDocument.setValue(newContent);
        }
    });

    doSearch();
}

function globalKeyHandler(e) {
    // Escape
    if( e.keyCode === 27 ) {
        e.preventDefault();
        hide();
    }
}

$(document).ready(function() {
    $container = $("#find-in-project-container");
    $panel = $("#find-in-project");
    $searchInput = $panel.find(".fip-search-input");
    $replaceInput = $panel.find(".fip-replace-input");
    $results = $panel.find(".fip-results");
    $matchCount = $panel.find(".fip-match-count");

    $container.on("click", function(e) {
        if( e.target === $container[0] )
            hide();
    });

    $panel.find(".fip-close").on("click", hide);

    $searchInput.on("input", doSearch);

    $searchInput.on("keydown", function(e) {
        if( e.keyCode === 13 ) {
            e.preventDefault();
            var $selected = $results.children("li.fip-match.selected");
            if( $selected.length > 0 ) {
                var $next = $selected.nextAll("li.fip-match").first();
                if( $next.length === 0 )
                    $next = $results.children("li.fip-match").first();
                $results.children("li.fip-match").removeClass("selected");
                $next.addClass("selected");
                $next[0].scrollIntoView({ block: "nearest" });
                $next.click();
            } else {
                var $first = $results.children("li.fip-match").first();
                if( $first.length > 0 ) {
                    $first.addClass("selected");
                    $first.click();
                }
            }
        }
    });

    $panel.find(".fip-replace-btn").on("click", doReplace);
    $panel.find(".fip-replace-all-btn").on("click", doReplaceAll);

    $(document).on("keydown", globalKeyHandler);
});

ipc.on("find-in-project", function() {
    toggle();
});

exports.FindInProject = FindInProject;
