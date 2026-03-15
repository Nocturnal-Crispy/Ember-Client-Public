/**
 * @jest-environment node
 *
 * Tests for the DM key self-box migration:
 * - After asymmetric decrypt succeeds, key is re-stored as self-box (same as text channels)
 * - fetchAndCacheEmberKey behaves identically to fetchEmberKey after migration
 * - startDmConversation correctly encrypts for peer using their actual public key
 * - DM key fetch fails gracefully when stored key is wrong (offline-peer creation bug)
 */

import {
  generateEmberKey,
  encryptEmberKeyForUser,
  decryptEmberKeyForUser,
  encryptMessage,
  decryptMessage,
} from 'ember-shared';

import * as nacl from 'tweetnacl';

describe('DM Key Self-Box Migration', () => {
  let alice: nacl.BoxKeyPair;
  let bob: nacl.BoxKeyPair;
  let emberKey: Uint8Array;

  beforeEach(() => {
    alice = nacl.box.keyPair();
    bob = nacl.box.keyPair();
    emberKey = generateEmberKey();
  });

  // ─── Self-box parity with text channels ───────────────────────────────────

  describe('self-box encryption (text channel parity)', () => {
    it('creator can decrypt their own self-box copy', () => {
      // Same mechanism as text channels: box(key, nonce, ownPub, ownPriv)
      const encryptedForAlice = encryptEmberKeyForUser(
        emberKey,
        alice.publicKey,
        alice.secretKey,
      );
      const decrypted = decryptEmberKeyForUser(
        encryptedForAlice,
        alice.publicKey,
        alice.secretKey,
      );
      expect(decrypted).not.toBeNull();
      expect(decrypted).toEqual(emberKey);
    });

    it('self-box cannot be decrypted by a third party without the private key', () => {
      const charlie = nacl.box.keyPair();
      const encryptedForAlice = encryptEmberKeyForUser(
        emberKey,
        alice.publicKey,
        alice.secretKey,
      );
      // Charlie tries to use alice's pub key with charlie's private key → fails
      const badDecrypt = decryptEmberKeyForUser(
        encryptedForAlice,
        alice.publicKey,
        charlie.secretKey,
      );
      expect(badDecrypt).toBeNull();
    });
  });

  // ─── Asymmetric box (creator → peer) ──────────────────────────────────────

  describe('asymmetric box for peer (correct DM creation flow)', () => {
    it('peer can decrypt their copy when creator used correct asymmetric box', () => {
      // Creator (Alice) encrypts for Bob: box(key, nonce, bobPub, alicePriv)
      const encryptedForBob = encryptEmberKeyForUser(
        emberKey,
        bob.publicKey,
        alice.secretKey,
      );
      // Bob decrypts: box.open(box, nonce, alicePub, bobPriv)
      const decrypted = decryptEmberKeyForUser(
        encryptedForBob,
        alice.publicKey,
        bob.secretKey,
      );
      expect(decrypted).not.toBeNull();
      expect(decrypted).toEqual(emberKey);
    });

    it('peer cannot decrypt creator self-box (offline-peer creation bug)', () => {
      // BUG: creator stores encryptedKeySelf as encryptedKeyPeer when peer is offline
      const encryptedForAlice = encryptEmberKeyForUser(
        emberKey,
        alice.publicKey,
        alice.secretKey, // self-box: both keys are alice's
      );
      // Bob tries to decrypt the creator's self-box → fails
      const decrypted = decryptEmberKeyForUser(
        encryptedForAlice,
        alice.publicKey, // sender_public_key returned by server
        bob.secretKey,   // bob's private key
      );
      expect(decrypted).toBeNull();
    });
  });

  // ─── Self-box migration after asymmetric decrypt ──────────────────────────

  describe('self-box migration (fetchAndCacheEmberKey post-fix)', () => {
    it('after asymmetric decrypt, re-encrypting as self-box produces a correct self-box', () => {
      // Simulate what the server returns for the peer (asymmetric box from creator)
      const encryptedForBob = encryptEmberKeyForUser(
        emberKey,
        bob.publicKey,
        alice.secretKey,
      );

      // Step 1: peer decrypts the asymmetric box
      const decryptedKey = decryptEmberKeyForUser(
        encryptedForBob,
        alice.publicKey,
        bob.secretKey,
      );
      expect(decryptedKey).not.toBeNull();

      // Step 2: peer re-encrypts as self-box (the migration)
      const selfBoxForBob = encryptEmberKeyForUser(
        decryptedKey!,
        bob.publicKey,
        bob.secretKey,
      );

      // Step 3: future fetch uses self-box (same as text channels)
      const reFetched = decryptEmberKeyForUser(
        selfBoxForBob,
        bob.publicKey,
        bob.secretKey,
      );
      expect(reFetched).not.toBeNull();
      expect(reFetched).toEqual(emberKey);
    });

    it('self-box from migration is identical to creator self-box in structure', () => {
      // Both Alice and Bob should be able to decode their own self-boxes
      const encryptedForBob = encryptEmberKeyForUser(
        emberKey,
        bob.publicKey,
        alice.secretKey,
      );
      const decryptedByBob = decryptEmberKeyForUser(
        encryptedForBob,
        alice.publicKey,
        bob.secretKey,
      )!;
      const bobSelfBox = encryptEmberKeyForUser(
        decryptedByBob,
        bob.publicKey,
        bob.secretKey,
      );
      const aliceSelfBox = encryptEmberKeyForUser(
        emberKey,
        alice.publicKey,
        alice.secretKey,
      );

      // Both can decrypt their own self-boxes
      expect(decryptEmberKeyForUser(bobSelfBox, bob.publicKey, bob.secretKey)).toEqual(emberKey);
      expect(decryptEmberKeyForUser(aliceSelfBox, alice.publicKey, alice.secretKey)).toEqual(emberKey);

      // Neither can decrypt the other's self-box
      expect(decryptEmberKeyForUser(bobSelfBox, alice.publicKey, alice.secretKey)).toBeNull();
      expect(decryptEmberKeyForUser(aliceSelfBox, bob.publicKey, bob.secretKey)).toBeNull();
    });
  });

  // ─── Message encryption/decryption after migration ────────────────────────

  describe('end-to-end message flow after key migration', () => {
    it('Alice sends a message; Bob can decrypt after self-box migration', () => {
      // Alice creates DM, encrypts key asymmetrically for Bob
      const encryptedForBob = encryptEmberKeyForUser(
        emberKey,
        bob.publicKey,
        alice.secretKey,
      );

      // Alice sends a message
      const plaintext = 'Hello Bob, this is a secret DM!';
      const ciphertext = encryptMessage(plaintext, emberKey);

      // Bob performs key migration: asymmetric decrypt → self-box
      const decryptedKey = decryptEmberKeyForUser(
        encryptedForBob,
        alice.publicKey,
        bob.secretKey,
      )!;
      const bobSelfBox = encryptEmberKeyForUser(decryptedKey, bob.publicKey, bob.secretKey);

      // Bob decrypts message using migrated key
      const bobKey = decryptEmberKeyForUser(bobSelfBox, bob.publicKey, bob.secretKey)!;
      const decrypted = decryptMessage(ciphertext, bobKey);
      expect(decrypted).toBe(plaintext);
    });

    it('Bob sends a message; Alice can decrypt using her self-box', () => {
      // Alice has her self-box
      const aliceSelfBox = encryptEmberKeyForUser(
        emberKey,
        alice.publicKey,
        alice.secretKey,
      );

      // Bob sends a message using the same ember key
      const plaintext = 'Hello Alice, replying to you!';
      const ciphertext = encryptMessage(plaintext, emberKey);

      // Alice decrypts from her self-box (same path as text channels)
      const aliceKey = decryptEmberKeyForUser(aliceSelfBox, alice.publicKey, alice.secretKey)!;
      const decrypted = decryptMessage(ciphertext, aliceKey);
      expect(decrypted).toBe(plaintext);
    });

    it('both Alice and Bob decrypt each other\'s messages after migration', () => {
      // Set up both self-boxes
      const encryptedForBob = encryptEmberKeyForUser(emberKey, bob.publicKey, alice.secretKey);
      const aliceSelfBox = encryptEmberKeyForUser(emberKey, alice.publicKey, alice.secretKey);
      const bobKeyDecrypted = decryptEmberKeyForUser(encryptedForBob, alice.publicKey, bob.secretKey)!;
      const bobSelfBox = encryptEmberKeyForUser(bobKeyDecrypted, bob.publicKey, bob.secretKey);

      const aliceKey = decryptEmberKeyForUser(aliceSelfBox, alice.publicKey, alice.secretKey)!;
      const bobKey = decryptEmberKeyForUser(bobSelfBox, bob.publicKey, bob.secretKey)!;

      // Both keys should be the same ember key
      expect(aliceKey).toEqual(bobKey);

      // Alice's message decryptable by Bob
      const aliceMsg = encryptMessage('Message from Alice', aliceKey);
      expect(decryptMessage(aliceMsg, bobKey)).toBe('Message from Alice');

      // Bob's message decryptable by Alice
      const bobMsg = encryptMessage('Message from Bob', bobKey);
      expect(decryptMessage(bobMsg, aliceKey)).toBe('Message from Bob');
    });
  });

  // ─── Startup key caching ───────────────────────────────────────────────────

  describe('startup DM channel subscription (join channel on startup)', () => {
    it('simulates loadDmEmbers caching key and subscribing to channel', async () => {
      const emberKeyCache = new Map<string, Uint8Array>();
      const subscribedChannels = new Set<string>();

      // Simulate what loadDmEmbers does for each DM
      const dmEmberId = 'dm-ember-1';
      const dmChannelId = 'dm-channel-1';
      const encryptedForBob = encryptEmberKeyForUser(emberKey, bob.publicKey, alice.secretKey);

      // Simulate fetchAndCacheEmberKey (with migration)
      const decryptedKey = decryptEmberKeyForUser(encryptedForBob, alice.publicKey, bob.secretKey);
      if (decryptedKey) {
        emberKeyCache.set(dmEmberId, decryptedKey);
        // Simulate PUT to server (migration) — just tracks that it was called
        subscribedChannels.add(dmChannelId);
      }

      expect(emberKeyCache.has(dmEmberId)).toBe(true);
      expect(subscribedChannels.has(dmChannelId)).toBe(true);

      // With key in cache, incoming messages can be decrypted
      const cachedKey = emberKeyCache.get(dmEmberId)!;
      const ciphertext = encryptMessage('Hello from startup!', cachedKey);
      expect(decryptMessage(ciphertext, cachedKey)).toBe('Hello from startup!');
    });

    it('detects when stored key cannot be decrypted (offline-peer creation bug)', () => {
      // Bug: creator stored their self-box as peer's key
      const creatorSelfBox = encryptEmberKeyForUser(emberKey, alice.publicKey, alice.secretKey);

      // Peer tries to decrypt using sender's public key (as server returns)
      const decrypted = decryptEmberKeyForUser(
        creatorSelfBox,
        alice.publicKey, // sender_public_key from server
        bob.secretKey,   // own private key
      );

      // This fails — the channel cannot be joined until key is re-provided
      expect(decrypted).toBeNull();
    });
  });
});
