import * as util from "util";

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  debug: "\x1b[36m", // cyan
  info: "\x1b[32m", // green
  warn: "\x1b[33m", // yellow
  error: "\x1b[31m", // red
  context: "\x1b[35m", // magenta
  timestamp: "\x1b[90m", // gray
};

function formatTimestamp(): string {
  const currentTime = new Date();
  const padTwoDigits = (number: number) => String(number).padStart(2, "0");
  const padThreeDigits = (number: number) => String(number).padStart(3, "0");
  return (
    `${currentTime.getFullYear()}-${padTwoDigits(currentTime.getMonth() + 1)}-${padTwoDigits(currentTime.getDate())} ` +
    `${padTwoDigits(currentTime.getHours())}:${padTwoDigits(currentTime.getMinutes())}:${padTwoDigits(currentTime.getSeconds())}.${padThreeDigits(currentTime.getMilliseconds())}`
  );
}

function getLogLevelLabel(level: LogLevel): string {
  switch (level) {
    case LogLevel.DEBUG:
      return "DEBUG";
    case LogLevel.INFO:
      return "INFO ";
    case LogLevel.WARN:
      return "WARN ";
    case LogLevel.ERROR:
      return "ERROR";
  }
}

function getLogLevelColor(level: LogLevel): string {
  switch (level) {
    case LogLevel.DEBUG:
      return C.debug;
    case LogLevel.INFO:
      return C.info;
    case LogLevel.WARN:
      return C.warn;
    case LogLevel.ERROR:
      return C.error;
  }
}

const minLevel: LogLevel = LogLevel.DEBUG;

function write(
  level: LogLevel,
  context: string,
  message: string,
  data?: Record<string, unknown>
): void {
  if (level < minLevel) return;
  const levelColor = getLogLevelColor(level);
  const levelLabel = getLogLevelLabel(level);
  let logLine = `${C.timestamp}[${formatTimestamp()}]${C.reset} ${levelColor}[${levelLabel}]${C.reset} ${C.context}[${context}]${C.reset} ${message}`;
  if (data && Object.keys(data).length > 0) {
    const formattedData = Object.entries(data)
      .map(([key, value]) => `${key}=${util.inspect(value, { breakLength: Infinity, compact: true })}`)
      .join(", ");
    logLine += ` ${C.dim}{ ${formattedData} }${C.reset}`;
  }
  if (level >= LogLevel.ERROR) {
    process.stderr.write(logLine + "\n");
  } else {
    process.stdout.write(logLine + "\n");
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
    info: (msg, data) => write(LogLevel.INFO, context, msg, data),
    warn: (msg, data) => write(LogLevel.WARN, context, msg, data),
    error: (msg, data) => write(LogLevel.ERROR, context, msg, data),
  };
}
