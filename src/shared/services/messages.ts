import type { AuthData } from '../types';
import type { Message } from '../protocol';
import { apiRequest } from '../api';

interface AttachmentMeta {
  name: string;
  size: number;
  mime: string;
}

interface AttachmentUploadResponse {
  id: string;
  createdAt: number;
}

export interface AttachmentDownloadResponse {
  id: string;
  encryptedData: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: number;
}

interface MessagesResponse {
  messages?: Message[];
  hasMore?: boolean;
}

export async function fetchMessages(
  auth: AuthData,
  channelId: string,
  beforeId?: string
): Promise<{ messages: Message[]; hasMore: boolean }> {
  const params = new URLSearchParams({ limit: '20' });
  if (beforeId) params.set('before', beforeId);

  const data = await apiRequest<MessagesResponse>(
    auth.hostname,
    `/api/v1/channels/${channelId}/messages?${params}`,
    { method: 'GET' },
    auth.token
  );

  return {
    messages: data.messages ?? [],
    hasMore: data.hasMore ?? false,
  };
}

export async function sendMessage(
  auth: AuthData,
  channelId: string,
  plaintext: string,
  _emberKey?: Uint8Array
): Promise<Message> {
  const ciphertext = plaintext;
  return apiRequest<Message>(
    auth.hostname,
    `/api/v1/channels/${channelId}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({ ciphertext }),
    },
    auth.token
  );
}

export async function editMessage(
  auth: AuthData,
  channelId: string,
  messageId: string,
  plaintext: string,
  _emberKey?: Uint8Array
): Promise<void> {
  const ciphertext = plaintext;
  await apiRequest<unknown>(
    auth.hostname,
    `/api/v1/channels/${channelId}/messages/${messageId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ ciphertext }),
    },
    auth.token
  );
}

export async function deleteMessage(
  auth: AuthData,
  channelId: string,
  messageId: string
): Promise<void> {
  await apiRequest<unknown>(
    auth.hostname,
    `/api/v1/channels/${channelId}/messages/${messageId}`,
    { method: 'DELETE' },
    auth.token
  );
}

export async function uploadAttachment(
  auth: AuthData,
  channelId: string,
  encryptedData: string,
  meta: AttachmentMeta
): Promise<AttachmentUploadResponse> {
  return apiRequest<AttachmentUploadResponse>(
    auth.hostname,
    `/api/v1/channels/${channelId}/attachments`,
    {
      method: 'POST',
      body: JSON.stringify({
        encryptedData,
        ...meta,
      }),
    },
    auth.token
  );
}

export async function downloadAttachment(
  auth: AuthData,
  channelId: string,
  attachmentId: string
): Promise<AttachmentDownloadResponse> {
  return apiRequest<AttachmentDownloadResponse>(
    auth.hostname,
    `/api/v1/channels/${channelId}/attachments/${attachmentId}`,
    { method: 'GET' },
    auth.token
  );
}

export async function uploadDMAttachment(
  auth: AuthData,
  conversationId: string,
  encryptedData: string,
  meta: AttachmentMeta
): Promise<AttachmentUploadResponse> {
  return apiRequest<AttachmentUploadResponse>(
    auth.hostname,
    `/api/v1/conversations/${conversationId}/attachments`,
    {
      method: 'POST',
      body: JSON.stringify({
        encryptedData,
        ...meta,
      }),
    },
    auth.token
  );
}

export async function downloadDMAttachment(
  auth: AuthData,
  conversationId: string,
  attachmentId: string
): Promise<AttachmentDownloadResponse> {
  return apiRequest<AttachmentDownloadResponse>(
    auth.hostname,
    `/api/v1/conversations/${conversationId}/attachments/${attachmentId}`,
    { method: 'GET' },
    auth.token
  );
}
