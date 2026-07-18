const EventEmitter = require("events");
const $ = window.jQuery = require('./jquery-2.2.3.min.js');
const i18n = require("./i18n.js");
const { debug, debugTrace } = require("./debug.js");

const ToolbarView = new EventEmitter();

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
            ToolbarView.emit("jumpToPath", pathValue);
        }
        event.preventDefault();
    });

    $("#toolbar .pathJumpInput").on("keyup", function(event) {
        if( event.keyCode === 13 ) {
            var pathValue = $(this).val().trim();
            debugTrace("toolbar.pathJumpInput.enter", pathValue);
            if( pathValue.length > 0 ) {
                ToolbarView.emit("jumpToPath", pathValue);
            }
        }
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