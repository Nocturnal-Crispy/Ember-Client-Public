/**
 * Migration flow for transitioning devices from legacy TweetNaCl (protocol_version=0)
 * to Signal Protocol (protocol_version=1).
 *
 * Orchestrates: identity key generation → prekey upload → device PATCH → outcome.
 */

import { PrivateKey } from '@signalapp/libsignal-client';
import type { AuthData } from '../types/index.js';
import { migrateDeviceIdentity, type MigrationResult } from './key-migration.js';
import { uploadSignedPreKey, uploadOneTimePreKeys } from '../services/prekeys.js';
import { apiRequest } from '../api/client.js';

export type MigrationStatus = 'idle' | 'in-progress' | 'complete' | 'failed';

export interface MigrationOutcome {
  readonly status: 'complete' | 'failed';
  readonly identityKeyBase64?: string;
  readonly error?: string;
}

interface DeviceUpdateRequest {
  identity_key: string;
  protocol_version: number;
  proof_of_possession: string;
}

interface DeviceUpdateResponse {
  message: string;
  protocol_version: number;
}

/**
 * Determines whether the current device needs migration from legacy to Signal.
 *
 * @param deviceProtocolVersion - The protocol_version field from the server's device record.
 * @returns `true` if the device is still on legacy (protocol_version=0).
 */
export function needsMigration(deviceProtocolVersion: number): boolean {
  return deviceProtocolVersion === 0;
}

/**
 * Generates an Ed25519 proof-of-possession signature over `deviceId || identityKeyBase64`.
 * The server can verify this to confirm the caller holds the corresponding private key.
 */
async function generateProofOfPossession(
  identityPrivateKey: Uint8Array,
  deviceId: string,
  identityKeyBase64: string
): Promise<string> {
  const message = new TextEncoder().encode(`${deviceId}${identityKeyBase64}`);
  const privKey = PrivateKey.deserialize(identityPrivateKey as Uint8Array<ArrayBuffer>);
  const signature = privKey.sign(message);
  return Buffer.from(signature).toString('base64');
}

/**
 * Performs the full migration from legacy to Signal Protocol for a single device.
 *
 * Steps:
 *   1. Generate Signal identity key pair + prekeys via `migrateDeviceIdentity()`
 *   2. Upload signed prekey to server
 *   3. Upload one-time prekeys to server
 *   4. PATCH device with identity_key, protocol_version=1, proof_of_possession
 *
 * @param auth            - Authenticated session data (hostname, token).
 * @param deviceId        - The device ID being migrated.
 * @param legacyPrivateKey - Raw 32-byte Curve25519 private key from legacy identity.
 * @returns A `MigrationOutcome` indicating success or failure.
 */
export async function performMigration(
  auth: AuthData,
  deviceId: string,
  legacyPrivateKey: Uint8Array
): Promise<MigrationOutcome> {
  let migrationResult: MigrationResult;
  try {
    migrationResult = await migrateDeviceIdentity(legacyPrivateKey);
  } catch (err) {
    return {
      status: 'failed',
      error: `Identity key generation failed: ${(err as Error).message}`,
    };
  }

  const identityKeyBase64 = Buffer.from(migrationResult.identityKeyPair.publicKey).toString(
    'base64'
  );

  try {
    await uploadSignedPreKey(auth, migrationResult.signedPreKey);
  } catch (err) {
    return {
      status: 'failed',
      identityKeyBase64,
      error: `Signed prekey upload failed: ${(err as Error).message}`,
    };
  }

  try {
    await uploadOneTimePreKeys(auth, migrationResult.oneTimePreKeys);
  } catch (err) {
    return {
      status: 'failed',
      identityKeyBase64,
      error: `One-time prekey upload failed: ${(err as Error).message}`,
    };
  }

  let proofOfPossession: string;
  try {
    proofOfPossession = await generateProofOfPossession(
      migrationResult.identityKeyPair.privateKey,
      deviceId,
      identityKeyBase64
    );
  } catch (err) {
    return {
      status: 'failed',
      identityKeyBase64,
      error: `Proof of possession generation failed: ${(err as Error).message}`,
    };
  }

  try {
    await apiRequest<DeviceUpdateResponse>(
      auth.hostname,
      `/api/v1/devices/${deviceId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          identity_key: identityKeyBase64,
          protocol_version: 1,
          proof_of_possession: proofOfPossession,
        } satisfies DeviceUpdateRequest),
      },
      auth.token
    );
  } catch (err) {
    return {
      status: 'failed',
      identityKeyBase64,
      error: `Device update failed: ${(err as Error).message}`,
    };
  }

  return {
    status: 'complete',
    identityKeyBase64,
  };
}
