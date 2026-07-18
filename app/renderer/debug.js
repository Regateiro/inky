const DEBUG_ENABLED = process.argv.includes('--debug-log') || process.env.INKY_DEBUG === '1';

function debug(...args) {
    if (DEBUG_ENABLED) {
        console.log('[DEBUG]', ...args);
    }
}

function debugError(...args) {
    if (DEBUG_ENABLED) {
        console.error('[DEBUG ERROR]', ...args);
    }
}

function debugTrace(fnName, ...args) {
    if (DEBUG_ENABLED) {
        console.log('[TRACE]', fnName, ...args);
    }
}

exports.debug = debug;
exports.debugError = debugError;
exports.debugTrace = debugTrace;
exports.DEBUG_ENABLED = DEBUG_ENABLED;
