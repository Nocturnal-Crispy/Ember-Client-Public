/**
 * @jest-environment node
 *
 * Integration tests for the DM request flow:
 *   1. Requester sends a DM request (no encryption — just a notification)
 *   2. Recipient accepts — generates ember key, creates self-box + peer-box
 *   3. Requester loads the DM, fetches their peer-box key, migrates to self-box
 *   4. Both parties can encrypt/decrypt messages using only self-box paths
 *
 * These tests drive the implementation of:
 *   - sendDMRequest (replaces startDmConversation peer-box logic)
 *   - fetchDMRequests
 *   - acceptDMRequest (key generation + self-box + peer-box)
 *   - declineDMRequest
 *   - fetchAndCacheEmberKey (simplified: only self-box path after migration)
 */

import {
  generateEmberKey,
  encryptEmberKeyForUser,
  decryptEmberKeyForUser,
  encryptMessage,
  decryptMessage,
} from 'ember-shared';

import * as nacl from 'tweetnacl';

function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function decodeBase64(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

// ─── Test helpers ───────────────────────────────────────────────────────────

interface DeviceKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  publicKeyB64: string;
  secretKeyB64: string;
}

function makeDeviceKeyPair(): DeviceKeyPair {
  const kp = nacl.box.keyPair();
  return {
    publicKey: kp.publicKey,
    secretKey: kp.secretKey,
    publicKeyB64: encodeBase64(kp.publicKey),
    secretKeyB64: encodeBase64(kp.secretKey),
  };
}

// Simulate the acceptDMRequest crypto logic that the client manager will run
function acceptDMRequestCrypto(
  acceptorDevice: DeviceKeyPair,
  requesterPublicKey: Uint8Array,
): {
  emberKey: Uint8Array;
  encryptedKeySelf: string;
  encryptedKeyPeer: string;
  senderPublicKey: string;
} {
  const emberKey = generateEmberKey();

  // Self-box: acceptor seals the key with their own device key pair
  const encryptedKeySelf = encryptEmberKeyForUser(
    emberKey,
    acceptorDevice.publicKey,
    acceptorDevice.secretKey,
  );

  // Peer-box: acceptor seals the key for the requester's device
  const encryptedKeyPeer = encryptEmberKeyForUser(
    emberKey,
    requesterPublicKey,
    acceptorDevice.secretKey,
  );

  return {
    emberKey,
    encryptedKeySelf,
    encryptedKeyPeer,
    senderPublicKey: acceptorDevice.publicKeyB64,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe.skip('DM Request Flow — Crypto Layer', () => {
  let alice: DeviceKeyPair;  // acceptor / recipient
  let bob: DeviceKeyPair;    // requester / initiator

  beforeAll(() => {
    alice = makeDeviceKeyPair();
    bob = makeDeviceKeyPair();
  });

  // ── Step 1: Send DM request (no crypto) ──────────────────────────────────

  describe('sendDMRequest', () => {
    it('requires no encryption when sending a DM request', () => {
      // The request body is just { user_id } — no keys involved
      const requestBody = { user_id: 'alice-user-id' };
      expect(requestBody).not.toHaveProperty('encrypted_key_self');
      expect(requestBody).not.toHaveProperty('encrypted_key_peer');
    });
  });

  // ── Step 2: Accept DM request — key generation ────────────────────────────

  describe('acceptDMRequest — crypto', () => {
    it('generates a fresh ember key for each DM acceptance', () => {
      const result1 = acceptDMRequestCrypto(alice, bob.publicKey);
      const result2 = acceptDMRequestCrypto(alice, bob.publicKey);
      expect(result1.emberKey).not.toEqual(result2.emberKey);
    });

    it('acceptor self-box can be decrypted by acceptor with their own keys', () => {
      const { emberKey, encryptedKeySelf } = acceptDMRequestCrypto(alice, bob.publicKey);

      const decrypted = decryptEmberKeyForUser(
        encryptedKeySelf,
        alice.publicKey,   // senderPub = self
        alice.secretKey,   // ownPriv
      );

      expect(decrypted).not.toBeNull();
      expect(decrypted).toEqual(emberKey);
    });

    it('requester peer-box can be decrypted by requester using acceptor public key', () => {
      const { emberKey, encryptedKeyPeer, senderPublicKey } = acceptDMRequestCrypto(alice, bob.publicKey);

      const decrypted = decryptEmberKeyForUser(
        encryptedKeyPeer,
        decodeBase64(senderPublicKey),  // acceptor's pub key (sender)
        bob.secretKey,                            // requester's priv key
      );

      expect(decrypted).not.toBeNull();
      expect(decrypted).toEqual(emberKey);
    });

    it('peer-box cannot be decrypted with the wrong private key', () => {
      const charlie = makeDeviceKeyPair();
      const { encryptedKeyPeer, senderPublicKey } = acceptDMRequestCrypto(alice, bob.publicKey);

      const decrypted = decryptEmberKeyForUser(
        encryptedKeyPeer,
        decodeBase64(senderPublicKey),
        charlie.secretKey, // wrong key
      );

      expect(decrypted).toBeNull();
    });

    it('acceptor and requester derive the same ember key', () => {
      const { emberKey, encryptedKeySelf, encryptedKeyPeer, senderPublicKey } =
        acceptDMRequestCrypto(alice, bob.publicKey);

      const aliceKey = decryptEmberKeyForUser(encryptedKeySelf, alice.publicKey, alice.secretKey);
      const bobKey = decryptEmberKeyForUser(
        encryptedKeyPeer,
        decodeBase64(senderPublicKey),
        bob.secretKey,
      );

      expect(aliceKey).toEqual(emberKey);
      expect(bobKey).toEqual(emberKey);
      expect(aliceKey).toEqual(bobKey);
    });

    it('senderPublicKey matches the acceptor public key', () => {
      const { senderPublicKey } = acceptDMRequestCrypto(alice, bob.publicKey);
      expect(senderPublicKey).toBe(alice.publicKeyB64);
    });
  });

  // ── Step 3: Requester migrates peer-box to self-box ──────────────────────

  describe('peer-box → self-box migration', () => {
    it('requester can decrypt peer-box and re-encrypt as self-box', () => {
      const { emberKey, encryptedKeyPeer, senderPublicKey } =
        acceptDMRequestCrypto(alice, bob.publicKey);

      // Requester decrypts the peer-box
      const decryptedKey = decryptEmberKeyForUser(
        encryptedKeyPeer,
        decodeBase64(senderPublicKey),
        bob.secretKey,
      );
      expect(decryptedKey).toEqual(emberKey);

      // Requester re-encrypts as self-box
      const selfBox = encryptEmberKeyForUser(decryptedKey!, bob.publicKey, bob.secretKey);

      // Requester can later decrypt their own self-box (simulating future loads)
      const redecrypted = decryptEmberKeyForUser(selfBox, bob.publicKey, bob.secretKey);
      expect(redecrypted).toEqual(emberKey);
    });

    it('after migration, requester no longer needs acceptor public key', () => {
      const { emberKey, encryptedKeyPeer, senderPublicKey } =
        acceptDMRequestCrypto(alice, bob.publicKey);

      const decryptedKey = decryptEmberKeyForUser(
        encryptedKeyPeer,
        decodeBase64(senderPublicKey),
        bob.secretKey,
      );
      const selfBox = encryptEmberKeyForUser(decryptedKey!, bob.publicKey, bob.secretKey);

      // Self-box decryption does NOT need alice's key at all
      const redecrypted = decryptEmberKeyForUser(selfBox, bob.publicKey, bob.secretKey);
      expect(redecrypted).toEqual(emberKey);
    });

    it('self-box migration works even if acceptor rotates their device key later', () => {
      const { encryptedKeyPeer, senderPublicKey } = acceptDMRequestCrypto(alice, bob.publicKey);

      // Bob migrates to self-box
      const decryptedKey = decryptEmberKeyForUser(
        encryptedKeyPeer,
        decodeBase64(senderPublicKey),
        bob.secretKey,
      )!;
      const selfBox = encryptEmberKeyForUser(decryptedKey, bob.publicKey, bob.secretKey);

      // Now alice changes her device key
      const newAlice = makeDeviceKeyPair();
      expect(newAlice.publicKeyB64).not.toBe(alice.publicKeyB64); // different key

      // Bob can still decrypt his self-box — unaffected by alice's key rotation
      const redecrypted = decryptEmberKeyForUser(selfBox, bob.publicKey, bob.secretKey);
      expect(redecrypted).toEqual(decryptedKey);
    });
  });

  // ── Step 4: End-to-end message flow ──────────────────────────────────────

  describe('end-to-end DM message flow via request model', () => {
    it('both parties can exchange encrypted messages after accept', () => {
      const { emberKey, encryptedKeySelf, encryptedKeyPeer, senderPublicKey } =
        acceptDMRequestCrypto(alice, bob.publicKey);

      // Alice (acceptor) decrypts her self-box
      const aliceKey = decryptEmberKeyForUser(encryptedKeySelf, alice.publicKey, alice.secretKey)!;

      // Bob (requester) decrypts peer-box and migrates to self-box
      const bobKeyRaw = decryptEmberKeyForUser(
        encryptedKeyPeer,
        decodeBase64(senderPublicKey),
        bob.secretKey,
      )!;
      const bobSelfBox = encryptEmberKeyForUser(bobKeyRaw, bob.publicKey, bob.secretKey);
      const bobKey = decryptEmberKeyForUser(bobSelfBox, bob.publicKey, bob.secretKey)!;

      expect(aliceKey).toEqual(emberKey);
      expect(bobKey).toEqual(emberKey);

      // Alice sends a message
      const aliceMsg = 'Hey Bob! DM request model works!';
      const aliceCiphertext = encryptMessage(aliceMsg, aliceKey);
      expect(decryptMessage(aliceCiphertext, bobKey)).toBe(aliceMsg);

      // Bob replies
      const bobMsg = 'Hi Alice! Confirmed, no auth errors!';
      const bobCiphertext = encryptMessage(bobMsg, bobKey);
      expect(decryptMessage(bobCiphertext, aliceKey)).toBe(bobMsg);
    });

    it('DM ember key from request model is independent per conversation', () => {
      // Alice accepts Bob's request
      const aliceBob = acceptDMRequestCrypto(alice, bob.publicKey);

      // Alice also accepts Charlie's request (different ember key)
      const charlie = makeDeviceKeyPair();
      const aliceCharlie = acceptDMRequestCrypto(alice, charlie.publicKey);

      expect(aliceBob.emberKey).not.toEqual(aliceCharlie.emberKey);

      const msg = 'Secret';
      expect(decryptMessage(encryptMessage(msg, aliceBob.emberKey), aliceCharlie.emberKey)).toBeNull();
    });
  });

  // ── Request model vs. old model: key stability ────────────────────────────

  describe('request model eliminates stale-key auth failures', () => {
    it('old model: auth failure when creator rotates device key', () => {
      // Simulate old DM creation: alice sends DM to bob using bob's OLD device key
      const bobOldDevice = makeDeviceKeyPair();
      const emberKey = generateEmberKey();

      // Alice seals the key using bob's old public key and alice's private key
      const peerBoxForBob = encryptEmberKeyForUser(
        emberKey,
        bobOldDevice.publicKey,
        alice.secretKey,
      );

      // Bob rotates his device key (reinstall, device recovery, etc.)
      const bobNewDevice = makeDeviceKeyPair();

      // Server now returns alice's CURRENT public key but alice's key is the same;
      // however if alice also rotated, decryption fails:
      const aliceRotated = makeDeviceKeyPair();
      const decryptedWithNewAliceKey = decryptEmberKeyForUser(
        peerBoxForBob,
        aliceRotated.publicKey, // wrong! server returns current key, not the one used
        bobOldDevice.secretKey,
      );
      expect(decryptedWithNewAliceKey).toBeNull(); // this is the bug!
    });

    it('new model: no auth failure — stored sender_public_key is always correct', () => {
      // Alice accepts bob's request using current keys
      const { encryptedKeyPeer, senderPublicKey } = acceptDMRequestCrypto(alice, bob.publicKey);

      // senderPublicKey is stored in DB alongside the peer-box; never looked up dynamically
      const decrypted = decryptEmberKeyForUser(
        encryptedKeyPeer,
        decodeBase64(senderPublicKey), // always the key actually used
        bob.secretKey,
      );
      expect(decrypted).not.toBeNull(); // always works
    });
  });
});
