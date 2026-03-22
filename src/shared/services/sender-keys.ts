/**
 * Sender Key Distribution service client.
 *
 * Provides HTTP service functions for sender key distribution CRUD
 * operations against the Ember server, plus orchestration functions
 * that combine Signal session crypto with server API calls.
 *
 * The `SignalSessionCrypto` interface decouples this module from
 * ember-client's IPC layer — callers inject their own encrypt/decrypt
 * implementation (typically wired through `window.emberAPI.invoke()`).
 */

import type { AuthData } from '../types';
import { apiRequest } from '../api';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SenderKeyDistributionUpload {
  readonly recipient_user_id: string;
  readonly recipient_device_id: string;
  readonly distribution_message: string;
}

export interface PendingDistribution {
  readonly id: string;
  readonly ember_id: string;
  readonly sender_user_id: string;
  readonly sender_device_id: string;
  readonly distribution_message: string;
}

export interface DeviceTarget {
  readonly userId: string;
  readonly deviceId: string;
}

export interface SignalSessionCrypto {
  encrypt(recipientAddress: string, plaintext: Uint8Array): Promise<Uint8Array>;
  decrypt(senderAddress: string, ciphertext: Uint8Array): Promise<Uint8Array>;
}

type InstallSenderKeyFn = (senderAddress: string, distributionBytes: Uint8Array) => Promise<void>;

// ── HTTP Service Functions ───────────────────────────────────────────────────

/**
 * Uploads sender key distribution messages to the server for a specific ember.
 *
 * @param auth - Authenticated session data
 * @param emberId - The ember (group) to distribute keys for
 * @param distributions - Array of per-recipient distribution messages (base64)
 */
export async function uploadSenderKeyDistributions(
  auth: AuthData,
  emberId: string,
  distributions: SenderKeyDistributionUpload[]
): Promise<void> {
  await apiRequest<unknown>(
    auth.hostname,
    `/api/v1/embers/${emberId}/sender-key-distributions`,
    {
      method: 'POST',
      body: JSON.stringify({ distributions }),
    },
    auth.token
  );
}

/**
 * Fetches pending sender key distributions for the authenticated device.
 *
 * @param auth - Authenticated session data
 * @returns Array of pending distributions awaiting processing
 */
export async function fetchPendingDistributions(auth: AuthData): Promise<PendingDistribution[]> {
  const data = await apiRequest<{ distributions: PendingDistribution[] }>(
    auth.hostname,
    '/api/v1/sender-key-distributions/pending',
    { method: 'GET' },
    auth.token
  );
  return data.distributions ?? [];
}

/**
 * Acknowledges a sender key distribution as consumed.
 *
 * @param auth - Authenticated session data
 * @param distributionId - The distribution ID to acknowledge
 */
export async function acknowledgeDistribution(
  auth: AuthData,
  distributionId: string
): Promise<void> {
  await apiRequest<unknown>(
    auth.hostname,
    `/api/v1/sender-key-distributions/${distributionId}/ack`,
    { method: 'POST' },
    auth.token
  );
}

/**
 * Fetches the member list for an ember, mapped to DeviceTarget format.
 *
 * @param auth - Authenticated session data
 * @param emberId - The ember to fetch members for
 * @returns Array of DeviceTarget (server excludes the requesting device)
 */
export async function fetchEmberMembers(auth: AuthData, emberId: string): Promise<DeviceTarget[]> {
  const data = await apiRequest<{ members: Array<{ user_id: string; device_id: string }> }>(
    auth.hostname,
    `/api/v1/embers/${emberId}/members`,
    { method: 'GET' },
    auth.token
  );
  return (data.members ?? []).map(m => ({
    userId: m.user_id,
    deviceId: m.device_id,
  }));
}

// ── Orchestration Functions ──────────────────────────────────────────────────

/**
 * Distributes a sender key to all specified members by encrypting it
 * via pairwise Signal sessions and uploading the batch to the server.
 *
 * @param auth - Authenticated session data
 * @param emberId - The ember to distribute for
 * @param members - Target devices (excluding self)
 * @param distributionBytes - Raw SenderKeyDistributionMessage bytes
 * @param crypto - Signal session encrypt/decrypt implementation
 */
export async function distributeToMembers(
  auth: AuthData,
  emberId: string,
  members: DeviceTarget[],
  distributionBytes: Uint8Array,
  crypto: SignalSessionCrypto
): Promise<void> {
  const distributions: SenderKeyDistributionUpload[] = await Promise.all(
    members.map(async member => {
      const recipientAddress = `${member.userId}.${member.deviceId}`;
      const encrypted = await crypto.encrypt(recipientAddress, distributionBytes);
      return {
        recipient_user_id: member.userId,
        recipient_device_id: member.deviceId,
        distribution_message: toBase64(encrypted),
      };
    })
  );
  await uploadSenderKeyDistributions(auth, emberId, distributions);
}

/**
 * Fetches all pending sender key distributions, decrypts each via
 * pairwise Signal sessions, installs the sender key, and acknowledges.
 *
 * @param auth - Authenticated session data
 * @param crypto - Signal session encrypt/decrypt implementation
 * @param installSenderKey - Callback to install decrypted distribution bytes into the sender key store
 */
export async function processIncomingDistributions(
  auth: AuthData,
  crypto: SignalSessionCrypto,
  installSenderKey: InstallSenderKeyFn
): Promise<void> {
  const pending = await fetchPendingDistributions(auth);
  for (const dist of pending) {
    const senderAddress = `${dist.sender_user_id}.${dist.sender_device_id}`;
    const ciphertext = fromBase64(dist.distribution_message);
    const distributionBytes = await crypto.decrypt(senderAddress, ciphertext);
    await installSenderKey(senderAddress, distributionBytes);
    await acknowledgeDistribution(auth, dist.id);
  }
}

// ── Base64 helpers ───────────────────────────────────────────────────────────

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function fromBase64(encoded: string): Uint8Array {
  return new Uint8Array(Buffer.from(encoded, 'base64'));
}
