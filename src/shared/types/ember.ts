/** Shared type definitions for Ember communities, channels, members, and categories. */

export type UserStatus = 'online' | 'idle' | 'dnd' | 'invisible' | 'offline';

export interface Ember {
  id: string;
  name: string;
  icon_data?: string | null;
  owner_id?: string;
  is_owner?: boolean;
}

export interface Channel {
  id: string;
  ember_id: string;
  name: string;
  type: 'text' | 'voice';
  category_id?: string | null;
  description?: string;
  position?: number;
}

export interface Category {
  id: string;
  ember_id: string;
  name: string;
  position?: number;
}

export interface Member {
  user_id: string;
  username: string;
  status: UserStatus;
  role: 'owner' | 'admin' | 'member';
  avatar?: string;
  custom_status?: string;
  status_emoji?: string;
}

export interface ChannelReorderUpdate {
  id: string;
  position: number;
  category_id?: string | null;
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
  created_at: string;
  partner_id: string;
  partner_username: string;
  partner_avatar: string;
}

export interface CreateDmRequest {
  user_id: string;
  encrypted_key_self: string;
  encrypted_key_peer: string;
}

export interface ContextMenuTarget {
  type: 'channel' | 'category' | 'empty';
  id: string | null;
  name: string | null;
  channelType: 'text' | 'voice' | null;
  categoryId: string | null;
  description?: string;
}
