/**
 * Adapters that bridge the SQLite-backed SignalDatabase (string keys,
 * Uint8Array records) to the native abstract store classes required by
 * @signalapp/libsignal-client crypto operations.
 *
 * Each adapter extends the corresponding libsignal abstract class and
 * delegates persistence to the SignalDatabase instance.
 */

import {
  SessionStore,
  SessionRecord,
  ProtocolAddress,
  IdentityKeyStore,
  PrivateKey,
  PublicKey,
  Direction,
  IdentityChange,
  PreKeyStore,
  PreKeyRecord,
  SignedPreKeyStore,
  SignedPreKeyRecord,
  KyberPreKeyStore,
  KyberPreKeyRecord,
  SenderKeyStore,
  SenderKeyRecord,
} from '@signalapp/libsignal-client';
import type { Uuid } from '@signalapp/libsignal-client';
import type { SignalDatabase } from './signal-db';

// ── Address helpers ──────────────────────────────────────────────────────────

function addrKey(addr: ProtocolAddress): string {
  return `${addr.name()}.${addr.deviceId()}`;
}

// ── Session store adapter ────────────────────────────────────────────────────

export class SignalDbSessionStore extends SessionStore {
  constructor(private readonly db: SignalDatabase) {
    super();
  }

  async saveSession(addr: ProtocolAddress, record: SessionRecord): Promise<void> {
    await this.db.storeSession(addrKey(addr), new Uint8Array(record.serialize()));
  }

  async getSession(addr: ProtocolAddress): Promise<SessionRecord | null> {
    const bytes = await this.db.loadSession(addrKey(addr));
    if (!bytes) return null;
    return SessionRecord.deserialize(Buffer.from(bytes));
  }

  async getExistingSessions(addresses: ProtocolAddress[]): Promise<SessionRecord[]> {
    const results: SessionRecord[] = [];
    for (const addr of addresses) {
      const record = await this.getSession(addr);
      if (record) results.push(record);
    }
    return results;
  }
}

// ── Identity key store adapter ───────────────────────────────────────────────

export class SignalDbIdentityKeyStore extends IdentityKeyStore {
  constructor(private readonly db: SignalDatabase) {
    super();
  }

  async getIdentityKey(): Promise<PrivateKey> {
    const keyPair = await this.db.getIdentityKeyPair();
    return PrivateKey.deserialize(Buffer.from(keyPair.privateKey));
  }

  async getLocalRegistrationId(): Promise<number> {
    return this.db.getLocalRegistrationId();
  }

  async saveIdentity(addr: ProtocolAddress, key: PublicKey): Promise<IdentityChange> {
    const changed = await this.db.saveIdentity(addrKey(addr), new Uint8Array(key.serialize()));
    return changed ? IdentityChange.ReplacedExisting : IdentityChange.NewOrUnchanged;
  }

  async isTrustedIdentity(
    addr: ProtocolAddress,
    key: PublicKey,
    direction: Direction
  ): Promise<boolean> {
    const dirStr = direction === Direction.Sending ? 'sending' : 'receiving';
    return this.db.isTrustedIdentity(addrKey(addr), new Uint8Array(key.serialize()), dirStr);
  }

  async getIdentity(addr: ProtocolAddress): Promise<PublicKey | null> {
    const bytes = await this.db.getIdentity(addrKey(addr));
    if (!bytes) return null;
    return PublicKey.deserialize(Buffer.from(bytes));
  }
}

// ── Pre-key store adapter ────────────────────────────────────────────────────

export class SignalDbPreKeyStore extends PreKeyStore {
  constructor(private readonly db: SignalDatabase) {
    super();
  }

  async savePreKey(id: number, record: PreKeyRecord): Promise<void> {
    await this.db.storePreKey(id, new Uint8Array(record.serialize()));
  }

  async getPreKey(id: number): Promise<PreKeyRecord> {
    const bytes = await this.db.loadPreKey(id);
    if (!bytes) throw new Error(`PreKey ${id} not found`);
    return PreKeyRecord.deserialize(Buffer.from(bytes));
  }

  async removePreKey(id: number): Promise<void> {
    await this.db.removePreKey(id);
  }
}

// ── Signed pre-key store adapter ─────────────────────────────────────────────

export class SignalDbSignedPreKeyStore extends SignedPreKeyStore {
  constructor(private readonly db: SignalDatabase) {
    super();
  }

  async saveSignedPreKey(id: number, record: SignedPreKeyRecord): Promise<void> {
    await this.db.storeSignedPreKey(id, new Uint8Array(record.serialize()));
  }

  async getSignedPreKey(id: number): Promise<SignedPreKeyRecord> {
    const bytes = await this.db.loadSignedPreKey(id);
    if (!bytes) throw new Error(`SignedPreKey ${id} not found`);
    return SignedPreKeyRecord.deserialize(Buffer.from(bytes));
  }
}

// ── Kyber pre-key store adapter ──────────────────────────────────────────────

export class SignalDbKyberPreKeyStore extends KyberPreKeyStore {
  constructor(private readonly db: SignalDatabase) {
    super();
  }

  async saveKyberPreKey(id: number, record: KyberPreKeyRecord): Promise<void> {
    await this.db.storeKyberPreKey(id, new Uint8Array(record.serialize()));
  }

  async getKyberPreKey(id: number): Promise<KyberPreKeyRecord> {
    const bytes = await this.db.loadKyberPreKey(id);
    if (!bytes) throw new Error(`KyberPreKey ${id} not found`);
    return KyberPreKeyRecord.deserialize(Buffer.from(bytes));
  }

  async markKyberPreKeyUsed(
    _kyberPreKeyId: number,
    _signedPreKeyId: number,
    _baseKey: PublicKey
  ): Promise<void> {
    // Consumption tracking delegated to the caller; no-op at store level.
  }
}

// ── Sender key store adapter ─────────────────────────────────────────────────

export class SignalDbSenderKeyStore extends SenderKeyStore {
  constructor(private readonly db: SignalDatabase) {
    super();
  }

  async saveSenderKey(
    sender: ProtocolAddress,
    distributionId: Uuid,
    record: SenderKeyRecord
  ): Promise<void> {
    await this.db.saveSenderKey(
      addrKey(sender),
      String(distributionId),
      new Uint8Array(record.serialize())
    );
  }

  async getSenderKey(
    sender: ProtocolAddress,
    distributionId: Uuid
  ): Promise<SenderKeyRecord | null> {
    const bytes = await this.db.getSenderKey(addrKey(sender), String(distributionId));
    if (!bytes) return null;
    return SenderKeyRecord.deserialize(Buffer.from(bytes));
  }
}
