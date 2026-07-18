const EventEmitter = require("events");
const $ = window.jQuery = require('./jquery-2.2.3.min.js');
const i18n = require("./i18n.js");
const { debug, debugTrace } = require("./debug.js");

const ToolbarView = new EventEmitter();

var autocompleteSuggestions = [];
var autocompleteIndex = -1;
var $autocompleteList = null;

function getAutocompleteSuggestions() {
    if (!window.InkProject || !window.InkProject.currentProject) return [];
    
    const project = window.InkProject.currentProject;
    const allFiles = project.files || [];
    const suggestions = [];
    
    allFiles.forEach(inkFile => {
        if (!inkFile || !inkFile.symbols) return;
        
        try {
            inkFile.symbols.parse();
        } catch(e) {
            return;
        }
        
        const ranges = inkFile.symbols.rangeIndex;
        
        ranges.forEach(range => {
            const symbol = range.symbol;
            suggestions.push(symbol.name);
            
            if (symbol.innerSymbols) {
                Object.keys(symbol.innerSymbols).forEach((innerSymbolName) => {
                    const innerSymbol = symbol.innerSymbols[innerSymbolName];
                    if (innerSymbol.flowType.name === "Stitch") {
                        suggestions.push(`${symbol.name}.${innerSymbolName}`);
                    }
                });
            }
        });
    });
    
    return suggestions.sort();
}

function showAutocomplete(filter) {
    hideAutocomplete();
    
    if (!filter || filter.trim().length === 0) return;
    
    autocompleteSuggestions = getAutocompleteSuggestions().filter(s => 
        s.toLowerCase().includes(filter.toLowerCase())
    );
    
    if (autocompleteSuggestions.length === 0) return;
    
    autocompleteIndex = 0;
    
    $autocompleteList = $('<div class="pathJumpAutocomplete"></div>');
    
    autocompleteSuggestions.forEach((suggestion, index) => {
        const $item = $(`<div class="pathJumpAutocomplete-item">${suggestion}</div>`);
        if (index === 0) $item.addClass("selected");
        
        $item.on("click", function() {
            $("#toolbar .pathJumpInput").val(suggestion);
            hideAutocomplete();
            ToolbarView.emit("jumpToPath", suggestion);
        });
        
        $autocompleteList.append($item);
    });
    
    $(".window").append($autocompleteList);
    
    const $input = $("#toolbar .pathJumpInput");
    const $window = $(".window");
    const inputOffset = $input.offset();
    const windowOffset = $window.offset();
    const inputHeight = $input.outerHeight();
    
    $autocompleteList.css({
        position: "absolute",
        top: (inputOffset.top - windowOffset.top + inputHeight) + "px",
        left: (inputOffset.left - windowOffset.left) + "px",
        width: $input.outerWidth() + "px"
    });
}

function hideAutocomplete() {
    if ($autocompleteList) {
        $autocompleteList.remove();
        $autocompleteList = null;
    }
    autocompleteSuggestions = [];
    autocompleteIndex = -1;
}

function navigateAutocomplete(direction) {
    if (!$autocompleteList || autocompleteSuggestions.length === 0) return;
    
    const $items = $autocompleteList.find(".pathJumpAutocomplete-item");
    $items.removeClass("selected");
    
    if (direction === "up") {
        autocompleteIndex = (autocompleteIndex - 1 + autocompleteSuggestions.length) % autocompleteSuggestions.length;
    } else {
        autocompleteIndex = (autocompleteIndex + 1) % autocompleteSuggestions.length;
    }
    
    $items.eq(autocompleteIndex).addClass("selected");
    $items.eq(autocompleteIndex)[0].scrollIntoView({ block: "nearest" });
}

function selectAutocompleteItem() {
    if (!$autocompleteList || autocompleteIndex < 0) return false;
    
    const selected = autocompleteSuggestions[autocompleteIndex];
    if (selected) {
        $("#toolbar .pathJumpInput").val(selected);
        hideAutocomplete();
        ToolbarView.emit("jumpToPath", selected);
        return true;
    }
    return false;
}

function updateIssueSummary(issues, issueClickCallback) {

    var $message = $(".issuesMessage");
    var $summary = $(".issuesSummary");
    var $issues = $("#toolbar .issue-popup");
    var $issuesTable = $issues.children(".table");
    $issuesTable.empty();

    var errorCount = 0;
    var warningCount = 0;
    var todoCount = 0;

    var issuePriorties = {
        "ERROR": 1,
        "RUNTIME ERROR": 2,
        "WARNING": 3,
        "RUNTIME WARNING": 4,
        "TODO": 5
    };

    // Note: we're sorting the original array that 
    // was passed in from the caller... bad behaviour?
    // (it's kinda desirable though, since sorting will be
    // faster if we're leaving it sorted for next time)
    issues.sort((i1, i2) => {
        var errorTypeDiff = issuePriorties[i1.type] - issuePriorties[i2.type];
        if( errorTypeDiff != 0 )
            return errorTypeDiff;
        else
            return i1.lineNumber - i2.lineNumber;
    });

    var uniqueFilenames = [...new Set(issues.map(i => i.filename).filter(f => f))];
    var isMultiFile = uniqueFilenames.length > 1;

    function addIssueRow(issue) {
        var errorClass = "";
        if( issue.type == "ERROR" || issue.type == "RUNTIME ERROR" ) {
            errorCount++;
            errorClass = "error";
        } else if( issue.type == "WARNING" ) {
            warningCount++;
            errorClass = "warning";
        } else if( issue.type == "TODO" ) {
            todoCount++;
            errorClass = "todo";
        }

        var $issueRow = $(`<div class="row ${errorClass}">
                            <div class="col line-no">
                              ${issue.lineNumber}
                            </div>
                            <div class="col issue">
                              ${issue.message}
                            </div>
                            <span class="icon icon-right-open-big"></span>
                          </div>`);

        $issueRow.click((e) => {
            ToolbarView.emit("selectIssue", issue);
            e.preventDefault();
        });

        $issuesTable.append($issueRow);
    }

    if( isMultiFile ) {
        var issuesByFilename = {};
        issues.forEach((issue) => {
            var filename = issue.filename || "";
            if( !issuesByFilename[filename] )
                issuesByFilename[filename] = [];
            issuesByFilename[filename].push(issue);
        });

        Object.keys(issuesByFilename).forEach((filename) => {
            var $heading = $(`<div class="row file-heading"><div class="col issue"><b>${filename}</b></div></div>`);
            $issuesTable.append($heading);
            issuesByFilename[filename].forEach(addIssueRow);
        });
    } else {
        issues.forEach(addIssueRow);
    }

    if( errorCount == 0 && warningCount == 0 && todoCount == 0 ) {
        $summary.addClass("hidden");
        $message.text(i18n._("No issues."));
        $message.removeClass("hidden");
        $issues.addClass("hidden");
    } else {
        $message.addClass("hidden");
        function updateCount(className, count) {
            var $issueCount = $summary.children(".issueCount."+className);
            if( count == 0 )
                $issueCount.hide();
            else {
                $issueCount.show();
                $issueCount.children("span").text(count);
            }
        }

        updateCount("error", errorCount);
        updateCount("warning", warningCount);
        updateCount("todo", todoCount);
        $summary.removeClass("hidden");

        updateIssuesPopupPosition();
    }
}

function updateIssuesPopupPosition() {
    var $issues = $("#toolbar .issue-popup");
    $issues.css({
        left: 0.5*$(window).width() - 0.5*$issues.width()
    });
}

$(document).ready(function() {

    $("#toolbar .nav-toggle.button").on("click", function(event) {
        debugTrace("toolbar.nav-toggle.click");
        ToolbarView.emit("toggleSidebar", "#file-nav-wrapper", ".nav-toggle.button");
        event.preventDefault();
    });

    $("#toolbar .knot-toggle.button").on("click", function(event) {
        debugTrace("toolbar.knot-toggle.click");
        ToolbarView.emit("toggleSidebar", "#knot-stitch-wrapper", ".knot-toggle.button");
        event.preventDefault();
    });

    $("#toolbar .nav-back.button").on("click", function(event) {
        debugTrace("toolbar.nav-back.click");
        ToolbarView.emit("navigateBack");
        event.preventDefault();
    });

    $("#toolbar .nav-forward.button").on("click", function(event) {
        debugTrace("toolbar.nav-forward.click");
        ToolbarView.emit("navigateForward");
        event.preventDefault();
    });



    $("#toolbar .rewind.button").on("click", function(event) {
        debugTrace("toolbar.rewind.click");
        ToolbarView.emit("rewind");
        event.preventDefault();
    });

    $("#toolbar .step-back.button").on("click", function(event) {
        debugTrace("toolbar.step-back.click");
        ToolbarView.emit("stepBack");
        event.preventDefault();
    });

    $("#toolbar .pause-toggle.button").on("click", function(event) {
        debugTrace("toolbar.pause-toggle.click");
        ToolbarView.emit("togglePause");
        event.preventDefault();
    });

    $("#toolbar .pathJumpGo").on("click", function(event) {
        var pathValue = $("#toolbar .pathJumpInput").val().trim();
        debugTrace("toolbar.pathJumpGo.click", pathValue);
        if( pathValue.length > 0 ) {
            hideAutocomplete();
            ToolbarView.emit("jumpToPath", pathValue);
        }
        event.preventDefault();
    });

    $("#toolbar .pathJumpInput").on("input", function(event) {
        var pathValue = $(this).val().trim();
        showAutocomplete(pathValue);
    });

    $("#toolbar .pathJumpInput").on("keydown", function(event) {
        if( event.key === "ArrowUp" ) {
            event.preventDefault();
            navigateAutocomplete("up");
        } else if( event.key === "ArrowDown" ) {
            event.preventDefault();
            navigateAutocomplete("down");
        } else if( event.key === "Enter" ) {
            if (selectAutocompleteItem()) {
                event.preventDefault();
            } else {
                var pathValue = $(this).val().trim();
                debugTrace("toolbar.pathJumpInput.enter", pathValue);
                if( pathValue.length > 0 ) {
                    hideAutocomplete();
                    ToolbarView.emit("jumpToPath", pathValue);
                }
            }
        } else if( event.key === "Escape" ) {
            hideAutocomplete();
        }
    });

    $("#toolbar .pathJumpInput").on("blur", function() {
        setTimeout(hideAutocomplete, 200);
    });

    

    var shouldBeHidden = false;
    $("#toolbar .issuesSummary, #toolbar .issue-popup").hover(function(e) {
        $("#toolbar .issue-popup").removeClass("hidden");
        shouldBeHidden = false;
    }, function(e) {
        shouldBeHidden = true;
        setTimeout(() => { 
            if( shouldBeHidden )
                $("#toolbar .issue-popup").addClass("hidden");
        }, 500);
    });

    $(window).resize(updateIssuesPopupPosition);
});

function setTitle(title) {
    $("h1.title").text(title);
    ToolbarView.emit("didSetTitle", title);
}

function setBusySpinnerVisible(vis) {
    if (vis) {
        $(".busySpinner").addClass("visible");
    } else {
        $(".busySpinner").removeClass("visible");
    }
}

exports.ToolbarView = Object.assign(ToolbarView, {
    updateIssueSummary: updateIssueSummary,
    clearIssueSummary: () => { updateIssueSummary([]); },
    setTitle: setTitle,
    setBusySpinnerVisible: setBusySpinnerVisible,
    setPauseActive: (active) => {
        debugTrace("toolbarView.setPauseActive", active);
        var $btn = $("#toolbar .pause-toggle.button");
        var $icon = $btn.find(".icon");
        if( active ) {
            $btn.addClass("selected");
            $icon.removeClass("icon-pause").addClass("icon-play");
            $btn.attr("title", "Resume compilation");
        } else {
            $btn.removeClass("selected");
            $icon.removeClass("icon-play").addClass("icon-pause");
            $btn.attr("title", "Pause compilation");
        }
        debug("toolbarView.setPauseActive: button state updated, classes:", $btn.attr("class"));
    }
})