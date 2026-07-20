const EventEmitter = require("events");
const $ = window.jQuery = require('./jquery-2.2.3.min.js');
const path = require("path");
const _ = require("lodash");
const i18n = require("./i18n.js");
const InkFile = require("./inkFile.js").InkFile;
const { range, toInteger } = require('lodash');
const {ipcRenderer} = require("electron");
const { debug, debugTrace, debugError } = require("./debug.js");

const slideAnimDuration = 200;
var sidebarWidth = 200;

var $sidebar = null;
var $fileNavWrapper = null;
var $knotStichNavWrapper = null;
var $twoPane = null;
var $footer = null;
var $newIncludeForm = null;

var $currentNavWrapper = null

var visible = false;
var hasBeenShown = false;

const NavView = new EventEmitter();

$(document).ready(() => {
    //Assign each variable to the allocated class/id.
    $sidebar = $(".sidebar");
    $fileNavWrapper = $sidebar.find("#file-nav-wrapper");
    $knotStichNavWrapper = $sidebar.find("#knot-stitch-wrapper")
    $twoPane = $(".twopane");
    $sidebarSplit = $("#main").children(".split");
    $sidebarSplit.hide();
    $sidebarSplit.css("left", 0);
    $footer = $sidebar.find(".footer");

    // Clicking on navigation item
    $fileNavWrapper.on("click", ".nav-group-item", function(event) {
        event.preventDefault();
        var $targetNavGroupItem = $(event.currentTarget);
        highlight$NavGroupItem($targetNavGroupItem);

        var fileIdStr = $targetNavGroupItem.attr("data-file-id");
        debugTrace("navView.click", "fileIdStr:", fileIdStr);
        if( fileIdStr === undefined || fileIdStr === "" ) {
            debugError("navView.click: no data-file-id attribute");
            return;
        }
        var fileId = parseInt(fileIdStr);
        if( isNaN(fileId) ) {
            debugError("navView.click: fileId is NaN:", fileIdStr);
            return;
        }
        debug("navView.click: emitting clickFileId", fileId);
        NavView.emit("clickFileId", fileId);
    });
    $knotStichNavWrapper.on("click", ".nav-group-item", function(event) {
        // Any clicked navigation item should become highlighted
        event.preventDefault();
        var $targetNavGroupItem = $(event.currentTarget);
        var row = $targetNavGroupItem.attr("row");
        debugTrace("navView.knotStitch.click", "row:", row);
        NavView.emit("jumpToRow", parseInt(row))
    });

    // Context menu for file nav items
    $fileNavWrapper.on("contextmenu", ".nav-group-item", function(event) {
        event.preventDefault();
        event.stopPropagation();

        var $targetNavGroupItem = $(event.currentTarget);
        highlight$NavGroupItem($targetNavGroupItem);

        var fileIdStr = $targetNavGroupItem.attr("data-file-id");
        if( !fileIdStr ) return;
        var fileId = parseInt(fileIdStr);

        removeContextMenu();
        NavView.emit("clickFileId", fileId);

        var $menu = $(`
            <div class="nav-context-menu" style="position:fixed;left:${event.clientX}px;top:${event.clientY}px;z-index:9999;background:#fff;border:1px solid #ccc;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,0.15);padding:4px 0;font-size:13px;min-width:120px;">
                <div class="nav-context-menu-item" data-action="rename" style="padding:6px 16px;cursor:pointer;">Rename</div>
                <div class="nav-context-menu-item" data-action="delete" style="padding:6px 16px;cursor:pointer;">Delete</div>
            </div>
        `);
        $("body").append($menu);

        $menu.on("click", ".nav-context-menu-item", function(e) {
            e.stopPropagation();
            var action = $(this).data("action");
            removeContextMenu();
            if( action === "rename" ) {
                NavView.emit("renameFileId", fileId);
            } else if( action === "delete" ) {
                NavView.emit("deleteFileId", fileId);
            }
        });

        $(document).one("click", function() {
            removeContextMenu();
        });
    });

    // Mac-style return-to-rename: pressing Return on a selected file starts rename
    $(document).on("keydown", function(e) {
        if( e.key === "F2" && $fileNavWrapper.find(".nav-group-item.active").length > 0 ) {
            var $active = $fileNavWrapper.find(".nav-group-item.active");
            if( $active.length > 0 ) {
                var fileIdStr = $active.attr("data-file-id");
                if( fileIdStr ) {
                    e.preventDefault();
                    NavView.emit("renameFileId", parseInt(fileIdStr));
                }
            }
        }
    });

    ipcRenderer.on("project-rename-file", () => {
        var $active = $fileNavWrapper.find(".nav-group-item.active");
        if( $active.length > 0 ) {
            var fileIdStr = $active.attr("data-file-id");
            if( fileIdStr ) {
                NavView.emit("renameFileId", parseInt(fileIdStr));
            }
        }
    });

    ipcRenderer.on("project-delete-file", () => {
        var $active = $fileNavWrapper.find(".nav-group-item.active");
        if( $active.length > 0 ) {
            var fileIdStr = $active.attr("data-file-id");
            if( fileIdStr ) {
                NavView.emit("deleteFileId", parseInt(fileIdStr));
            }
        }
    });

    var $dragOverTarget = null;
    var draggedFileId = null;

    $fileNavWrapper.on("dragstart", ".nav-group-item[draggable]", function(e) {
        var fileId = parseInt($(this).attr("data-file-id"));
        draggedFileId = fileId;
        e.originalEvent.dataTransfer.effectAllowed = "move";
        e.originalEvent.dataTransfer.setData("text/plain", String(fileId));
        $(this).css("opacity", "0.4");
    });

    $fileNavWrapper.on("dragend", ".nav-group-item[draggable]", function() {
        $(this).css("opacity", "");
        if( $dragOverTarget ) {
            $dragOverTarget.removeClass("drag-over");
            $dragOverTarget = null;
        }
        draggedFileId = null;
    });

    $fileNavWrapper.on("dragover", ".nav-group-item, .nav-group-title", function(e) {
        e.preventDefault();
        e.originalEvent.dataTransfer.dropEffect = "move";

        var $target = $(this).closest(".nav-group-item, .nav-group-title");
        if( $dragOverTarget && !$dragOverTarget.is($target) ) {
            $dragOverTarget.removeClass("drag-over");
            $dragOverTarget = null;
        }
        if( !$target.hasClass("drag-over") ) {
            $target.addClass("drag-over");
            $dragOverTarget = $target;
        }
    });

    $fileNavWrapper.on("dragleave", ".nav-group-item, .nav-group-title", function(e) {
        var $target = $(this).closest(".nav-group-item, .nav-group-title");
        var related = e.relatedTarget;
        if( related && $target.has(related).length > 0 ) return;
        if( $dragOverTarget && $dragOverTarget.is($target) ) {
            $dragOverTarget.removeClass("drag-over");
            $dragOverTarget = null;
        }
    });

    $fileNavWrapper.on("drop", ".nav-group-item, .nav-group-title", function(e) {
        e.preventDefault();
        if( $dragOverTarget ) {
            $dragOverTarget.removeClass("drag-over");
            $dragOverTarget = null;
        }

        if( draggedFileId === null ) return;

        var $target = $(e.currentTarget);
        var $navGroupItem = $target.closest(".nav-group-item");
        var $navGroup = $target.closest(".nav-group");

        if( $navGroupItem.length > 0 ) {
            var targetFileId = parseInt($navGroupItem.attr("data-file-id"));
            if( targetFileId !== draggedFileId ) {
                NavView.emit("moveInclude", draggedFileId, targetFileId);
            }
        } else if( $navGroup.length > 0 ) {
            var groupType = $navGroup.attr("data-group-type");
            if( groupType === "unused" ) {
                NavView.emit("moveInclude", draggedFileId, null);
            } else if( groupType === "includes" ) {
                var mainInkId = $navGroup.siblings(".main-ink").find(".nav-group-item").attr("data-file-id");
                if( mainInkId !== undefined ) {
                    NavView.emit("moveInclude", draggedFileId, parseInt(mainInkId));
                }
            }
        }
    });

    // Add new include interactions
    $newIncludeForm = $footer.find(".new-include-form");
    $sidebar.on("click", ".add-include-button", function(event) {
        setIncludeFormVisible(true);
        event.preventDefault();
    });
    $sidebar.on("click", "#cancel-add-include", function(event) {
        setIncludeFormVisible(false);
        event.preventDefault();
    })

    function confirmAddInclude() {
        var $inputBox = $newIncludeForm.find("input[type='text']");
        var $addToMainInkCheckbox = $newIncludeForm.find(".add-to-main-ink input");

        var confirmedFilename = $inputBox.val();
        if( !confirmedFilename || confirmedFilename.trim().length == 0 ) {
            $inputBox.addClass("error");
            setImmediate(() => $inputBox.focus());
        } else {
            
            var shouldAddToMainInk = $addToMainInkCheckbox.get(0).checked;
            NavView.emit("addInclude", confirmedFilename, shouldAddToMainInk, (success) => {
                if( success ) setIncludeFormVisible(false);
            });
        }
    }

    $sidebar.on("keypress", "input", function(event) {
        const returnKey = 13;
        if( event.which == returnKey ) {
            confirmAddInclude();
            event.preventDefault();
        }
    });
    $sidebar.on("click", "#add-include", function(event) {
        event.preventDefault();
        confirmAddInclude();
    })

    // Unfortunately you can't capture escape from the input itself
    $(document).keyup(function(e) {
        const escape = 27;
        if (e.keyCode == escape) {
            if( $newIncludeForm.find("input").is(":focus") ) {
                e.preventDefault();
                setIncludeFormVisible(false);
            }
        }
    });

    $(document).on("click", function(e) {
        var $target = $(e.target);
        if( $footer.hasClass("showingForm") && $target.closest(".footer").length == 0 && $target.closest(".split") == 0 ) {
            setIncludeFormVisible(false);
            e.preventDefault();
        }
    });
});

function removeContextMenu() {
    $(".nav-context-menu").remove();
}

function startRenameFile(fileId) {
    var $item = $fileNavWrapper.find(`.nav-group-item[data-file-id="${fileId}"]`);
    if( $item.length === 0 ) return;

    var $filename = $item.find(".filename");
    var currentName = $filename.text();
    var $input = $(`<input type="text" class="rename-input" value="${currentName}" style="background:#fff;border:1px solid #4a90d9;border-radius:2px;padding:1px 3px;font-size:inherit;color:inherit;width:${currentName.length * 7 + 20}px;outline:none;">`);

    $filename.hide();
    $item.append($input);
    $input.focus();
    $input[0].select();

    var committed = false;
    function commit() {
        if( committed ) return;
        committed = true;
        var newName = $input.val().trim();
        $input.remove();
        $filename.show();
        if( newName && newName !== currentName ) {
            NavView.emit("renameFileConfirmed", fileId, newName);
        }
    }

    $input.on("blur", commit);
    $input.on("keydown", function(e) {
        if( e.key === "Enter" ) {
            e.preventDefault();
            commit();
        } else if( e.key === "Escape" ) {
            committed = true;
            $input.remove();
            $filename.show();
        }
    });
}

function setMainInkFilename(name) {
    $fileNavWrapper.find(".nav-group.main-ink .nav-group-item .filename").text(name);
}

var _setKnotsTimer = null;
function setKnotsDebounced(mainInk) {
    if( _setKnotsTimer ) clearTimeout(_setKnotsTimer);
    _setKnotsTimer = setTimeout(() => {
        _setKnotsTimer = null;
        setKnots(mainInk);
    }, 200);
}

function setKnots(mainInk){
    debugTrace("navView.setKnots", mainInk.filename());
    try {
        mainInk.symbols.parse();
    } catch(e) {
        debugError("navView.setKnots: parse failed:", e);
        return;
    }
    var ranges = mainInk.symbols.rangeIndex;

    $knotStichNavWrapper.empty();

    if (ranges.length == 0) {
        var contentLoc = i18n._('Content');
        var descriptionLoc = i18n._('Knots, stitches and functions are indexed here')

        var $content = $(
          `<nav class="nav-group"><h5 class="nav-group-title">${contentLoc}</h5></nav>` +
            `<nav class="nav-group"><span class="nav-group-item nav-tooltip">${descriptionLoc}</span></nav>`
        );
        
        $knotStichNavWrapper.append($content);

        return;
    }
    
    var extraClass = ""

    var externalsList = getExternals(mainInk);
    
    var $content = $(`<nav class="nav-group"><h5 class="nav-group-title">Content</h5></nav>`);
    var $functions = $(`<nav class="nav-group"><h5 class="nav-group-title">Functions</h5></nav>`);
    var $externals = $(`<nav class="nav-group"><h5 class="nav-group-title">Externals</h5></nav>`);

    var foundContent = false; 
    var foundFunctions = false;

    // $knotStichNavWrapper.append($main);
    //For every knots (Ranges is knot and functions)
    ranges.forEach(range => {
        var symbol = range.symbol;
        var extraClass = "knot"
        if (symbol.isfunc) foundFunctions = true; else foundContent = true;
        var icon = symbol.isfunc ? "ink-icon icon-function-scaled" : "ink-icon icon-knot-scaled"
        var items = `<span class="nav-group-item ${extraClass}" row = "${symbol.row}">
        <span class="icon ${icon}"></span>
                <span class="filename">${symbol.name}</span>
            </span>`;
        //If the knot has any symbols inside of it.
        if (symbol.innerSymbols){
            //For every stitch inside the knot
            Object.keys(symbol.innerSymbols).forEach((innerSymbolName) => {
                var innerSymbol = symbol.innerSymbols[innerSymbolName]
                if (innerSymbol.flowType.name == "Stitch"){
                    var extraClass = "stitch";
                    items += 
                    `<span class="nav-group-item ${extraClass}" row = "${innerSymbol.row}">
                    <span class="icon ink-icon icon-stitch-scaled"></span>
                            <span class="filename">${innerSymbol.name}</span>
                        </span>`;
                }
            });

        }

        extraClass = "";
        var $group = $(`<nav class="nav-group ${extraClass}"> ${items} </nav>`);

        if (symbol.isfunc) {
            if (externalsList.has(symbol.name)) 
                $externals.append($group);
            else
                $functions.append($group);
        }
        else 
            $content.append($group);
    });

    if (foundContent)
        $knotStichNavWrapper.append($content);
    if (foundFunctions)
        $knotStichNavWrapper.append($functions);
    if (externalsList.size > 0) 
        $knotStichNavWrapper.append($externals);
}

function updateCurrentKnot(mainInk, cursorPos){
    var symbols = mainInk.symbols.flowAtPos(cursorPos);
    if (!symbols) return;

    let $currentKnot = null;
    if ("Knot" in symbols){
        $currentKnot = $(`[row=${symbols["Knot"].row}]`);
        if (symbols["Knot"].isfunc){
            $currentKnot.addClass("function")
        }
    }

    let $currentStitch = null;
    if ("Stitch" in symbols){
        $currentStitch = $(`[row=${symbols["Stitch"].row}]`);
    }

    if (($currentKnot && $currentKnot.hasClass("active"))&&($currentStitch && $currentStitch.hasClass("active")))
        return;

    $knotStichNavWrapper.find(".nav-group-item.active").removeClass("active");
    if ($currentKnot && $currentKnot.length !== 0){
        $currentKnot.addClass("active");
        $currentKnot[0].scrollIntoViewIfNeeded();


    }
    if ($currentStitch && $currentStitch.length !== 0){
        $currentStitch.addClass("active");
        $currentStitch[0].scrollIntoViewIfNeeded();
    }
}

var errorFilePaths = new Set();

function setErrorFiles(filePaths) {
    errorFilePaths = new Set(filePaths);
    $fileNavWrapper.find(".nav-group-item").each(function() {
        var $item = $(this);
        var filePath = $item.data("file-path");
        if( errorFilePaths.has(filePath) )
            $item.addClass("has-errors");
        else
            $item.removeClass("has-errors");
    });
}

function buildFileItemHtml(file, depth) {
    var name = file.isSpare ? file.relPath : file.filename();
    var extraClass = "";
    if( file.hasUnsavedChanges ) extraClass = "unsaved";
    if( file.isLoading ) extraClass += " loading";
    if( errorFilePaths.has(file.relPath) ) extraClass += " has-errors";

    var indent = depth > 0 ? ` style="padding-left:${depth * 16}px"` : "";
    var icon = depth > 0 ? "icon-folder" : "icon-doc-text";

    var isMainInkItem = depth === 0 && file.isMain();
    var dragAttrs = isMainInkItem ? "" : `draggable="true" data-file-id="${file.id}"`;

    return `<span class="nav-group-item ${extraClass}" data-file-path="${file.relPath}" ${dragAttrs}${indent}>
        <span class="icon ${icon}"></span>
        <span class="filename">${name}</span>
    </span>`;
}

function buildTreeNodes(file, hierarchy, visited) {
    var children = hierarchy[file.id] || [];
    var nodes = [];
    children.forEach(child => {
        if( visited.has(child.id) ) return;
        visited.add(child.id);
        nodes.push({
            file: child,
            children: buildTreeNodes(child, hierarchy, visited)
        });
    });
    return nodes;
}

function renderTreeNode(node, depth) {
    var html = buildFileItemHtml(node.file, depth);
    node.children.forEach(child => {
        html += renderTreeNode(child, depth + 1);
    });
    return html;
}

function setFiles(mainInk, allFiles, hierarchy) {
    debugTrace("navView.setFiles", "mainInk:", mainInk.filename(), "allFiles:", allFiles.length);
    hierarchy = hierarchy || {};

    var unusedFiles = _.filter(allFiles, f => f.isSpare);

    $fileNavWrapper.empty();

    var extraClass = "";
    if( mainInk.hasUnsavedChanges ) extraClass = "unsaved";
    if( mainInk.isLoading ) extraClass += " loading";
    if( errorFilePaths.has(mainInk.relPath) ) extraClass += " has-errors";

    var $main = `<nav class="nav-group main-ink">
                    <h5 class="nav-group-title">Main ink file</h5>
                    <a class="nav-group-item ${extraClass}" data-file-id="${mainInk.id}" data-file-path="${mainInk.relPath}">
                        <span class="icon icon-book"></span>
                        <span class="filename">${mainInk.filename()}</span>
                    </a>
                </nav>`;
    $fileNavWrapper.append($main);

    var visited = new Set();
    visited.add(mainInk.id);
    var treeNodes = buildTreeNodes(mainInk, hierarchy, visited);

    if( treeNodes.length > 0 ) {
        var treeHtml = "";
        treeNodes.forEach(node => {
            treeHtml += renderTreeNode(node, 0);
        });
        var $tree = $(`<nav class="nav-group includes-tree" data-group-type="includes"><h5 class="nav-group-title">${i18n._("Includes")}</h5>${treeHtml}</nav>`);
        $fileNavWrapper.append($tree);
    }

    if( unusedFiles.length > 0 ) {
        var items = "";
        unusedFiles.forEach(file => {
            items += buildFileItemHtml(file, 0);
        });
        var $unused = $(`<nav class="nav-group unused" data-group-type="unused"><h5 class="nav-group-title">${i18n._("Unused files")}</h5>${items}</nav>`);
        $fileNavWrapper.append($unused);
    }
}

function refreshFileStates(allFiles) {
    allFiles.forEach(function(file) {
        var $item = $fileNavWrapper.find(`.nav-group-item[data-file-id="${file.id}"]`);
        if( $item.length === 0 )
            $item = $fileNavWrapper.find(`.nav-group-item[data-file-path="${file.relPath}"]`);
        if( $item.length === 0 ) return;

        $item.toggleClass("unsaved", !!file.hasUnsavedChanges);
        $item.toggleClass("loading", !!file.isLoading);
        $item.toggleClass("has-errors", errorFilePaths.has(file.relPath));
    });
}

function highlight$NavGroupItem($navGroupItem) {
    $fileNavWrapper.find(".nav-group-item").not($navGroupItem).removeClass("active");
    $navGroupItem.addClass("active");
}

function highlightRelativePath(relativePath) {
    debugTrace("navView.highlightRelativePath", relativePath);
    var $item = $fileNavWrapper.find(`.nav-group-item[data-file-path="${relativePath}"]`);
    if( $item.length > 0 )
        highlight$NavGroupItem($item);
    else
        debugError("navView.highlightRelativePath: item not found for", relativePath);
}

function hideSidebar() {
    if( !visible )
        return;
    
    animateSidebar(0);

    visible = false;
}

function showSidebar(columns) {
    if (!columns) columns = 1;    
    if( ! visible )
    {
    
        hasBeenShown = true;

        // hidden class only exists in initial state
        $sidebar.removeClass("hidden");
        $sidebarSplit.removeClass("hidden");

        $sidebar.show();
        $sidebarSplit.show();
    }
    animateSidebar(columns);
    visible = true;
}

function animateSidebar(columns) {
    
    $sidebar.animate({
        width: (columns * sidebarWidth)-1 // border
    }, slideAnimDuration, () => {
        if (columns == 0)
            $sidebar.hide();    
    });
    $twoPane.animate({
        left: (columns * sidebarWidth)
    }, slideAnimDuration);
    $sidebarSplit.animate({
        left:  (columns * sidebarWidth)
    }, slideAnimDuration);

    if (columns > 0) {
        var $navElements =  $(".nav-wrapper");
        var widthStepPercent = (100 / columns);

        let widthCss = "calc("+widthStepPercent+"% - 1px)"; // leave space for a 1 px border
        $footer.width(widthCss);
        $navElements.width(widthCss);

        var leftPosPercent = 0;
        var el;
        for (var idx = 0 ; idx < $navElements.length; idx++) {
            el = $($navElements[idx]);
            if (!el.hasClass("hidden")) 
            {
                el.animate({
                    left: (leftPosPercent + "%")
                }, 0 );  
                leftPosPercent += widthStepPercent;  
            }
        }
    }

}


function setIncludeFormVisible(visible) {
    var $inputBox = $newIncludeForm.find("input[type='text']");
    if( visible ) {
        $inputBox.val("");
        $inputBox.removeClass("error");
        $footer.addClass("showingForm");
        $inputBox.focus();
    } else {
        $inputBox.blur();
        $inputBox.removeClass("error");
        $footer.removeClass("showingForm");
    }
}

function toggle(id, buttonId){
    debugTrace("navView.toggle", id, buttonId);

    var $button = $("#toolbar " + buttonId);
    var $thisPanel = $(id);

    var columns =  2 - $(".nav-wrapper.hidden").length;
    if (columns > 0 && !$sidebarSplit.is(':animated'))
        sidebarWidth =  $sidebarSplit.position().left / columns; 

    

    if ($thisPanel.hasClass("hidden")) {
        columns++;
        $thisPanel.removeClass("hidden");
        if ($thisPanel.hasClass("hasFooter")) 
            $footer.removeClass("hidden");
        $button.addClass("selected");
    } else {
        columns--;
        $thisPanel.addClass("hidden");
        if ($thisPanel.hasClass("hasFooter")) 
            $footer.addClass("hidden"); 
        $button.removeClass("selected");     
    }

   
    if (columns == 0) {
        hideSidebar();
    } else { 
        showSidebar(columns);
   
    }

 
}



// Helper function that gets all the external function names from a list of InkFiles
function getExternals(file) {
    return file.symbols.getCachedExternals();
}

exports.NavView = Object.assign(NavView, {
    setMainInkFilename: setMainInkFilename,
    setFiles: setFiles,
    refreshFileStates: refreshFileStates,
    setErrorFiles: setErrorFiles,
    setKnots: setKnots,
    setKnotsDebounced: setKnotsDebounced,
    updateCurrentKnot: updateCurrentKnot,
    highlightRelativePath: highlightRelativePath,
    hide: hideSidebar,
    show: showSidebar,
    initialShow: () => { if( !hasBeenShown ) 
        toggle("#file-nav-wrapper");
    },
    toggle: toggle,
    showAddIncludeForm: () => setIncludeFormVisible(true),
    startRenameFile: startRenameFile,
    removeContextMenu: removeContextMenu
})

