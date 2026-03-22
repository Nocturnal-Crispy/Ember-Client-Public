import type { AuthResponse, DeviceIdentity, RecoveryData, SignalDeviceCredentials } from '../types';
import { apiRequest, ApiError } from '../api';
import {
  generateIdentityKey,
  generateRegistrationId,
  generateSignedPreKey,
  generateOneTimePreKeys,
} from '../crypto/key-migration';

function generateUUID(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = (Array.from(bytes) as number[]).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function generateDeviceIdentity(): Promise<SignalDeviceCredentials> {
  const deviceId = generateUUID();
  const identityKeyPair = await generateIdentityKey();
  const registrationId = generateRegistrationId();
  const signedPreKey = await generateSignedPreKey(identityKeyPair, 1);
  const oneTimePreKeys = await generateOneTimePreKeys(0, 100);

  return {
    deviceId,
    registrationId,
    identityKeyPair,
    signedPreKey,
    oneTimePreKeys,
  };
}

export async function login(
  hostname: string,
  username: string,
  password: string,
  deviceId: string
): Promise<AuthResponse> {
  try {
    return await apiRequest<AuthResponse>(hostname, '/api/v1/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, device_id: deviceId }),
    });
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 401) {
      throw new Error('Invalid username or password');
    }
    throw err;
  }
}

export async function register(
  hostname: string,
  username: string,
  password: string,
  deviceId: string,
  publicKey: string,
  encryptedDeviceKey: string,
  salt: string
): Promise<AuthResponse> {
  return apiRequest<AuthResponse>(hostname, '/api/v1/register', {
    method: 'POST',
    body: JSON.stringify({
      username,
      password,
      device_id: deviceId,
      public_key: publicKey,
      encrypted_device_key: encryptedDeviceKey,
      salt,
    }),
  });
}

export async function registerWithSignalKeys(
  hostname: string,
  username: string,
  password: string,
  signalCredentials: SignalDeviceCredentials,
  publicKey: string,
  encryptedDeviceKey: string,
  salt: string
): Promise<AuthResponse> {
  return register(
    hostname,
    username,
    password,
    signalCredentials.deviceId,
    publicKey,
    encryptedDeviceKey,
    salt
  );
}

export async function registerWithRecovery(
  _hostname: string,
  _username: string,
  _password: string,
  _deviceIdentity: DeviceIdentity
): Promise<AuthResponse & { _recoveryCode: string }> {
  throw new Error('NaCl crypto removed — use Signal Protocol registration instead');
}

export function validateLoginForm(
  hostname: string,
  username: string,
  password: string
): string | null {
  if (!hostname) return 'Server URL is required';
  if (!hostname.startsWith('http://') && !hostname.startsWith('https://')) {
    return 'Server URL must start with http:// or https://';
  }
  if (!username) return 'Username is required';
  if (username.length < 3 || username.length > 20) return 'Username must be 3-20 characters';
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return 'Username can only contain letters, numbers, and underscores';
  }
  if (!password) return 'Password is required';
  if (password.length < 8) return 'Password must be at least 8 characters';
  return null;
}

export function validateRegisterForm(
  hostname: string,
  username: string,
  password: string,
  confirmPassword: string
): string | null {
  const loginError = validateLoginForm(hostname, username, password);
  if (loginError) return loginError;
  if (password !== confirmPassword) return 'Passwords do not match';
  return null;
}

export interface LoginWithRecoveryResult {
  auth: AuthResponse;
  recoveredIdentity: DeviceIdentity;
}

export async function loginWithRecoveryCode(
  _hostname: string,
  _username: string,
  _password: string,
  _recoveryCode: string,
  _newDeviceId: string
): Promise<LoginWithRecoveryResult> {
  throw new Error('NaCl crypto removed — use Signal Protocol device recovery instead');
}
