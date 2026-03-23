import type { AuthResponse, SignalDeviceCredentials } from '../types';
import { apiRequest, ApiError } from '../api';
import {
  generateIdentityKey,
  generateRegistrationId,
  generateSignedPreKey,
  generateOneTimePreKeys,
} from '../crypto/signal-keygen';

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
  deviceId: string,
  totpCode?: string,
  challengeToken?: string
): Promise<AuthResponse> {
  try {
    const body: Record<string, string> = { username, password, deviceId };
    if (totpCode) body.totpCode = totpCode;
    if (challengeToken) body.challengeToken = challengeToken;
    return await apiRequest<AuthResponse>(hostname, '/api/v1/login', {
      method: 'POST',
      body: JSON.stringify(body),
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
  publicKey: string
): Promise<AuthResponse> {
  return apiRequest<AuthResponse>(hostname, '/api/v1/register', {
    method: 'POST',
    body: JSON.stringify({
      username,
      password,
      deviceId,
      publicKey,
    }),
  });
}

export async function registerWithSignalKeys(
  hostname: string,
  username: string,
  password: string,
  signalCredentials: SignalDeviceCredentials,
  publicKey: string
): Promise<AuthResponse> {
  const identityKeyB64 = btoa(
    String.fromCharCode(...new Uint8Array(signalCredentials.identityKeyPair.publicKey))
  );
  return apiRequest<AuthResponse>(hostname, '/api/v1/register', {
    method: 'POST',
    body: JSON.stringify({
      username,
      password,
      deviceId: signalCredentials.deviceId,
      publicKey,
      identityKey: identityKeyB64,
      registrationId: signalCredentials.registrationId,
    }),
  });
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
