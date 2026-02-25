const nacl = require('tweetnacl');
const naclUtil = require('tweetnacl-util');

/**
 * Generate a random 16-digit numeric recovery code formatted as XXXX-XXXX-XXXX-XXXX.
 * @returns {string} The recovery code.
 */
function generateRecoveryCode() {
  const digits = new Uint8Array(16);
  crypto.getRandomValues(digits);
  const code = Array.from(digits).map(b => b % 10).join('');
  console.debug('[Crypto] Recovery code generated');
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}-${code.slice(12, 16)}`;
}

/**
 * Derive a 32-byte encryption key from a recovery code using PBKDF2.
 * @param {string} recoveryCode - The 16-digit recovery code.
 * @param {Uint8Array} salt - Random salt bytes.
 * @returns {Promise<Uint8Array>} The derived 32-byte key.
 */
async function deriveKeyFromRecoveryCode(recoveryCode, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(recoveryCode.replace(/-/g, '')),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );
  return new Uint8Array(derivedBits);
}

/**
 * Encrypt the device private key with the recovery code using PBKDF2 + NaCl secretbox.
 * @param {Uint8Array} privateKey - The device private key bytes.
 * @param {string} recoveryCode - The 16-digit recovery code.
 * @returns {Promise<{encrypted: string, salt: string}>} Base64 encoded encrypted key and salt.
 */
async function encryptPrivateKeyWithRecoveryCode(privateKey, recoveryCode) {
  console.debug('[Crypto] Encrypting private key with recovery code');
  const salt = nacl.randomBytes(32);
  const derivedKey = await deriveKeyFromRecoveryCode(recoveryCode, salt);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const encrypted = nacl.secretbox(privateKey, nonce, derivedKey);
  const combined = new Uint8Array(nonce.length + encrypted.length);
  combined.set(nonce);
  combined.set(encrypted, nonce.length);
  console.debug('[Crypto] Private key encryption complete');
  return {
    encrypted: naclUtil.encodeBase64(combined),
    salt: naclUtil.encodeBase64(salt)
  };
}

/**
 * Decrypt the device private key using the recovery code.
 * @param {string} encryptedBase64 - Base64 encoded nonce + ciphertext.
 * @param {string} recoveryCode - The 16-digit recovery code.
 * @param {string} saltBase64 - Base64 encoded salt.
 * @returns {Promise<Uint8Array|null>} The decrypted private key bytes, or null on failure.
 */
async function decryptPrivateKeyWithRecoveryCode(encryptedBase64, recoveryCode, saltBase64) {
  console.debug('[Crypto] Decrypting private key with recovery code');
  const combined = naclUtil.decodeBase64(encryptedBase64);
  const salt = naclUtil.decodeBase64(saltBase64);
  const derivedKey = await deriveKeyFromRecoveryCode(recoveryCode, salt);
  const nonce = combined.slice(0, nacl.secretbox.nonceLength);
  const ciphertext = combined.slice(nacl.secretbox.nonceLength);
  const decrypted = nacl.secretbox.open(ciphertext, nonce, derivedKey);
  if (!decrypted) {
    console.error('[Crypto] Private key decryption failed: invalid recovery code or corrupted data');
  } else {
    console.debug('[Crypto] Private key decryption successful');
  }
  return decrypted || null;
}

/**
 * Generate a random 32-byte symmetric key for an ember.
 * @returns {Uint8Array} The ember key bytes.
 */
function generateEmberKey() {
  console.debug('[Crypto] Generating ember symmetric key');
  return nacl.randomBytes(nacl.secretbox.keyLength);
}

/**
 * Encrypt an ember key for a specific user using NaCl box (asymmetric encryption).
 * @param {Uint8Array} emberKey - The ember symmetric key.
 * @param {Uint8Array} recipientPublicKey - Recipient's public key.
 * @param {Uint8Array} senderPrivateKey - Sender's private key.
 * @returns {string} Base64 encoded nonce + ciphertext.
 */
function encryptEmberKeyForUser(emberKey, recipientPublicKey, senderPrivateKey) {
  console.debug('[Crypto] Encrypting ember key for user (NaCl box)');
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const encrypted = nacl.box(emberKey, nonce, recipientPublicKey, senderPrivateKey);
  const combined = new Uint8Array(nonce.length + encrypted.length);
  combined.set(nonce);
  combined.set(encrypted, nonce.length);
  return naclUtil.encodeBase64(combined);
}

/**
 * Decrypt an ember key that was encrypted for this user.
 * @param {string} encryptedBase64 - Base64 encoded nonce + ciphertext.
 * @param {Uint8Array} senderPublicKey - Sender's public key (the encryptor).
 * @param {Uint8Array} recipientPrivateKey - This user's private key.
 * @returns {Uint8Array|null} The decrypted ember key bytes, or null on failure.
 */
function decryptEmberKeyForUser(encryptedBase64, senderPublicKey, recipientPrivateKey) {
  console.debug('[Crypto] Decrypting ember key for user (NaCl box)');
  const combined = naclUtil.decodeBase64(encryptedBase64);
  const nonce = combined.slice(0, nacl.box.nonceLength);
  const ciphertext = combined.slice(nacl.box.nonceLength);
  const decrypted = nacl.box.open(ciphertext, nonce, senderPublicKey, recipientPrivateKey);
  if (!decrypted) {
    console.error('[Crypto] Ember key decryption failed: authentication failed');
  }
  return decrypted || null;
}

/**
 * Encrypt a plaintext message using NaCl secretbox with the ember key.
 * @param {string} plaintext - The message text.
 * @param {Uint8Array} emberKey - The 32-byte ember symmetric key.
 * @returns {string} Base64 encoded nonce + ciphertext.
 */
function encryptMessage(plaintext, emberKey) {
  console.debug('[Crypto] Encrypting message (NaCl secretbox)');
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const messageBytes = naclUtil.decodeUTF8(plaintext);
  const encrypted = nacl.secretbox(messageBytes, nonce, emberKey);
  const combined = new Uint8Array(nonce.length + encrypted.length);
  combined.set(nonce);
  combined.set(encrypted, nonce.length);
  return naclUtil.encodeBase64(combined);
}

/**
 * Decrypt a ciphertext message using NaCl secretbox with the ember key.
 * @param {string} ciphertextBase64 - Base64 encoded nonce + ciphertext.
 * @param {Uint8Array} emberKey - The 32-byte ember symmetric key.
 * @returns {string|null} The decrypted plaintext, or null on failure.
 */
function decryptMessage(ciphertextBase64, emberKey) {
  try {
    console.debug('[Crypto] Decrypting message (NaCl secretbox)');
    const combined = naclUtil.decodeBase64(ciphertextBase64);
    const nonce = combined.slice(0, nacl.secretbox.nonceLength);
    const ciphertext = combined.slice(nacl.secretbox.nonceLength);
    const decrypted = nacl.secretbox.open(ciphertext, nonce, emberKey);
    if (!decrypted) {
      console.warn('[Crypto] Message decryption returned null: authentication failed or wrong key');
      return null;
    }
    return naclUtil.encodeUTF8(decrypted);
  } catch (err) {
    console.error('[Crypto] Message decryption threw an error:', err);
    return null;
  }
}

/**
 * Derive a 32-byte encryption key from an invite code using PBKDF2.
 * @param {string} inviteCode - The invite code string.
 * @param {Uint8Array} salt - Random salt bytes.
 * @returns {Promise<Uint8Array>} The derived 32-byte key.
 */
async function deriveKeyFromInviteCode(inviteCode, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(inviteCode),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );
  return new Uint8Array(derivedBits);
}

/**
 * Encrypt an ember key for sharing via invite link.
 * @param {Uint8Array} emberKey - The ember symmetric key.
 * @param {string} inviteCode - The invite code string.
 * @returns {Promise<{encrypted: string, salt: string}>} Base64 encoded encrypted key and salt.
 */
async function encryptEmberKeyForInvite(emberKey, inviteCode) {
  console.debug('[Crypto] Encrypting ember key for invite (PBKDF2 + NaCl secretbox)');
  const salt = nacl.randomBytes(32);
  const derivedKey = await deriveKeyFromInviteCode(inviteCode, salt);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const encrypted = nacl.secretbox(emberKey, nonce, derivedKey);
  const combined = new Uint8Array(nonce.length + encrypted.length);
  combined.set(nonce);
  combined.set(encrypted, nonce.length);
  console.debug('[Crypto] Ember key encrypted for invite');
  return {
    encrypted: naclUtil.encodeBase64(combined),
    salt: naclUtil.encodeBase64(salt)
  };
}

/**
 * Decrypt an ember key received via invite link.
 * @param {string} encryptedBase64 - Base64 encoded nonce + ciphertext.
 * @param {string} inviteCode - The invite code string.
 * @param {string} saltBase64 - Base64 encoded salt.
 * @returns {Promise<Uint8Array|null>} The decrypted ember key bytes, or null on failure.
 */
async function decryptEmberKeyFromInvite(encryptedBase64, inviteCode, saltBase64) {
  try {
    console.debug('[Crypto] Decrypting ember key from invite (PBKDF2 + NaCl secretbox)');
    const combined = naclUtil.decodeBase64(encryptedBase64);
    const salt = naclUtil.decodeBase64(saltBase64);
    const derivedKey = await deriveKeyFromInviteCode(inviteCode, salt);
    const nonce = combined.slice(0, nacl.secretbox.nonceLength);
    const ciphertext = combined.slice(nacl.secretbox.nonceLength);
    const decrypted = nacl.secretbox.open(ciphertext, nonce, derivedKey);
    if (!decrypted) {
      console.error('[Crypto] Ember key from invite decryption failed: invalid invite code or corrupted data');
    } else {
      console.debug('[Crypto] Ember key from invite decrypted successfully');
    }
    return decrypted || null;
  } catch (err) {
    console.error('[Crypto] Ember key from invite decryption threw an error:', err);
    return null;
  }
}

module.exports = {
  generateRecoveryCode,
  encryptPrivateKeyWithRecoveryCode,
  decryptPrivateKeyWithRecoveryCode,
  generateEmberKey,
  encryptEmberKeyForUser,
  decryptEmberKeyForUser,
  encryptMessage,
  decryptMessage,
  encryptEmberKeyForInvite,
  decryptEmberKeyFromInvite
};
