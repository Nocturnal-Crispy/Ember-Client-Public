// Renderer-side logger — forwards logs to the main process terminal via IPC.
// Loaded before other renderer scripts so all modules can call window.emberLog.createLogger().
(function () {
  'use strict';

  const LEVEL_RANKS = { debug: 0, info: 1, warn: 2, error: 3 };
  const MIN_LEVEL_RANK = 0; // 0 = debug, 1 = info, 2 = warn, 3 = error

  function ts() {
    const now = new Date();
    const p2 = n => String(n).padStart(2, '0');
    const p3 = n => String(n).padStart(3, '0');
    return `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())} ` +
           `${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}.${p3(now.getMilliseconds())}`;
  }

  function fmtData(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return '';
    const parts = Object.entries(data).map(([k, v]) => {
      const vs = (v === null || v === undefined) ? String(v) :
                 (typeof v === 'object') ? JSON.stringify(v) : String(v);
      return `${k}=${vs}`;
    });
    return parts.length ? ` { ${parts.join(', ')} }` : '';
  }

  function sendLog(level, context, message, data) {
    if ((LEVEL_RANKS[level] || 0) < MIN_LEVEL_RANK) return;

    const payload = {
      level: level.toUpperCase(),
      context: context,
      message: message,
      data: data || null,
    };

    // Forward to main process for terminal output
    try {
      if (window.electronAPI && window.electronAPI.ipc) {
        window.electronAPI.ipc.send('log-to-console', payload);
      }
    } catch (_) { /* silently ignore — IPC not yet available */ }

    // Also mirror to browser DevTools (useful when devTools are enabled in dev builds)
    const full = `[${ts()}] [${level.toUpperCase().padEnd(5)}] [${context}] ${message}${fmtData(data)}`;
    switch (level) {
      case 'debug': console.debug(full); break;
      case 'info':  console.info(full);  break;
      case 'warn':  console.warn(full);  break;
      case 'error': console.error(full); break;
      default:      console.log(full);
    }
  }

  function createLogger(context) {
    return {
      debug: function (msg, data) { sendLog('debug', context, msg, data); },
      info:  function (msg, data) { sendLog('info',  context, msg, data); },
      warn:  function (msg, data) { sendLog('warn',  context, msg, data); },
      error: function (msg, data) { sendLog('error', context, msg, data); },
    };
  }

  window.emberLog = { createLogger: createLogger };
}());
