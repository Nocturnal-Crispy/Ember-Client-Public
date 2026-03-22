/** Shared type definitions for authentication, devices, and session state. */

export interface AuthData {
  token: string;
  userId: string;
  deviceId: string;
  hostname: string;
  username: string;
}

export interface DeviceIdentity {
  deviceId: string;
  publicKey: string;
  privateKey: string;
}

export interface RegistrationPayload {
  username: string;
  password: string;
  deviceId: string;
  publicKey: string;
  encryptedDeviceKey: string;
  salt: string;
}

export interface LoginPayload {
  username: string;
  password: string;
  deviceId: string;
}

export interface AuthResponse extends AuthData {
  _recoveryCode?: string;
  minimumClientVersion?: string;
}

export interface RecoveryData {
  encrypted: string;
  salt: string;
}

export interface SignalDeviceCredentials {
  readonly deviceId: string;
  readonly registrationId: number;
  readonly identityKeyPair: {
    readonly publicKey: Uint8Array;
    readonly privateKey: Uint8Array;
  };
  readonly signedPreKey: {
    readonly id: number;
    readonly keyPair: { readonly publicKey: Uint8Array; readonly privateKey: Uint8Array };
    readonly signature: Uint8Array;
    readonly timestamp: number;
  };
  readonly oneTimePreKeys: ReadonlyArray<{
    readonly id: number;
    readonly keyPair: { readonly publicKey: Uint8Array; readonly privateKey: Uint8Array };
  }>;
}
