import type { AuthData, DmEmber, CreateDmRequest } from '../types';
import { apiRequest } from '../api';

export async function fetchDMs(auth: AuthData): Promise<DmEmber[]> {
  const data = await apiRequest<{ dms?: DmEmber[] }>(
    auth.hostname,
    '/api/v1/dms',
    { method: 'GET' },
    auth.token,
  );
  return data.dms ?? [];
}

export async function createDM(
  auth: AuthData,
  request: CreateDmRequest,
): Promise<{ id: string }> {
  return apiRequest<{ id: string }>(
    auth.hostname,
    '/api/v1/dms',
    {
      method: 'POST',
      body: JSON.stringify(request),
    },
    auth.token,
  );
}
