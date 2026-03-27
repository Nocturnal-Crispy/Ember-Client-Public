import {
  Permission,
  AllPermissions,
  computeBasePermissions,
  computeChannelPermissions,
  hasPermission,
  MemberWithRoles,
  Role,
  ChannelOverwrite,
} from '../../../src/shared/types/permission';

function makeRole(overrides: Partial<Role> & { id: string }): Role {
  return {
    emberId: 'ember-1',
    name: 'test',
    color: '',
    permissions: '0',
    position: 0,
    hoist: false,
    mentionable: false,
    isEveryone: false,
    ...overrides,
  };
}

describe('Permission computation', () => {
  describe('computeBasePermissions', () => {
    it('grants AllPermissions to ember owner', () => {
      const member: MemberWithRoles = {
        userId: 'owner-1',
        roles: [makeRole({ id: 'everyone', permissions: String(Permission.ViewChannels) })],
      };

      expect(computeBasePermissions(member, 'owner-1')).toBe(AllPermissions);
    });

    it('grants AllPermissions when Administrator flag is present', () => {
      const member: MemberWithRoles = {
        userId: 'user-2',
        roles: [
          makeRole({ id: 'everyone', permissions: String(Permission.ViewChannels) }),
          makeRole({ id: 'admin-role', permissions: String(Permission.Administrator) }),
        ],
      };

      expect(computeBasePermissions(member, 'owner-1')).toBe(AllPermissions);
    });

    it('ORs all role permissions together', () => {
      const member: MemberWithRoles = {
        userId: 'user-3',
        roles: [
          makeRole({
            id: 'everyone',
            permissions: String(Permission.ViewChannels | Permission.SendMessages),
          }),
          makeRole({
            id: 'mod-role',
            permissions: String(Permission.KickMembers | Permission.ManageMessages),
          }),
        ],
      };

      const result = computeBasePermissions(member, 'owner-1');

      expect(hasPermission(result, Permission.ViewChannels)).toBe(true);
      expect(hasPermission(result, Permission.SendMessages)).toBe(true);
      expect(hasPermission(result, Permission.KickMembers)).toBe(true);
      expect(hasPermission(result, Permission.ManageMessages)).toBe(true);
      expect(hasPermission(result, Permission.ManageEmber)).toBe(false);
    });
  });

  describe('computeChannelPermissions', () => {
    const everyoneRoleId = 'everyone';

    it('skips overwrites for AllPermissions', () => {
      const member: MemberWithRoles = { userId: 'user-1', roles: [] };
      const overwrites: ChannelOverwrite[] = [
        {
          id: 'ow-1',
          channelId: 'ch-1',
          targetId: 'user-1',
          targetType: 1,
          allow: '0',
          deny: String(Permission.SendMessages),
        },
      ];

      expect(computeChannelPermissions(AllPermissions, member, everyoneRoleId, overwrites)).toBe(
        AllPermissions
      );
    });

    it('applies @everyone deny', () => {
      const base = Permission.ViewChannels | Permission.SendMessages;
      const member: MemberWithRoles = {
        userId: 'user-1',
        roles: [makeRole({ id: everyoneRoleId })],
      };
      const overwrites: ChannelOverwrite[] = [
        {
          id: 'ow-1',
          channelId: 'ch-1',
          targetId: everyoneRoleId,
          targetType: 0,
          allow: '0',
          deny: String(Permission.SendMessages),
        },
      ];

      const result = computeChannelPermissions(base, member, everyoneRoleId, overwrites);

      expect(hasPermission(result, Permission.SendMessages)).toBe(false);
      expect(hasPermission(result, Permission.ViewChannels)).toBe(true);
    });

    it('role allow overrides @everyone deny', () => {
      const base = Permission.ViewChannels | Permission.SendMessages;
      const member: MemberWithRoles = {
        userId: 'user-1',
        roles: [makeRole({ id: everyoneRoleId }), makeRole({ id: 'vip-role' })],
      };
      const overwrites: ChannelOverwrite[] = [
        {
          id: 'ow-1',
          channelId: 'ch-1',
          targetId: everyoneRoleId,
          targetType: 0,
          allow: '0',
          deny: String(Permission.SendMessages),
        },
        {
          id: 'ow-2',
          channelId: 'ch-1',
          targetId: 'vip-role',
          targetType: 0,
          allow: String(Permission.SendMessages),
          deny: '0',
        },
      ];

      const result = computeChannelPermissions(base, member, everyoneRoleId, overwrites);

      expect(hasPermission(result, Permission.SendMessages)).toBe(true);
    });

    it('member deny overrides role allow (highest priority)', () => {
      const base = Permission.ViewChannels | Permission.SendMessages;
      const member: MemberWithRoles = {
        userId: 'user-1',
        roles: [makeRole({ id: everyoneRoleId }), makeRole({ id: 'mod-role' })],
      };
      const overwrites: ChannelOverwrite[] = [
        {
          id: 'ow-1',
          channelId: 'ch-1',
          targetId: 'mod-role',
          targetType: 0,
          allow: String(Permission.SendMessages),
          deny: '0',
        },
        {
          id: 'ow-2',
          channelId: 'ch-1',
          targetId: 'user-1',
          targetType: 1,
          allow: '0',
          deny: String(Permission.SendMessages),
        },
      ];

      const result = computeChannelPermissions(base, member, everyoneRoleId, overwrites);

      expect(hasPermission(result, Permission.SendMessages)).toBe(false);
    });
  });

  describe('hasPermission', () => {
    it('returns true when permission is present', () => {
      const perms = Permission.ViewChannels | Permission.SendMessages;

      expect(hasPermission(perms, Permission.SendMessages)).toBe(true);
    });

    it('returns false when permission is missing', () => {
      expect(hasPermission(Permission.ViewChannels, Permission.SendMessages)).toBe(false);
    });

    it('checks composite permissions', () => {
      expect(hasPermission(AllPermissions, Permission.KickMembers | Permission.BanMembers)).toBe(
        true
      );
    });

    it('returns false for zero perms', () => {
      expect(hasPermission(0n, Permission.ViewChannels)).toBe(false);
    });
  });
});
