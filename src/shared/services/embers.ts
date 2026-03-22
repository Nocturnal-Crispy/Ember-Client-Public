import type { AuthData, Ember } from '../types';
import { apiRequest } from '../api';

export async function fetchEmbers(auth: AuthData): Promise<Ember[]> {
  const data = await apiRequest<{ embers?: Ember[] }>(
    auth.hostname,
    '/api/v1/embers',
    { method: 'GET' },
    auth.token
  );
  return data.embers ?? [];
}

export interface CreateEmberRequest {
  name: string;
  icon_data?: string;
  encrypted_ember_key: string;
}

export async function createEmber(
  _auth: AuthData,
  _name: string,
  _devicePublicKey: string,
  _devicePrivateKey: string,
  _iconData?: string
): Promise<Ember> {
  throw new Error('NaCl crypto removed — use Signal Protocol ember creation instead');
}

export interface UpdateEmberRequest {
  name?: string;
  icon_data?: string;
}

export async function updateEmber(
  auth: AuthData,
  emberId: string,
  updates: UpdateEmberRequest
): Promise<Ember> {
  // Validate that at least one field is provided
  if (updates.name === undefined && updates.icon_data === undefined) {
    throw new Error('At least one field must be provided for update');
  }

  // Validate name if provided
  if (updates.name !== undefined) {
    if (updates.name.trim() === '') {
      throw new Error('Name cannot be empty');
    }
    if (updates.name.length > 100) {
      throw new Error('Name must be 100 characters or less');
    }
  }

  const updatedEmber = await apiRequest<Ember>(
    auth.hostname,
    `/api/v1/embers/${emberId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(updates),
    },
    auth.token
  );

  return updatedEmber;
}

export interface CreateInviteRequest {
  code?: string;
  max_uses?: number;
  expires_in?: number;
  encrypted_ember_key: string;
  key_salt: string;
}

export interface CreateInviteResponse {
  code: string;
  invite_url: string;
  created_at: number;
  expires_at?: number;
}

export async function createInvite(
  auth: AuthData,
  emberId: string,
  encryptedEmberKey: string,
  keySalt: string,
  options?: {
    code?: string;
    maxUses?: number;
    expiresIn?: number;
  }
): Promise<CreateInviteResponse> {
  const requestBody: CreateInviteRequest = {
    encrypted_ember_key: encryptedEmberKey,
    key_salt: keySalt,
  };

  if (options?.code) {
    requestBody.code = options.code;
  }

  if (options?.maxUses) {
    requestBody.max_uses = options.maxUses;
  }

  if (options?.expiresIn) {
    requestBody.expires_in = options.expiresIn;
  }

  const response = await apiRequest<CreateInviteResponse>(
    auth.hostname,
    `/api/v1/embers/${emberId}/invites`,
    {
      method: 'POST',
      body: JSON.stringify(requestBody),
    },
    auth.token
  );

  return response;
}

export interface InviteInfo {
  ember_name: string;
  ember_icon?: string;
  member_count: number;
  code: string;
  encrypted_ember_key: string;
  key_salt: string;
  hostname?: string;
}

export async function fetchInviteInfo(
  auth: AuthData,
  code: string,
  hostname?: string
): Promise<InviteInfo> {
  const targetHostname = hostname ?? auth.hostname;

  const inviteInfo = await apiRequest<InviteInfo>(
    targetHostname,
    `/api/v1/invites/${code}`,
    { method: 'GET' },
    auth.token
  );

  return { ...inviteInfo, hostname: targetHostname };
}

export interface AcceptInviteRequest {
  encrypted_ember_key: string;
}

export interface AcceptInviteResponse {
  ember_id: string;
  ember_name: string;
  ember_icon?: string;
}

export async function acceptInvite(
  auth: AuthData,
  code: string,
  encryptedEmberKey: string,
  hostname?: string
): Promise<AcceptInviteResponse> {
  const targetHostname = hostname ?? auth.hostname;

  const requestBody: AcceptInviteRequest = {
    encrypted_ember_key: encryptedEmberKey,
  };

  const response = await apiRequest<AcceptInviteResponse>(
    targetHostname,
    `/api/v1/invites/${code}/accept`,
    {
      method: 'POST',
      body: JSON.stringify(requestBody),
    },
    auth.token
  );

  return response;
}

export interface Invite {
  code: string;
  uses: number;
  max_uses?: number;
  created_by: string;
  created_at: number;
  expires_at?: number;
}

export interface ListInvitesResponse {
  invites: Invite[];
}

export async function listInvites(auth: AuthData, emberId: string): Promise<Invite[]> {
  const response = await apiRequest<ListInvitesResponse>(
    auth.hostname,
    `/api/v1/embers/${emberId}/invites`,
    { method: 'GET' },
    auth.token
  );

  return response.invites;
}

export async function revokeInvite(auth: AuthData, code: string): Promise<void> {
  await apiRequest(auth.hostname, `/api/v1/invites/${code}`, { method: 'DELETE' }, auth.token);
}
