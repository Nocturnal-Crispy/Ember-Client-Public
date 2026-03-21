import * as util from "util";
import * as fs from "fs";
import * as path from "path";
import { app } from "electron";

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

// File logging for development
let logFileStream: fs.WriteStream | null = null;

function isDevelopmentMode(): boolean {
  return process.env.NODE_ENV !== 'production' || (app && !app.isPackaged);
}

function initializeFileLogging() {
  if (!isDevelopmentMode()) return;
  
  try {
    const logsDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    
    // Create timestamp-based filename for each app startup
    const now = new Date();
    const timestamp = now.toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .split('.')[0]; // Remove milliseconds
    const logFileName = `ember-client-${timestamp}.log`;
    const logFilePath = path.join(logsDir, logFileName);
    
    logFileStream = fs.createWriteStream(logFilePath, { flags: 'w' });
    
    // Write header when starting new session
    logFileStream.write(`=== Ember Client Started at ${new Date().toISOString()} ===\n`);
    
    // Ensure file is closed on exit
    process.on('exit', () => {
      if (logFileStream) {
        logFileStream.write(`\n=== Ember Client Session Ended at ${new Date().toISOString()} ===\n`);
        logFileStream.end();
      }
    });
    
  } catch (error) {
    console.warn('Failed to initialize file logging:', error);
  }
}

function writeToFile(content: string) {
  if (logFileStream) {
    try {
      logFileStream.write(content + '\n');
    } catch (error) {
      console.warn('Failed to write to log file:', error);
    }
  }
}

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

export function write(level: LogLevel, context: string, message: string, data?: Record<string, unknown>): void {
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
  
  // Write to console
  if (level >= LogLevel.ERROR) {
    process.stderr.write(logLine + "\n");
  } else {
    process.stdout.write(logLine + "\n");
  }
  
  // Write to file in development
  if (isDevelopmentMode()) {
    writeToFile(logLine);
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

// Export file logging functions for IPC handler
export { initializeFileLogging, writeToFile };

// Initialize file logging when module is loaded
initializeFileLogging();
