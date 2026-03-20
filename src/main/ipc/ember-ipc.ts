/**
 * Single-channel 'ember' IPC dispatcher.
 *
 * Registers one ipcMain.handle('ember', ...) handler that dispatches to all
 * Signal Protocol and auth sub-commands. Binary data crosses the boundary as
 * base64 strings; the dispatcher converts to/from Uint8Array before calling
 * the SignalDatabase.
 *
 * Crypto commands (ProcessPreKeyBundle, Encrypt, etc.) are implemented via
 * libsignal store adapters that bridge the SignalDatabase to native types.
 */

import { ipcMain, safeStorage } from 'electron';
import Store from 'electron-store';
import type { SignalDatabase } from '../signal-db';
import { createLogger } from '../logger';
import type { StoreSchema, AuthData as LocalAuthData } from '../../shared/types/index';
import type {
  EmberCmd,
  EmberIpcMessage,
  EmberIpcResponse,
  GetAuthArgs,
  GetAuthData,
  GetSafeStorageArgs,
  GetSafeStorageData,
  SetSafeStorageArgs,
  DeleteSafeStorageArgs,
  LogArgs,
  StoreSessionArgs,
  LoadSessionArgs,
  LoadSessionData,
  RemoveSessionArgs,
  StoreIdentityArgs,
  StoreIdentityData,
  LoadIdentityArgs,
  LoadIdentityData,
  StorePreKeyArgs,
  LoadPreKeyArgs,
  LoadPreKeyData,
  RemovePreKeyArgs,
  StoreSignedPreKeyArgs,
  LoadSignedPreKeyArgs,
  LoadSignedPreKeyData,
  StoreSenderKeyArgs,
  LoadSenderKeyArgs,
  LoadSenderKeyData,
  StoreLegacyEmberKeyArgs,
  LoadLegacyEmberKeyArgs,
  LoadLegacyEmberKeyData,
  StoreDistributionIdArgs,
  LoadDistributionIdArgs,
  LoadDistributionIdData,
  ProcessPreKeyBundleArgs,
  EncryptArgs,
  EncryptData,
  DecryptArgs,
  DecryptData,
  DecryptPreKeyArgs,
  GroupEncryptArgs,
  GroupEncryptData,
  GroupDecryptArgs,
  GroupDecryptData,
  CreateSenderKeyDistributionArgs,
  CreateSenderKeyDistributionData,
  ProcessSenderKeyDistributionArgs,
} from 'ember-shared';
import {
  encryptSignalMessage,
  decryptSignalMessage,
  createSenderKeyDistribution,
  processSenderKeyDistribution,
  groupEncryptMessage,
  groupDecryptMessage,
} from 'ember-shared';
import {
  ProtocolAddress,
  PublicKey,
  PreKeyBundle as LibSignalPreKeyBundle,
  CiphertextMessageType,
  processPreKeyBundle,
} from '@signalapp/libsignal-client';
import type { Uuid } from '@signalapp/libsignal-client';
import {
  SignalDbSessionStore,
  SignalDbIdentityKeyStore,
  SignalDbPreKeyStore,
  SignalDbSignedPreKeyStore,
  SignalDbKyberPreKeyStore,
  SignalDbSenderKeyStore,
} from '../signal-store-adapters';

// ── Constants ─────────────────────────────────────────────────────────────────

const KNOWN_CMDS: Set<EmberCmd> = new Set<EmberCmd>([
  // Auth / device identity
  'GetAuth',
  'GetSafeStorage',
  'SetSafeStorage',
  'DeleteSafeStorage',
  // Logging
  'Log',
  // Signal store operations
  'StoreSession',
  'LoadSession',
  'RemoveSession',
  'StoreIdentity',
  'LoadIdentity',
  'StorePreKey',
  'LoadPreKey',
  'RemovePreKey',
  'StoreSignedPreKey',
  'LoadSignedPreKey',
  'StoreSenderKey',
  'LoadSenderKey',
  'StoreDistributionId',
  'LoadDistributionId',
  'StoreLegacyEmberKey',
  'LoadLegacyEmberKey',
  // Signal crypto operations
  'ProcessPreKeyBundle',
  'Encrypt',
  'DecryptPreKey',
  'Decrypt',
  'GroupEncrypt',
  'GroupDecrypt',
  'CreateSenderKeyDistribution',
  'ProcessSenderKeyDistribution',
]);

// ── Store instance ────────────────────────────────────────────────────────────

const store = new Store<StoreSchema>();

// ── Auth handlers ─────────────────────────────────────────────────────────────

function handleGetAuth(_args: GetAuthArgs): GetAuthData | null {
  const auth: LocalAuthData | undefined = store.get('auth');
  if (!auth) return null;

  if (!auth.token || !auth.user_id || !auth.device_id || !auth.hostname || !auth.username) {
    return null;
  }

  return {
    token: auth.token,
    userId: auth.user_id,
    deviceId: auth.device_id,
    hostname: auth.hostname,
    username: auth.username,
  };
}

function handleGetSafeStorage(args: GetSafeStorageArgs): GetSafeStorageData {
  const storeKey = `safeStorage_${args.key}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stored = (store as any).get(storeKey) as string | undefined;
  if (stored === undefined || stored === null) {
    return { value: null };
  }
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const buf = Buffer.from(stored, 'base64');
      return { value: safeStorage.decryptString(buf) };
    }
    return { value: stored };
  } catch {
    return { value: null };
  }
}

function handleSetSafeStorage(args: SetSafeStorageArgs): void {
  const storeKey = `safeStorage_${args.key}`;
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(args.value);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (store as any).set(storeKey, encrypted.toString('base64'));
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (store as any).set(storeKey, args.value);
  }
}

function handleDeleteSafeStorage(args: DeleteSafeStorageArgs): void {
  const storeKey = `safeStorage_${args.key}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (store as any).delete(storeKey);
}

function handleLog(args: LogArgs): void {
  const rendererLog = createLogger(`Renderer:${args.context}`);
  let data: Record<string, unknown> | undefined;
  if (args.data) {
    try {
      data = JSON.parse(args.data) as Record<string, unknown>;
    } catch {
      data = { raw: args.data };
    }
  }
  switch ((args.level ?? 'info').toLowerCase()) {
    case 'debug':
      rendererLog.debug(args.message, data);
      break;
    case 'warn':
      rendererLog.warn(args.message, data);
      break;
    case 'error':
      rendererLog.error(args.message, data);
      break;
    default:
      rendererLog.info(args.message, data);
  }
}

// ── Signal store handlers ─────────────────────────────────────────────────────

async function handleStoreSession(db: SignalDatabase, args: StoreSessionArgs): Promise<void> {
  await db.storeSession(args.address, Buffer.from(args.record, 'base64'));
}

async function handleLoadSession(db: SignalDatabase, args: LoadSessionArgs): Promise<LoadSessionData> {
  const result = await db.loadSession(args.address);
  return { record: result ? Buffer.from(result).toString('base64') : null };
}

async function handleRemoveSession(db: SignalDatabase, args: RemoveSessionArgs): Promise<void> {
  await db.removeSession(args.address);
}

async function handleStoreIdentity(db: SignalDatabase, args: StoreIdentityArgs): Promise<StoreIdentityData> {
  const changed = await db.saveIdentity(args.address, Buffer.from(args.identityKey, 'base64'));
  return { changed };
}

async function handleLoadIdentity(db: SignalDatabase, args: LoadIdentityArgs): Promise<LoadIdentityData> {
  const result = await db.getIdentity(args.address);
  return { identityKey: result ? Buffer.from(result).toString('base64') : null };
}

async function handleStorePreKey(db: SignalDatabase, args: StorePreKeyArgs): Promise<void> {
  await db.storePreKey(args.id, Buffer.from(args.record, 'base64'));
}

async function handleLoadPreKey(db: SignalDatabase, args: LoadPreKeyArgs): Promise<LoadPreKeyData> {
  const result = await db.loadPreKey(args.id);
  return { record: result ? Buffer.from(result).toString('base64') : null };
}

async function handleRemovePreKey(db: SignalDatabase, args: RemovePreKeyArgs): Promise<void> {
  await db.removePreKey(args.id);
}

async function handleStoreSignedPreKey(db: SignalDatabase, args: StoreSignedPreKeyArgs): Promise<void> {
  await db.storeSignedPreKey(args.id, Buffer.from(args.record, 'base64'));
}

async function handleLoadSignedPreKey(db: SignalDatabase, args: LoadSignedPreKeyArgs): Promise<LoadSignedPreKeyData> {
  const result = await db.loadSignedPreKey(args.id);
  return { record: result ? Buffer.from(result).toString('base64') : null };
}

async function handleStoreSenderKey(db: SignalDatabase, args: StoreSenderKeyArgs): Promise<void> {
  await db.saveSenderKey(args.address, args.distributionId, Buffer.from(args.record, 'base64'));
}

async function handleLoadSenderKey(db: SignalDatabase, args: LoadSenderKeyArgs): Promise<LoadSenderKeyData> {
  const result = await db.getSenderKey(args.address, args.distributionId);
  return { record: result ? Buffer.from(result).toString('base64') : null };
}

function handleStoreDistributionId(db: SignalDatabase, args: StoreDistributionIdArgs): void {
  db.storeDistributionId(args.address, args.distributionId);
}

function handleLoadDistributionId(db: SignalDatabase, args: LoadDistributionIdArgs): LoadDistributionIdData {
  const result = db.loadDistributionId(args.address);
  return { distribution_id: result };
}

function handleStoreLegacyEmberKey(db: SignalDatabase, args: StoreLegacyEmberKeyArgs): void {
  db.storeLegacyEmberKey(args.emberId, Buffer.from(args.key, 'base64'));
}

function handleLoadLegacyEmberKey(db: SignalDatabase, args: LoadLegacyEmberKeyArgs): LoadLegacyEmberKeyData {
  const result = db.loadLegacyEmberKey(args.emberId);
  return { key: result ? Buffer.from(result).toString('base64') : null };
}

// ── Signal crypto handlers ────────────────────────────────────────────────────

const log = createLogger('EmberIPC');

function getLocalAddress(): ProtocolAddress {
  const auth: LocalAuthData | undefined = store.get('auth');
  if (!auth?.user_id || !auth?.device_id) {
    throw new Error('Not authenticated — cannot determine local address');
  }
  return ProtocolAddress.new(`${auth.user_id}.${auth.device_id}`, 1);
}

function buildSignalStores(db: SignalDatabase) {
  return {
    sessionStore: new SignalDbSessionStore(db),
    identityStore: new SignalDbIdentityKeyStore(db),
    preKeyStore: new SignalDbPreKeyStore(db),
    signedPreKeyStore: new SignalDbSignedPreKeyStore(db),
    kyberPreKeyStore: new SignalDbKyberPreKeyStore(db),
  };
}

async function handleProcessPreKeyBundle(db: SignalDatabase, args: ProcessPreKeyBundleArgs): Promise<void> {
  const stores = buildSignalStores(db);
  const recipientAddress = ProtocolAddress.new(args.recipientAddress, 1);
  const identityKey = PublicKey.deserialize(Buffer.from(args.identityKey, 'base64'));
  const signedPreKey = PublicKey.deserialize(Buffer.from(args.signedPreKey, 'base64'));
  const signedPreKeySignature = Buffer.from(args.signedPreKeySignature, 'base64');
  const preKey = args.preKey ? PublicKey.deserialize(Buffer.from(args.preKey, 'base64')) : null;
  const bundle = LibSignalPreKeyBundle.new(
    args.registrationId,
    args.deviceId,
    args.preKeyId ?? null,
    preKey,
    args.signedPreKeyId,
    signedPreKey,
    signedPreKeySignature,
    identityKey,
    // Kyber PQ prekey fields — not provided via IPC; native binding accepts null.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    null as any, null as any, null as any,
  );
  await processPreKeyBundle(
    bundle,
    recipientAddress,
    stores.sessionStore,
    stores.identityStore,
  );
  log.info('Signal session established', { recipient: args.recipientAddress });
}

async function handleEncrypt(db: SignalDatabase, args: EncryptArgs): Promise<EncryptData> {
  const stores = buildSignalStores(db);
  const recipientAddress = ProtocolAddress.new(args.recipientAddress, 1);
  const plaintext = Buffer.from(args.plaintext, 'base64');
  const result = await encryptSignalMessage(new Uint8Array(plaintext), recipientAddress, stores);
  return {
    ciphertext: Buffer.from(result.ciphertext).toString('base64'),
    messageType: result.type,
  };
}

async function handleDecryptPreKey(db: SignalDatabase, args: DecryptPreKeyArgs): Promise<DecryptData> {
  const stores = buildSignalStores(db);
  const senderAddress = ProtocolAddress.new(args.senderAddress, 1);
  const ciphertext = Buffer.from(args.ciphertext, 'base64');
  const msg = {
    ciphertext: new Uint8Array(ciphertext),
    type: CiphertextMessageType.PreKey,
    senderDeviceId: senderAddress.deviceId().toString(),
    senderRegistrationId: 0,
  };
  const plaintext = await decryptSignalMessage(msg, senderAddress, stores);
  return { plaintext: Buffer.from(plaintext).toString('base64') };
}

async function handleDecryptWhisper(db: SignalDatabase, args: DecryptArgs): Promise<DecryptData> {
  const stores = buildSignalStores(db);
  const senderAddress = ProtocolAddress.new(args.senderAddress, 1);
  const ciphertext = Buffer.from(args.ciphertext, 'base64');
  const msg = {
    ciphertext: new Uint8Array(ciphertext),
    type: CiphertextMessageType.Whisper,
    senderDeviceId: senderAddress.deviceId().toString(),
    senderRegistrationId: 0,
  };
  const plaintext = await decryptSignalMessage(msg, senderAddress, stores);
  return { plaintext: Buffer.from(plaintext).toString('base64') };
}

async function handleGroupEncrypt(db: SignalDatabase, args: GroupEncryptArgs): Promise<GroupEncryptData> {
  const senderKeyStore = new SignalDbSenderKeyStore(db);
  const localAddress = getLocalAddress();
  const plaintext = Buffer.from(args.plaintext, 'base64');
  const ciphertext = await groupEncryptMessage(
    localAddress,
    args.distributionId as unknown as Uuid,
    new Uint8Array(plaintext),
    senderKeyStore,
  );
  return { ciphertext: Buffer.from(ciphertext).toString('base64') };
}

async function handleGroupDecrypt(db: SignalDatabase, args: GroupDecryptArgs): Promise<GroupDecryptData> {
  const senderKeyStore = new SignalDbSenderKeyStore(db);
  const senderAddress = ProtocolAddress.new(args.senderAddress, 1);
  const ciphertext = Buffer.from(args.ciphertext, 'base64');
  const plaintext = await groupDecryptMessage(senderAddress, new Uint8Array(ciphertext), senderKeyStore);
  return { plaintext: Buffer.from(plaintext).toString('base64') };
}

async function handleCreateSenderKeyDistribution(
  db: SignalDatabase,
  args: CreateSenderKeyDistributionArgs,
): Promise<CreateSenderKeyDistributionData> {
  const senderKeyStore = new SignalDbSenderKeyStore(db);
  const localAddress = getLocalAddress();
  const distributionBytes = await createSenderKeyDistribution(
    localAddress,
    args.distributionId as unknown as Uuid,
    senderKeyStore,
  );
  log.info('Sender key distribution created', { distributionId: args.distributionId });
  return { distributionMessage: Buffer.from(distributionBytes).toString('base64') };
}

async function handleProcessSenderKeyDistribution(
  db: SignalDatabase,
  args: ProcessSenderKeyDistributionArgs,
): Promise<void> {
  const senderKeyStore = new SignalDbSenderKeyStore(db);
  const senderAddress = ProtocolAddress.new(args.senderAddress, 1);
  const distributionMessage = Buffer.from(args.distributionMessage, 'base64');
  await processSenderKeyDistribution(senderAddress, new Uint8Array(distributionMessage), senderKeyStore);
  log.info('Sender key distribution processed', { sender: args.senderAddress });
}

// ── Core dispatcher ───────────────────────────────────────────────────────────

/**
 * Dispatch a validated command to the appropriate handler.
 * Exported for testing — allows the test suite to call it directly without
 * needing an Electron IPC runtime.
 */
export async function dispatchEmberCmd(
  msg: unknown,
  db: SignalDatabase | null,
): Promise<EmberIpcResponse<unknown>> {
  // 1. Validate shape
  if (
    !msg ||
    typeof msg !== 'object' ||
    typeof (msg as Record<string, unknown>).cmd !== 'string' ||
    typeof (msg as Record<string, unknown>).args !== 'object' ||
    (msg as Record<string, unknown>).args === null
  ) {
    return { success: false, error: 'Invalid message format' };
  }

  const { cmd, args } = msg as EmberIpcMessage;

  // 2. Validate cmd is known
  if (!KNOWN_CMDS.has(cmd)) {
    return { success: false, error: 'Unknown command' };
  }

  // 3. Dispatch
  try {
    const result = await dispatch(cmd, args as Record<string, unknown>, db);
    return { success: true, data: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Strip key material from error messages:
    //  - standard base64 (A-Z, a-z, 0-9, +, /)
    //  - URL-safe base64 (uses - and _ instead of + and /)
    //  - hex-encoded buffers (64 lower-hex chars for a 32-byte key)
    const sanitised = message
      .replace(/[A-Za-z0-9+/]{20,}={0,2}/g, '[REDACTED]')
      .replace(/[A-Za-z0-9\-_]{20,}/g, '[REDACTED]')
      .replace(/[0-9a-f]{40,}/g, '[REDACTED]');
    return { success: false, error: sanitised };
  }
}

async function dispatch(
  cmd: EmberCmd,
  args: Record<string, unknown>,
  db: SignalDatabase | null,
): Promise<unknown> {
  switch (cmd) {
    // Auth
    case 'GetAuth':
      return handleGetAuth(args as GetAuthArgs);
    case 'GetSafeStorage':
      return handleGetSafeStorage(args as unknown as GetSafeStorageArgs);
    case 'SetSafeStorage':
      handleSetSafeStorage(args as unknown as SetSafeStorageArgs);
      return undefined;
    case 'DeleteSafeStorage':
      handleDeleteSafeStorage(args as unknown as DeleteSafeStorageArgs);
      return undefined;
    // Logging
    case 'Log':
      handleLog(args as unknown as LogArgs);
      return undefined;
    // Signal store
    case 'StoreSession':
      await handleStoreSession(requireDb(db), args as unknown as StoreSessionArgs);
      return undefined;
    case 'LoadSession':
      return handleLoadSession(requireDb(db), args as unknown as LoadSessionArgs);
    case 'RemoveSession':
      await handleRemoveSession(requireDb(db), args as unknown as RemoveSessionArgs);
      return undefined;
    case 'StoreIdentity':
      return handleStoreIdentity(requireDb(db), args as unknown as StoreIdentityArgs);
    case 'LoadIdentity':
      return handleLoadIdentity(requireDb(db), args as unknown as LoadIdentityArgs);
    case 'StorePreKey':
      await handleStorePreKey(requireDb(db), args as unknown as StorePreKeyArgs);
      return undefined;
    case 'LoadPreKey':
      return handleLoadPreKey(requireDb(db), args as unknown as LoadPreKeyArgs);
    case 'RemovePreKey':
      await handleRemovePreKey(requireDb(db), args as unknown as RemovePreKeyArgs);
      return undefined;
    case 'StoreSignedPreKey':
      await handleStoreSignedPreKey(requireDb(db), args as unknown as StoreSignedPreKeyArgs);
      return undefined;
    case 'LoadSignedPreKey':
      return handleLoadSignedPreKey(requireDb(db), args as unknown as LoadSignedPreKeyArgs);
    case 'StoreSenderKey':
      await handleStoreSenderKey(requireDb(db), args as unknown as StoreSenderKeyArgs);
      return undefined;
    case 'LoadSenderKey':
      return handleLoadSenderKey(requireDb(db), args as unknown as LoadSenderKeyArgs);
    case 'StoreDistributionId':
      handleStoreDistributionId(requireDb(db), args as unknown as StoreDistributionIdArgs);
      return undefined;
    case 'LoadDistributionId':
      return handleLoadDistributionId(requireDb(db), args as unknown as LoadDistributionIdArgs);
    case 'StoreLegacyEmberKey':
      handleStoreLegacyEmberKey(requireDb(db), args as unknown as StoreLegacyEmberKeyArgs);
      return undefined;
    case 'LoadLegacyEmberKey':
      return handleLoadLegacyEmberKey(requireDb(db), args as unknown as LoadLegacyEmberKeyArgs);
    // Signal crypto operations
    case 'ProcessPreKeyBundle':
      await handleProcessPreKeyBundle(requireDb(db), args as unknown as ProcessPreKeyBundleArgs);
      return undefined;
    case 'Encrypt':
      return handleEncrypt(requireDb(db), args as unknown as EncryptArgs);
    case 'DecryptPreKey':
      return handleDecryptPreKey(requireDb(db), args as unknown as DecryptPreKeyArgs);
    case 'Decrypt':
      return handleDecryptWhisper(requireDb(db), args as unknown as DecryptArgs);
    case 'GroupEncrypt':
      return handleGroupEncrypt(requireDb(db), args as unknown as GroupEncryptArgs);
    case 'GroupDecrypt':
      return handleGroupDecrypt(requireDb(db), args as unknown as GroupDecryptArgs);
    case 'CreateSenderKeyDistribution':
      return handleCreateSenderKeyDistribution(requireDb(db), args as unknown as CreateSenderKeyDistributionArgs);
    case 'ProcessSenderKeyDistribution':
      await handleProcessSenderKeyDistribution(requireDb(db), args as unknown as ProcessSenderKeyDistributionArgs);
      return undefined;
    default:
      return undefined;
  }
}

function requireDb(db: SignalDatabase | null): SignalDatabase {
  if (!db) {
    throw new Error('Signal database not available');
  }
  return db;
}

// ── IPC registration ──────────────────────────────────────────────────────────

/**
 * Register the single 'ember' IPC channel handler in the main process.
 * Must be called once during app startup after the Signal database is ready.
 *
 * @param db - Initialised SignalDatabase, or null if unavailable.
 */
export function registerEmberIpcHandlers(db: SignalDatabase | null): void {
  ipcMain.handle('ember', async (_event, msg: unknown) => {
    return dispatchEmberCmd(msg, db);
  });
}
