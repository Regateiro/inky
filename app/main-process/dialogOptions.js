// Renderer-supplied options are not trusted to shape main-process dialog
// calls: only a safe whitelist of plain values is forwarded to the native
// save dialog. Unknown keys (window objects, callbacks, webContents,
// platform-specific extras) and malformed values are dropped.

const allowedStringKeys = ["title", "message", "buttonLabel", "defaultPath"];

function sanitizeSaveDialogOptions(options) {
    if( !options || typeof options != "object" )
        return {};

    var clean = {};

    for( var key of allowedStringKeys ) {
        if( typeof options[key] == "string" )
            clean[key] = options[key];
    }

    // filters: an array of { name: string, extensions: string[] }
    if( Array.isArray(options.filters) ) {
        var filters = options.filters.filter(f =>
            f && typeof f == "object" && typeof f.name == "string" && Array.isArray(f.extensions));
        if( filters.length > 0 ) {
            clean.filters = filters.map(f => ({
                name: f.name,
                extensions: f.extensions.map(e => String(e))
            }));
        }
    }

    // properties: an array of known string values
    if( Array.isArray(options.properties) )
        clean.properties = options.properties.filter(p => typeof p == "string");

    return clean;
}

exports.sanitizeSaveDialogOptions = sanitizeSaveDialogOptions;
