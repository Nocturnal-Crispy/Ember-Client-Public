import * as util from 'util';

export enum LogLevel {
  DEBUG = 0,
  INFO  = 1,
  WARN  = 2,
  ERROR = 3,
}

const C = {
  reset:     '\x1b[0m',
  dim:       '\x1b[2m',
  debug:     '\x1b[36m',  // cyan
  info:      '\x1b[32m',  // green
  warn:      '\x1b[33m',  // yellow
  error:     '\x1b[31m',  // red
  context:   '\x1b[35m',  // magenta
  timestamp: '\x1b[90m',  // gray
};

function formatTimestamp(): string {
  const now = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  const p3 = (n: number) => String(n).padStart(3, '0');
  return `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())} ` +
         `${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}.${p3(now.getMilliseconds())}`;
}

function levelLabel(level: LogLevel): string {
  switch (level) {
    case LogLevel.DEBUG: return 'DEBUG';
    case LogLevel.INFO:  return 'INFO ';
    case LogLevel.WARN:  return 'WARN ';
    case LogLevel.ERROR: return 'ERROR';
  }
}

function levelColor(level: LogLevel): string {
  switch (level) {
    case LogLevel.DEBUG: return C.debug;
    case LogLevel.INFO:  return C.info;
    case LogLevel.WARN:  return C.warn;
    case LogLevel.ERROR: return C.error;
  }
}

const minLevel: LogLevel = LogLevel.DEBUG;

function write(level: LogLevel, context: string, message: string, data?: Record<string, unknown>): void {
  if (level < minLevel) return;
  const lc = levelColor(level);
  const ll = levelLabel(level);
  let line = `${C.timestamp}[${formatTimestamp()}]${C.reset} ${lc}[${ll}]${C.reset} ${C.context}[${context}]${C.reset} ${message}`;
  if (data && Object.keys(data).length > 0) {
    const parts = Object.entries(data)
      .map(([k, v]) => `${k}=${util.inspect(v, { breakLength: Infinity, compact: true })}`)
      .join(', ');
    line += ` ${C.dim}{ ${parts} }${C.reset}`;
  }
  if (level >= LogLevel.ERROR) {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export function createLogger(context: string): Logger {
  return {
    debug: (msg, data) => write(LogLevel.DEBUG, context, msg, data),
    info:  (msg, data) => write(LogLevel.INFO,  context, msg, data),
    warn:  (msg, data) => write(LogLevel.WARN,  context, msg, data),
    error: (msg, data) => write(LogLevel.ERROR, context, msg, data),
  };
}

