import type { AuthData, Channel, Category } from '../types';
import { apiRequest } from '../api';

interface ChannelsResponse {
  channels?: Channel[];
  categories?: Category[];
}

interface EmberKeyResponse {
  encrypted_key?: string;
}

export async function fetchChannels(
  auth: AuthData,
  emberId: string,
): Promise<{ channels: Channel[]; categories: Category[] }> {
  // Fetch both channels and categories in parallel
  const [channelsResponse, categoriesResponse] = await Promise.all([
    apiRequest<{ channels?: Channel[] }>(
      auth.hostname,
      `/api/v1/embers/${emberId}/channels`,
      { method: 'GET' },
      auth.token,
    ),
    apiRequest<{ categories?: Category[] }>(
      auth.hostname,
      `/api/v1/embers/${emberId}/categories`,
      { method: 'GET' },
      auth.token,
    ),
  ]);

  return {
    channels: channelsResponse.channels ?? [],
    categories: categoriesResponse.categories ?? [],
  };
}

export async function fetchEmberKey(
  auth: AuthData,
  emberId: string,
): Promise<{ encryptedEmberKey: string } | null> {
  try {
    const data = await apiRequest<EmberKeyResponse>(
      auth.hostname,
      `/api/v1/embers/${emberId}/key`,
      { method: 'GET' },
      auth.token,
    );
    if (!data.encrypted_key) return null;
    return { encryptedEmberKey: data.encrypted_key };
  } catch {
    return null;
  }
}
