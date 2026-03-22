/**
 * Renderer-side logger — forwards logs to the main process terminal via IPC.
 * In development mode, also requests main process to write to ./logs directory.
 * Loaded before other renderer scripts so all modules can call window.emberLog.createLogger().
 */
(function (): void {
  'use strict';

  type LogLevel = 'debug' | 'info' | 'warn' | 'error';

  const LEVEL_RANKS: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };
  const MIN_LEVEL_RANK = 0; // 0 = debug, 1 = info, 2 = warn, 3 = error

  function ts(): string {
    const now = new Date();
    const p2 = (n: number): string => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())} ${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}`;
  }

  // Check if we're in development mode
  function isDevelopment(): boolean {
    return (
      window.location.protocol === 'file:' ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'
    );
  }

  function fmtData(data?: Record<string, unknown>): string {
    if (!data) return '';
    const parts = [];
    for (const [k, v] of Object.entries(data)) {
      const vs =
        v === null || v === undefined
          ? String(v)
          : typeof v === 'object'
            ? JSON.stringify(v)
            : String(v);
      parts.push(`${k}=${vs}`);
    }
    return parts.length ? ` { ${parts.join(', ')} }` : '';
  }

  function sendLog(
    level: LogLevel,
    context: string,
    message: string,
    data?: Record<string, unknown>
  ): void {
    if ((LEVEL_RANKS[level] ?? 0) < MIN_LEVEL_RANK) return;

    const payload = {
      level: level.toUpperCase(),
      context,
      message,
      data: data ?? null,
    };

    // Forward to main process for terminal output
    try {
      if (window.emberAPI) {
        window.emberAPI
          .invoke('Log', {
            level: payload.level,
            context: payload.context,
            message: payload.message,
            data: payload.data ? JSON.stringify(payload.data) : undefined,
          })
          .catch(() => {
            /* fire-and-forget */
          });
      } else if (window.electronAPI && window.electronAPI.ipc) {
        // Fallback for environments where emberAPI is not yet available
        window.electronAPI.ipc.send('log-to-console', payload);
      }
    } catch {
      /* silently ignore — IPC not yet available */
    }

    // Also mirror to browser DevTools and write to file in development
    const full = `[${ts()}] [${level.toUpperCase().padEnd(5)}] [${context}] ${message}${fmtData(data)}`;

    // In development, also request main process to write to file
    if (isDevelopment()) {
      try {
        window.electronAPI?.ipc?.send('log-to-file', full);
      } catch {
        // Ignore if file logging not available
      }
    }

    switch (level) {
      case 'debug':
        console.debug(full);
        break;
      case 'info':
        console.info(full);
        break;
      case 'warn':
        console.warn(full);
        break;
      case 'error':
        console.error(full);
        break;
      default:
        console.log(full);
    }
  }

  function createLogger(context: string): EmberLogger {
    return {
      debug: (msg: string, data?: Record<string, unknown>) => sendLog('debug', context, msg, data),
      info: (msg: string, data?: Record<string, unknown>) => sendLog('info', context, msg, data),
      warn: (msg: string, data?: Record<string, unknown>) => sendLog('warn', context, msg, data),
      error: (msg: string, data?: Record<string, unknown>) => sendLog('error', context, msg, data),
    };
  }

  window.emberLog = { createLogger };
})();
