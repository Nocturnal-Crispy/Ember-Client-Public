import type { AuthData } from '../types';
import type {
  OneTimePreKey,
  SignedPreKey,
  IdentityKeyPair,
  PreKeyBundle,
} from '../crypto/signal-types';
import type { IPreKeyStore } from '../crypto/signal-store';
import { generateOneTimePreKeys, generateSignedPreKey } from '../crypto/key-migration';

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
      public_key: Buffer.from(signedPreKey.keyPair.publicKey).toString('base64'),
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
        public_key: Buffer.from(prekey.keyPair.publicKey).toString('base64'),
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
  return {
    registrationId: data.registration_id,
    deviceId: data.device_id,
    preKeyId: data.prekey_id,
    preKey: data.prekey_public ? new Uint8Array(data.prekey_public) : undefined,
    signedPreKeyId: data.signed_prekey_id,
    signedPreKey: new Uint8Array(data.signed_prekey_public),
    signedPreKeySignature: new Uint8Array(data.signed_prekey_signature),
    identityKey: new Uint8Array(data.identity_key),
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
  identityKeyPair: IdentityKeyPair
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
