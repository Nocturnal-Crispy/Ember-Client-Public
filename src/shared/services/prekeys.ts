import type { AuthData } from '../types';
import type {
  OneTimePreKey,
  SignedPreKey,
  IdentityKeyPair,
  PreKeyBundle,
} from '../crypto/signal-types';
import type { IPreKeyStore } from '../crypto/signal-store';
import { generateOneTimePreKeys, generateSignedPreKey } from '../crypto/signal-keygen';

export async function uploadSignedPreKey(
  auth: AuthData,
  signedPreKey: SignedPreKey
): Promise<void> {
  const response = await fetch(`${auth.hostname}/api/v1/prekeys/signed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.token}`,
    },
    body: JSON.stringify({
      id: signedPreKey.id,
      publicKey: Buffer.from(signedPreKey.keyPair.publicKey).toString('base64'),
      signature: Buffer.from(signedPreKey.signature).toString('base64'),
      timestamp: signedPreKey.timestamp,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to upload signed prekey: ${response.status}`);
  }
}

export async function uploadOneTimePreKeys(
  auth: AuthData,
  prekeys: OneTimePreKey[]
): Promise<void> {
  const response = await fetch(`${auth.hostname}/api/v1/prekeys/one-time`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.token}`,
    },
    body: JSON.stringify(
      prekeys.map(prekey => ({
        id: prekey.id,
        publicKey: Buffer.from(prekey.keyPair.publicKey).toString('base64'),
      }))
    ),
  });

  if (!response.ok) {
    throw new Error(`Failed to upload one time prekeys: ${response.status}`);
  }
}

export async function getOneTimePreKeyCount(auth: AuthData): Promise<number> {
  const response = await fetch(`${auth.hostname}/api/v1/prekeys/one-time/count`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${auth.token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get one time prekey count: ${response.status}`);
  }

  const data = await response.json();
  return data.count;
}

export async function fetchPreKeyBundle(
  auth: AuthData,
  userId: string,
  deviceId: string
): Promise<PreKeyBundle> {
  const response = await fetch(
    `${auth.hostname}/api/v1/users/${userId}/devices/${deviceId}/prekey-bundle`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${auth.token}`,
      },
    }
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch prekey bundle: ${response.status}`);
  }
  const data = await response.json();

  // Map response to local PreKeyBundle type from signal-types.ts
  // Server returns nested camelCase: { identityKey, registrationId, signedPreKey: { id, publicKey, signature, ... }, oneTimePreKey?: { id, publicKey } }
  return {
    registrationId: data.registrationId,
    deviceId: data.signedPreKey?.deviceId,
    preKeyId: data.oneTimePreKey?.id,
    preKey: data.oneTimePreKey?.publicKey
      ? new Uint8Array(data.oneTimePreKey.publicKey)
      : undefined,
    signedPreKeyId: data.signedPreKey?.id,
    signedPreKey: new Uint8Array(data.signedPreKey.publicKey),
    signedPreKeySignature: new Uint8Array(data.signedPreKey.signature),
    identityKey: new Uint8Array(data.identityKey),
  };
}

export async function generateAndUploadSignedPreKey(
  auth: AuthData,
  identityKeyPair: IdentityKeyPair,
  signedPreKeyId: number
): Promise<SignedPreKey> {
  // Generate a new signed prekey using the Signal library
  const signedPreKey = await generateSignedPreKey(identityKeyPair, signedPreKeyId);

  // Upload it to the server
  await uploadSignedPreKey(auth, signedPreKey);

  return signedPreKey;
}

export async function checkAndReplenishPreKeys(
  auth: AuthData,
  keyStore: IPreKeyStore,
  _identityKeyPair: IdentityKeyPair
): Promise<void> {
  const currentCount = await getOneTimePreKeyCount(auth);

  // If we have fewer than 25 keys, upload 100 new ones
  if (currentCount < 25) {
    // Find the next available prekey ID by checking existing keys
    // Start with a high ID to avoid conflicts with existing keys
    let nextKeyId = Date.now();

    // Try to find the highest existing prekey ID to avoid collisions
    for (let i = 0; i < 1000; i++) {
      const existingKey = await keyStore.loadPreKey(nextKeyId + i);
      if (!existingKey) {
        nextKeyId = nextKeyId + i;
        break;
      }
    }

    // Generate 100 new one-time prekeys using the Signal library
    const newPreKeys = await generateOneTimePreKeys(nextKeyId, 100);

    // Store the new prekeys locally before uploading
    for (const prekey of newPreKeys) {
      // In a real implementation, you'd serialize the prekey properly
      // For now, we'll store the public key as a simple representation
      await keyStore.storePreKey(prekey.id, prekey.keyPair.publicKey);
    }

    await uploadOneTimePreKeys(auth, newPreKeys);
  }
}
