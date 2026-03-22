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
  iconData?: string;
  encryptedEmberKey: string;
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
  iconData?: string;
}

export async function updateEmber(
  auth: AuthData,
  emberId: string,
  updates: UpdateEmberRequest
): Promise<Ember> {
  // Validate that at least one field is provided
  if (updates.name === undefined && updates.iconData === undefined) {
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
  maxUses?: number;
  expiresIn?: number;
  encryptedEmberKey: string;
  keySalt: string;
}

export interface CreateInviteResponse {
  code: string;
  inviteUrl: string;
  createdAt: number;
  expiresAt?: number;
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
    encryptedEmberKey,
    keySalt,
  };

  if (options?.code) {
    requestBody.code = options.code;
  }

  if (options?.maxUses) {
    requestBody.maxUses = options.maxUses;
  }

  if (options?.expiresIn) {
    requestBody.expiresIn = options.expiresIn;
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
  emberName: string;
  emberIcon?: string;
  memberCount: number;
  code: string;
  encryptedEmberKey: string;
  keySalt: string;
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
  encryptedEmberKey: string;
}

export interface AcceptInviteResponse {
  emberId: string;
  emberName: string;
  emberIcon?: string;
}

export async function acceptInvite(
  auth: AuthData,
  code: string,
  encryptedEmberKey: string,
  hostname?: string
): Promise<AcceptInviteResponse> {
  const targetHostname = hostname ?? auth.hostname;

  const requestBody: AcceptInviteRequest = {
    encryptedEmberKey,
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
  maxUses?: number;
  createdBy: string;
  createdAt: number;
  expiresAt?: number;
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
