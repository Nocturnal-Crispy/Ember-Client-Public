/** Shared type definitions for authentication, devices, and session state. */

export interface AuthData {
  token: string;
  user_id: string;
  device_id: string;
  hostname: string;
  username: string;
}

export interface DeviceIdentity {
  device_id: string;
  public_key: string;
  private_key: string;
}

export interface RegistrationPayload {
  username: string;
  password: string;
  device_id: string;
  public_key: string;
  encrypted_device_key: string;
  salt: string;
}

export interface LoginPayload {
  username: string;
  password: string;
  device_id: string;
}

export interface AuthResponse extends AuthData {
  _recoveryCode?: string;
}

export interface RecoveryData {
  encrypted: string;
  salt: string;
}
