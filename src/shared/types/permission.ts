/**
 * Permission system types and bitfield constants.
 *
 * Mirrors the Go permission model in ember-server/internal/domain/permission.
 * Permissions are stored as serialized bigint strings over the wire (same as
 * Discord API v8+) and parsed with BigInt() on the client.
 */

// ── Permission Bitfield Constants ───────────────────────────────────────────

export const Permission = {
  ViewChannels: 1n << 0n,
  ManageChannels: 1n << 1n,
  ManageEmber: 1n << 2n,
  CreateInvites: 1n << 3n,
  KickMembers: 1n << 4n,
  BanMembers: 1n << 5n,
  Administrator: 1n << 6n,
  ManageCategories: 1n << 7n,
  ManageRoles: 1n << 8n,
  SendMessages: 1n << 9n,
  ManageMessages: 1n << 10n,
  AttachFiles: 1n << 11n,
  MentionEveryone: 1n << 12n,
  ReadMessageHistory: 1n << 13n,
  Connect: 1n << 14n,
  Speak: 1n << 15n,
  MuteMembers: 1n << 16n,
  DeafenMembers: 1n << 17n,
  MoveMembers: 1n << 18n,
  ManageWebhooks: 1n << 19n,
} as const;

export const AllPermissions: bigint = (1n << 20n) - 1n;

export type PermissionFlag = (typeof Permission)[keyof typeof Permission];

// ── Data Types ──────────────────────────────────────────────────────────────

export interface Role {
  id: string;
  emberId: string;
  name: string;
  color: string;
  permissions: string;
  position: number;
  hoist: boolean;
  mentionable: boolean;
  isEveryone: boolean;
}

export interface ChannelOverwrite {
  id: string;
  channelId: string;
  targetId: string;
  targetType: 0 | 1;
  allow: string;
  deny: string;
}

export interface MemberWithRoles {
  userId: string;
  roles: Role[];
}

// ── Permission Computation ──────────────────────────────────────────────────

export function computeBasePermissions(member: MemberWithRoles, emberOwnerId: string): bigint {
  if (member.userId === emberOwnerId) {
    return AllPermissions;
  }

  let perms = 0n;

  for (const role of member.roles) {
    perms |= BigInt(role.permissions);
  }

  if ((perms & Permission.Administrator) !== 0n) {
    return AllPermissions;
  }

  return perms;
}

export function computeChannelPermissions(
  basePerms: bigint,
  member: MemberWithRoles,
  everyoneRoleId: string,
  overwrites: ChannelOverwrite[]
): bigint {
  if (basePerms === AllPermissions) {
    return AllPermissions;
  }

  let perms = basePerms;

  // 1. @everyone role overwrite
  for (const ow of overwrites) {
    if (ow.targetType === 0 && ow.targetId === everyoneRoleId) {
      perms = (perms & ~BigInt(ow.deny)) | BigInt(ow.allow);
      break;
    }
  }

  // 2. Merge all other role overwrites (additive)
  const roleIds = new Set(member.roles.filter(r => r.id !== everyoneRoleId).map(r => r.id));

  let roleDeny = 0n;
  let roleAllow = 0n;

  for (const ow of overwrites) {
    if (ow.targetType === 0 && roleIds.has(ow.targetId)) {
      roleDeny |= BigInt(ow.deny);
      roleAllow |= BigInt(ow.allow);
    }
  }

  perms = (perms & ~roleDeny) | roleAllow;

  // 3. Member-specific overwrite (highest priority)
  for (const ow of overwrites) {
    if (ow.targetType === 1 && ow.targetId === member.userId) {
      perms = (perms & ~BigInt(ow.deny)) | BigInt(ow.allow);
      break;
    }
  }

  return perms;
}

export function hasPermission(perms: bigint, perm: bigint): boolean {
  return (perms & perm) === perm;
}
