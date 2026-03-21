/**
 * Envelope serialization/deserialization for Signal Protocol wire format (v1).
 *
 * Format: JSON with Uint8Array fields encoded as base64 strings, then
 * UTF-8 encoded to Uint8Array bytes via TextEncoder/TextDecoder.
 *
 * Upgrade path: replace JSON with Protobuf in a later sprint if needed.
 */

import type { MessageEnvelope, MessagePayload, AttachmentMeta } from './signal-types.js';

// ── Type aliases ─────────────────────────────────────────────────────────────

/** A MessageEnvelope carrying a Sender Key group message. */
export type GroupEnvelope = MessageEnvelope & { readonly type: 'group' };

/** A MessageEnvelope carrying a 1:1 Double Ratchet or X3DH prekey message. */
export type DmEnvelope = MessageEnvelope & { readonly type: 'dm' | 'preKeyMessage' };

// ── Internal JSON shape ───────────────────────────────────────────────────────

/** Wire-format representation where Uint8Array fields are base64 strings. */
interface EnvelopeJson {
  type: string;
  senderDeviceId: number;
  recipientDeviceId?: number;
  groupId?: string;
  ciphertext: string;
  ephemeralKey?: string;
  registrationId?: number;
  preKeyId?: number;
  signedPreKeyId?: number;
  timestamp: number;
}

interface AttachmentMetaJson {
  id: string;
  mimeType: string;
  size: number;
  key: string;
  iv: string;
  hash: string;
  url?: string;
}

interface MessagePayloadJson {
  text?: string;
  attachments?: AttachmentMetaJson[];
  replyToId?: string;
  metadata?: Record<string, unknown>;
}

// ── Binary ↔ base64 helpers ──────────────────────────────────────────────────

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function fromBase64(str: string): Uint8Array {
  return new Uint8Array(Buffer.from(str, 'base64'));
}

// ── Codec ↔ JSON helpers ─────────────────────────────────────────────────────

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodeJson(obj: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(obj));
}

function decodeJson<T>(bytes: Uint8Array): T {
  return JSON.parse(decoder.decode(bytes)) as T;
}

// ── MessageEnvelope (shared) ──────────────────────────────────────────────────

function envelopeToJson(envelope: MessageEnvelope): EnvelopeJson {
  const json: EnvelopeJson = {
    type: envelope.type,
    senderDeviceId: envelope.senderDeviceId,
    ciphertext: toBase64(envelope.ciphertext),
    timestamp: envelope.timestamp,
  };
  if (envelope.recipientDeviceId !== undefined) json.recipientDeviceId = envelope.recipientDeviceId;
  if (envelope.groupId !== undefined) json.groupId = envelope.groupId;
  if (envelope.ephemeralKey !== undefined) json.ephemeralKey = toBase64(envelope.ephemeralKey);
  if (envelope.registrationId !== undefined) json.registrationId = envelope.registrationId;
  if (envelope.preKeyId !== undefined) json.preKeyId = envelope.preKeyId;
  if (envelope.signedPreKeyId !== undefined) json.signedPreKeyId = envelope.signedPreKeyId;
  return json;
}

function envelopeFromJson(json: EnvelopeJson): MessageEnvelope {
  return {
    type: json.type as MessageEnvelope['type'],
    senderDeviceId: json.senderDeviceId,
    ...(json.recipientDeviceId !== undefined && { recipientDeviceId: json.recipientDeviceId }),
    ...(json.groupId !== undefined && { groupId: json.groupId }),
    ciphertext: fromBase64(json.ciphertext),
    ...(json.ephemeralKey !== undefined && { ephemeralKey: fromBase64(json.ephemeralKey) }),
    ...(json.registrationId !== undefined && { registrationId: json.registrationId }),
    ...(json.preKeyId !== undefined && { preKeyId: json.preKeyId }),
    ...(json.signedPreKeyId !== undefined && { signedPreKeyId: json.signedPreKeyId }),
    timestamp: json.timestamp,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Serialize a group envelope to bytes. */
export function serializeGroupEnvelope(envelope: GroupEnvelope): Uint8Array {
  return encodeJson(envelopeToJson(envelope));
}

/** Deserialize bytes back to a GroupEnvelope. */
export function deserializeGroupEnvelope(bytes: Uint8Array): GroupEnvelope {
  return envelopeFromJson(decodeJson<EnvelopeJson>(bytes)) as GroupEnvelope;
}

/** Serialize a DM or prekey envelope to bytes. */
export function serializeDmEnvelope(envelope: DmEnvelope): Uint8Array {
  return encodeJson(envelopeToJson(envelope));
}

/** Deserialize bytes back to a DmEnvelope. */
export function deserializeDmEnvelope(bytes: Uint8Array): DmEnvelope {
  return envelopeFromJson(decodeJson<EnvelopeJson>(bytes)) as DmEnvelope;
}

/** Serialize a message payload to bytes. */
export function serializeMessagePayload(payload: MessagePayload): Uint8Array {
  const json: MessagePayloadJson = {};
  if (payload.text !== undefined) json.text = payload.text;
  if (payload.replyToId !== undefined) json.replyToId = payload.replyToId;
  if (payload.metadata !== undefined) json.metadata = payload.metadata;
  if (payload.attachments !== undefined) {
    json.attachments = payload.attachments.map(attachmentToJson);
  }
  return encodeJson(json);
}

/** Deserialize bytes back to a MessagePayload. */
export function deserializeMessagePayload(bytes: Uint8Array): MessagePayload {
  const json = decodeJson<MessagePayloadJson>(bytes);
  const payload: MessagePayload = {
    ...(json.text !== undefined && { text: json.text }),
    ...(json.replyToId !== undefined && { replyToId: json.replyToId }),
    ...(json.metadata !== undefined && { metadata: json.metadata }),
    ...(json.attachments !== undefined && {
      attachments: json.attachments.map(attachmentFromJson),
    }),
  };
  return payload;
}

// ── Attachment helpers ────────────────────────────────────────────────────────

function attachmentToJson(att: AttachmentMeta): AttachmentMetaJson {
  const json: AttachmentMetaJson = {
    id: att.id,
    mimeType: att.mimeType,
    size: att.size,
    key: toBase64(att.key),
    iv: toBase64(att.iv),
    hash: toBase64(att.hash),
  };
  if (att.url !== undefined) json.url = att.url;
  return json;
}

function attachmentFromJson(json: AttachmentMetaJson): AttachmentMeta {
  return {
    id: json.id,
    mimeType: json.mimeType,
    size: json.size,
    key: fromBase64(json.key),
    iv: fromBase64(json.iv),
    hash: fromBase64(json.hash),
    ...(json.url !== undefined && { url: json.url }),
  };
}
