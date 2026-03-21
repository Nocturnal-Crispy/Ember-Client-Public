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

import { ipcMain } from 'electron';
import Store from 'electron-store';
import type { SignalDatabase } from '../signal-db';
import { createLogger } from '../logger';
import { electronSafeStorageFunctions } from '../auth-safe-storage';
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
  RemoveSignedPreKeyArgs,
  StoreSenderKeyArgs,
  LoadSenderKeyArgs,
  LoadSenderKeyData,
  StoreDistributionIdArgs,
  LoadDistributionIdArgs,
  LoadDistributionIdData,
  LoadKyberPreKeyArgs,
  LoadKyberPreKeyData,
  StoreKyberPreKeyArgs,
  MarkKyberPreKeyUsedArgs,
  RemoveKyberPreKeyArgs,
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
} from '../../shared';
import {
  encryptSignalMessage,
  decryptSignalMessage,
  createSenderKeyDistribution,
  processSenderKeyDistribution,
  groupEncryptMessage,
  groupDecryptMessage,
} from '../../shared';
import {
  ProtocolAddress,
  PublicKey,
  PrivateKey,
  PreKeyBundle as LibSignalPreKeyBundle,
  CiphertextMessageType,
  processPreKeyBundle,
  KEMKeyPair,
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
  'RemoveSignedPreKey',
  'StoreSenderKey',
  'LoadSenderKey',
  'StoreDistributionId',
  'LoadDistributionId',
  // Kyber pre-key operations
  'LoadKyberPreKey',
  'StoreKyberPreKey',
  'MarkKyberPreKeyUsed',
  'RemoveKyberPreKey',
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

async function handleGetSafeStorage(args: GetSafeStorageArgs): Promise<GetSafeStorageData> {
  const value = await electronSafeStorageFunctions.getSafeStorage(args.key);
  return { value };
}

async function handleSetSafeStorage(args: SetSafeStorageArgs): Promise<void> {
  await electronSafeStorageFunctions.setSafeStorage(args.key, args.value);
}

async function handleDeleteSafeStorage(args: DeleteSafeStorageArgs): Promise<void> {
  await electronSafeStorageFunctions.deleteSafeStorage(args.key);
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

async function handleRemoveSignedPreKey(db: SignalDatabase, args: RemoveSignedPreKeyArgs): Promise<void> {
  await db.removeSignedPreKey(args.id);
}

async function handleStoreSenderKey(db: SignalDatabase, args: StoreSenderKeyArgs): Promise<void> {
  // CRITICAL FIX: Validate input data before processing
  if (!args.address || typeof args.address !== 'string') {
    throw new Error('Invalid address: must be non-empty string');
  }
  if (!args.distributionId || typeof args.distributionId !== 'string') {
    throw new Error('Invalid distributionId: must be non-empty string');
  }
  if (!args.record || typeof args.record !== 'string') {
    throw new Error('Invalid record: must be base64 string');
  }
  
  // Validate base64 format
  try {
    const decoded = Buffer.from(args.record, 'base64');
    if (decoded.length === 0) {
      throw new Error('Invalid record: empty after base64 decode');
    }
    // Store as Buffer (safe conversion)
    await db.saveSenderKey(args.address, args.distributionId, decoded);
  } catch (error) {
    if (error instanceof Error && error.message.includes('base64')) {
      throw new Error(`Invalid base64 in sender key record: ${error.message}`);
    }
    throw error;
  }
}

async function handleLoadSenderKey(db: SignalDatabase, args: LoadSenderKeyArgs): Promise<LoadSenderKeyData> {
  // CRITICAL FIX: Validate input parameters
  if (!args.address || typeof args.address !== 'string') {
    throw new Error('Invalid address: must be non-empty string');
  }
  if (!args.distributionId || typeof args.distributionId !== 'string') {
    throw new Error('Invalid distributionId: must be non-empty string');
  }
  
  const result = await db.getSenderKey(args.address, args.distributionId);
  
  // CRITICAL FIX: Validate result before base64 encoding
  if (!result) {
    return { record: null };
  }
  
  if (!(result instanceof Uint8Array)) {
    throw new Error('Invalid sender key data type from database');
  }
  
  if (result.length === 0) {
    return { record: null }; // Empty record is treated as not found
  }
  
  // Safe conversion to base64 string
  try {
    return { record: Buffer.from(result).toString('base64') };
  } catch (error) {
    throw new Error(`Failed to encode sender key to base64: ${error}`);
  }
}

function handleStoreDistributionId(db: SignalDatabase, args: StoreDistributionIdArgs): void {
  db.storeDistributionId(args.address, args.distributionId);
}

function handleLoadDistributionId(db: SignalDatabase, args: LoadDistributionIdArgs): LoadDistributionIdData {
  const result = db.loadDistributionId(args.address);
  return { distributionId: result };
}

// ── Kyber pre-key handlers (scaffolding only) ───────────────────────────────────

async function handleLoadKyberPreKey(db: SignalDatabase, args: LoadKyberPreKeyArgs): Promise<LoadKyberPreKeyData> {
  const result = await db.loadKyberPreKey(args.id);
  return { record: result ? Buffer.from(result).toString('base64') : null };
}

async function handleStoreKyberPreKey(db: SignalDatabase, args: StoreKyberPreKeyArgs): Promise<void> {
  await db.storeKyberPreKey(args.id, Buffer.from(args.record, 'base64'));
}

async function handleMarkKyberPreKeyUsed(db: SignalDatabase, args: MarkKyberPreKeyUsedArgs): Promise<void> {
  await db.markKyberPreKeyUsed(args.id);
}

async function handleRemoveKyberPreKey(db: SignalDatabase, args: RemoveKyberPreKeyArgs): Promise<void> {
  await db.removeKyberPreKey(args.id);
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

  // Coerce numeric fields first — IPC serialization may deliver non-number types
  const registrationId = Number(args.registrationId) || 0;
  const deviceId = Number(args.deviceId) || 1;
  const signedPreKeyId = Number(args.signedPreKeyId);
  const preKeyId = args.preKeyId != null ? Number(args.preKeyId) : null;

  log.debug('ProcessPreKeyBundle args', {
    recipient: args.recipientAddress,
    registrationId,
    deviceId,
    signedPreKeyId,
    preKeyId,
    hasIdentityKey: typeof args.identityKey === 'string' && args.identityKey.length > 0,
    hasSignedPreKey: typeof args.signedPreKey === 'string' && args.signedPreKey.length > 0,
    hasSignedPreKeySignature: typeof args.signedPreKeySignature === 'string' && args.signedPreKeySignature.length > 0,
    hasPreKey: typeof args.preKey === 'string' && args.preKey.length > 0,
    rawTypes: {
      registrationId: typeof args.registrationId,
      deviceId: typeof args.deviceId,
      signedPreKeyId: typeof args.signedPreKeyId,
      preKeyId: typeof args.preKeyId,
    },
  });

  if (!Number.isFinite(signedPreKeyId)) {
    throw new Error(`Invalid signedPreKeyId: ${String(args.signedPreKeyId)} (type: ${typeof args.signedPreKeyId})`);
  }
  if (!args.identityKey) {
    throw new Error('Missing identityKey in ProcessPreKeyBundle args');
  }
  if (!args.signedPreKey) {
    throw new Error('Missing signedPreKey in ProcessPreKeyBundle args');
  }
  if (!args.signedPreKeySignature) {
    throw new Error('Missing signedPreKeySignature in ProcessPreKeyBundle args');
  }

  const recipientAddress = ProtocolAddress.new(args.recipientAddress, 1);
  const identityKey = PublicKey.deserialize(Buffer.from(args.identityKey, 'base64'));
  const signedPreKey = PublicKey.deserialize(Buffer.from(args.signedPreKey, 'base64'));
  const signedPreKeySignature = Buffer.from(args.signedPreKeySignature, 'base64');
  const preKey = args.preKey ? PublicKey.deserialize(Buffer.from(args.preKey, 'base64')) : null;

  // libsignal v0.89+ requires Kyber PQ pre-key fields (non-nullable).
  // Generate an ephemeral Kyber keypair and sign it with the identity key
  // so that PreKeyBundle.new() succeeds. The Kyber key is not persisted
  // server-side yet; it only satisfies the bundle construction requirement.
  const kyberKeyPair = KEMKeyPair.generate();
  const kyberPublicKey = kyberKeyPair.getPublicKey();
  const localIdentityKey = await stores.identityStore.getIdentityKey();
  const kyberSignature = localIdentityKey.sign(new Uint8Array(kyberPublicKey.serialize()));
  const kyberPreKeyId = signedPreKeyId; // reuse signed pre-key ID as placeholder

  const bundle = LibSignalPreKeyBundle.new(
    registrationId,
    deviceId,
    preKeyId,
    preKey,
    signedPreKeyId,
    signedPreKey,
    signedPreKeySignature,
    identityKey,
    kyberPreKeyId,
    kyberPublicKey,
    new Uint8Array(kyberSignature),
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
      return await handleGetSafeStorage(args as unknown as GetSafeStorageArgs);
    case 'SetSafeStorage':
      await handleSetSafeStorage(args as unknown as SetSafeStorageArgs);
      return undefined;
    case 'DeleteSafeStorage':
      await handleDeleteSafeStorage(args as unknown as DeleteSafeStorageArgs);
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
    case 'RemoveSignedPreKey':
      await handleRemoveSignedPreKey(requireDb(db), args as unknown as RemoveSignedPreKeyArgs);
      return undefined;
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
    case 'LoadKyberPreKey':
      return handleLoadKyberPreKey(requireDb(db), args as unknown as LoadKyberPreKeyArgs);
    case 'StoreKyberPreKey':
      await handleStoreKyberPreKey(requireDb(db), args as unknown as StoreKyberPreKeyArgs);
      return undefined;
    case 'MarkKyberPreKeyUsed':
      await handleMarkKyberPreKeyUsed(requireDb(db), args as unknown as MarkKyberPreKeyUsedArgs);
      return undefined;
    case 'RemoveKyberPreKey':
      await handleRemoveKyberPreKey(requireDb(db), args as unknown as RemoveKyberPreKeyArgs);
      return undefined;
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

// Global database reference that can be updated without re-registering handlers
let currentSignalDb: SignalDatabase | null = null;

/**
 * Register the single 'ember' IPC handler.
 * Must be called once during app startup.
 */
export function registerEmberIpcHandlers(db: SignalDatabase | null): void {
  currentSignalDb = db;
  
  // Only register the handler once
  if (ipcMain.listenerCount('ember') === 0) {
    ipcMain.handle('ember', async (_event, msg: unknown) => {
      return dispatchEmberCmd(msg, currentSignalDb);
    });
  }
}

/**
 * Update the Signal database reference without re-registering IPC handlers.
 * This allows re-initialization of the database after login/registration.
 */
export function updateSignalDatabase(db: SignalDatabase | null): void {
  currentSignalDb = db;
}
