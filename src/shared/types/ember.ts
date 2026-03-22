/** Shared type definitions for Ember communities, channels, members, and categories. */

export type UserStatus = 'online' | 'idle' | 'dnd' | 'invisible' | 'offline';

export interface Ember {
  id: string;
  name: string;
  iconData?: string | null;
  ownerId?: string;
  isOwner?: boolean;
}

export interface Channel {
  id: string;
  emberId: string;
  name: string;
  type: 'text' | 'voice';
  categoryId?: string | null;
  description?: string;
  position?: number;
}

export interface Category {
  id: string;
  emberId: string;
  name: string;
  position?: number;
}

export interface Member {
  userId: string;
  username: string;
  status: UserStatus;
  role: 'owner' | 'admin' | 'member';
  avatar?: string;
  customStatus?: string;
  statusEmoji?: string;
}

export interface ChannelReorderUpdate {
  id: string;
  position: number;
  categoryId?: string | null;
}

export interface CategoryReorderUpdate {
  id: string;
  position: number;
}

export interface DragItem {
  type: 'channel' | 'category' | 'ember';
  id: string;
}

export interface DmEmber {
  id: string;
  name: string;
  createdAt: string;
  partnerId: string;
  partnerUsername: string;
  partnerAvatar: string;
}

export interface CreateDmRequest {
  userId: string;
  encryptedKeySelf: string;
  encryptedKeyPeer: string;
}

export interface ContextMenuTarget {
  type: 'channel' | 'category' | 'empty';
  id: string | null;
  name: string | null;
  channelType: 'text' | 'voice' | null;
  categoryId: string | null;
  description?: string;
}
