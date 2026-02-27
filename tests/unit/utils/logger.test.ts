/**
 * Unit tests for src/renderer/utils/logger.ts
 *
 * The logger is an IIFE that assigns window.emberLog = { createLogger }.
 * We require() it after setting up a mock window.electronAPI so we can
 * verify that log calls are forwarded to the main process via IPC.
 */

let mockIpcSend: jest.Mock;

beforeAll(() => {
  mockIpcSend = jest.fn();
  (window as any).electronAPI = {
    ipc: { send: mockIpcSend, invoke: jest.fn(), on: jest.fn() },
    crypto: {},
    nacl: {},
    naclUtil: {},
  };
  // Load the IIFE — sets window.emberLog
  require('../../../src/renderer/utils/logger');
});

describe('createLogger', () => {
  it('returns an object with debug, info, warn, and error methods', () => {
    const log = (window as any).emberLog.createLogger('Test');
    expect(typeof log.debug).toBe('function');
    expect(typeof log.info).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
  });

  it('creates independent loggers for different contexts', () => {
    const log1 = (window as any).emberLog.createLogger('Ctx1');
    const log2 = (window as any).emberLog.createLogger('Ctx2');
    expect(log1).not.toBe(log2);
  });
});

describe('log level forwarding via IPC', () => {
  it('sends "log-to-console" for info level with correct payload shape', () => {
    const log = (window as any).emberLog.createLogger('TestCtx');
    log.info('hello world');
    expect(mockIpcSend).toHaveBeenCalledWith(
      'log-to-console',
      expect.objectContaining({
        level: 'INFO',
        context: 'TestCtx',
        message: 'hello world',
      })
    );
  });

  it('sends "log-to-console" for warn level', () => {
    const log = (window as any).emberLog.createLogger('WarnCtx');
    log.warn('something bad');
    expect(mockIpcSend).toHaveBeenCalledWith(
      'log-to-console',
      expect.objectContaining({ level: 'WARN', context: 'WarnCtx', message: 'something bad' })
    );
  });

  it('sends "log-to-console" for error level', () => {
    const log = (window as any).emberLog.createLogger('ErrCtx');
    log.error('fatal error');
    expect(mockIpcSend).toHaveBeenCalledWith(
      'log-to-console',
      expect.objectContaining({ level: 'ERROR', context: 'ErrCtx', message: 'fatal error' })
    );
  });

  it('sends "log-to-console" for debug level', () => {
    const log = (window as any).emberLog.createLogger('DbgCtx');
    log.debug('verbose detail');
    expect(mockIpcSend).toHaveBeenCalledWith(
      'log-to-console',
      expect.objectContaining({ level: 'DEBUG', context: 'DbgCtx', message: 'verbose detail' })
    );
  });

  it('includes data in the payload when provided', () => {
    const log = (window as any).emberLog.createLogger('DataCtx');
    log.info('with data', { key: 'value', count: 42 });
    expect(mockIpcSend).toHaveBeenCalledWith(
      'log-to-console',
      expect.objectContaining({
        data: { key: 'value', count: 42 },
      })
    );
  });

  it('sets data to null when not provided', () => {
    const log = (window as any).emberLog.createLogger('NoDataCtx');
    log.info('no data');
    expect(mockIpcSend).toHaveBeenCalledWith(
      'log-to-console',
      expect.objectContaining({ data: null })
    );
  });
});

describe('graceful degradation', () => {
  it('does not throw when window.electronAPI is unavailable', () => {
    // Temporarily remove electronAPI to simulate unavailable IPC
    const saved = (window as any).electronAPI;
    (window as any).electronAPI = undefined;
    const log = (window as any).emberLog.createLogger('NoBridge');
    expect(() => log.info('should not throw')).not.toThrow();
    (window as any).electronAPI = saved;
  });
});
