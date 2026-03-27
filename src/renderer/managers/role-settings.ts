/**
 * Role settings manager — handles the role management modal UI.
 * Provides CRUD for roles, permission toggles, and member-role assignment.
 */

(function (): void {
  const App = window.App;
  const log = window.emberLog.createLogger('RoleSettings');

  const PERMISSION_LABELS: Array<{ flag: bigint; name: string; description: string }> = [
    { flag: 1n << 0n, name: 'View Channels', description: 'See channels in the list' },
    { flag: 1n << 1n, name: 'Manage Channels', description: 'Create, edit, delete channels' },
    { flag: 1n << 2n, name: 'Manage Ember', description: 'Edit server name and icon' },
    { flag: 1n << 3n, name: 'Create Invites', description: 'Generate invite links' },
    { flag: 1n << 4n, name: 'Kick Members', description: 'Remove members from server' },
    { flag: 1n << 5n, name: 'Ban Members', description: 'Ban members from server' },
    { flag: 1n << 6n, name: 'Administrator', description: 'All permissions, bypasses overwrites' },
    { flag: 1n << 7n, name: 'Manage Categories', description: 'Create, edit, delete categories' },
    { flag: 1n << 8n, name: 'Manage Roles', description: 'Create, edit, delete roles' },
    { flag: 1n << 9n, name: 'Send Messages', description: 'Send messages in text channels' },
    { flag: 1n << 10n, name: 'Manage Messages', description: "Delete others' messages" },
    { flag: 1n << 11n, name: 'Attach Files', description: 'Upload file attachments' },
    { flag: 1n << 12n, name: 'Mention Everyone', description: 'Use @everyone mentions' },
    { flag: 1n << 13n, name: 'Read History', description: 'View past messages' },
    { flag: 1n << 14n, name: 'Connect', description: 'Join voice channels' },
    { flag: 1n << 15n, name: 'Speak', description: 'Transmit audio in voice' },
    { flag: 1n << 16n, name: 'Mute Members', description: 'Server-mute others in voice' },
    { flag: 1n << 17n, name: 'Deafen Members', description: 'Server-deafen others in voice' },
    { flag: 1n << 18n, name: 'Move Members', description: 'Move members between voice channels' },
  ];

  interface RoleData {
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

  const modal = document.getElementById('role-settings-modal');
  const closeBtn = document.getElementById('role-settings-close-btn');
  const createBtn = document.getElementById('role-create-btn');
  const roleList = document.getElementById('role-list');
  const roleEditor = document.getElementById('role-editor');
  const roleNameInput = document.getElementById('role-name-input') as HTMLInputElement | null;
  const roleColorInput = document.getElementById('role-color-input') as HTMLInputElement | null;
  const permGrid = document.getElementById('role-permissions-grid');
  const saveBtn = document.getElementById('role-save-btn');
  const deleteBtn = document.getElementById('role-delete-btn');
  const cancelEditBtn = document.getElementById('role-cancel-edit-btn');
  const errorEl = document.getElementById('role-settings-error');
  const memberListEl = document.getElementById('role-member-list');

  let currentEmberId: string | null = null;
  let roles: RoleData[] = [];
  let editingRole: RoleData | null = null;
  let editingPermissions = 0n;

  // ── Tab switching ───────────────────────────────────────────────────────

  document.querySelectorAll<HTMLElement>('.role-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll<HTMLElement>('.role-tab').forEach(t => {
        t.classList.remove('active');
        t.style.borderBottomColor = 'transparent';
        t.style.color = 'var(--text-secondary)';
      });
      tab.classList.add('active');
      tab.style.borderBottomColor = 'var(--accent-color, #5865f2)';
      tab.style.color = 'var(--text-primary)';

      document.querySelectorAll<HTMLElement>('.role-tab-content').forEach(c => {
        c.style.display = 'none';
      });
      const target = tab.dataset['tab'];
      const targetEl = document.getElementById(`role-tab-${target}`);
      if (targetEl) targetEl.style.display = '';

      if (target === 'members') {
        renderMemberRoleList();
      }
    });
  });

  // ── Open / Close ──────────────────────────────────────────────────────

  function openRoleSettingsModal(ember: Ember): void {
    if (!modal) return;
    currentEmberId = ember.id;
    const title = document.getElementById('role-settings-title');
    if (title) title.textContent = `${ember.name} — Settings`;
    modal.classList.remove('hidden');
    if (roleEditor) roleEditor.style.display = 'none';
    editingRole = null;
    hideError();
    loadRoles();
  }

  function closeRoleSettingsModal(): void {
    modal?.classList.add('hidden');
    currentEmberId = null;
    editingRole = null;
    roles = [];
  }

  closeBtn?.addEventListener('click', closeRoleSettingsModal);
  modal?.addEventListener('click', (e: Event) => {
    if (e.target === modal) closeRoleSettingsModal();
  });

  // ── Load roles from server ────────────────────────────────────────────

  async function getAuth(): Promise<{
    token: string;
    hostname: string;
    userId: string;
  } | null> {
    const auth = await window.getValidAuth?.();
    if (!auth?.token || !auth?.hostname) return null;
    return auth as { token: string; hostname: string; userId: string };
  }

  async function loadRoles(): Promise<void> {
    if (!currentEmberId) return;
    const auth = await getAuth();
    if (!auth) return;

    try {
      const resp = await fetch(`${auth.hostname}/api/v1/embers/${currentEmberId}/roles`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!resp.ok) throw new Error('Failed to fetch roles');
      const data = (await resp.json()) as { roles: RoleData[] };
      roles = data.roles ?? [];
      renderRoleList();
    } catch (err) {
      log.error('Failed to load roles', { error: (err as Error).message });
      showError('Failed to load roles');
    }
  }

  // ── Render role list ──────────────────────────────────────────────────

  function renderRoleList(): void {
    if (!roleList) return;
    roleList.replaceChildren();

    for (const role of roles) {
      const row = document.createElement('div');
      row.style.cssText =
        'display: flex; align-items: center; padding: 8px 12px; border-radius: 4px; cursor: pointer; margin-bottom: 4px;';
      row.addEventListener('mouseenter', () => {
        row.style.background = 'var(--hover-bg, rgba(255,255,255,0.06))';
      });
      row.addEventListener('mouseleave', () => {
        row.style.background = '';
      });

      const colorDot = document.createElement('span');
      colorDot.style.cssText = `width: 12px; height: 12px; border-radius: 50%; background: ${role.color || '#99aab5'}; margin-right: 10px; flex-shrink: 0;`;
      row.appendChild(colorDot);

      const nameSpan = document.createElement('span');
      nameSpan.textContent = role.name;
      nameSpan.style.cssText = 'flex: 1; color: var(--text-primary); font-size: 0.9rem;';
      row.appendChild(nameSpan);

      const memberCount = document.createElement('span');
      memberCount.style.cssText = 'color: var(--text-secondary); font-size: 0.8rem;';
      memberCount.textContent = role.isEveryone ? 'everyone' : '';
      row.appendChild(memberCount);

      row.addEventListener('click', () => selectRole(role));
      roleList.appendChild(row);
    }
  }

  // ── Select role for editing ───────────────────────────────────────────

  function selectRole(role: RoleData): void {
    editingRole = role;
    editingPermissions = BigInt(role.permissions);

    if (roleNameInput) roleNameInput.value = role.name;
    if (roleColorInput) roleColorInput.value = role.color || '#5865f2';

    renderPermissionGrid();
    if (roleEditor) roleEditor.style.display = '';

    if (deleteBtn) {
      if (role.isEveryone) {
        (deleteBtn as HTMLButtonElement).style.display = 'none';
      } else {
        (deleteBtn as HTMLButtonElement).style.display = '';
      }
    }
  }

  function renderPermissionGrid(): void {
    if (!permGrid) return;
    permGrid.replaceChildren();

    for (const perm of PERMISSION_LABELS) {
      const label = document.createElement('label');
      label.style.cssText =
        'display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 4px; cursor: pointer;';
      label.addEventListener('mouseenter', () => {
        label.style.background = 'var(--hover-bg, rgba(255,255,255,0.04))';
      });
      label.addEventListener('mouseleave', () => {
        label.style.background = '';
      });

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = (editingPermissions & perm.flag) !== 0n;
      checkbox.style.cssText = 'accent-color: var(--accent-color, #5865f2);';
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          editingPermissions |= perm.flag;
        } else {
          editingPermissions &= ~perm.flag;
        }
      });
      label.appendChild(checkbox);

      const text = document.createElement('div');
      const nameEl = document.createElement('div');
      nameEl.textContent = perm.name;
      nameEl.style.cssText = 'color: var(--text-primary); font-size: 0.85rem;';
      text.appendChild(nameEl);
      const descEl = document.createElement('div');
      descEl.textContent = perm.description;
      descEl.style.cssText = 'color: var(--text-secondary); font-size: 0.75rem;';
      text.appendChild(descEl);
      label.appendChild(text);

      permGrid.appendChild(label);
    }
  }

  // ── Create role ───────────────────────────────────────────────────────

  createBtn?.addEventListener('click', async () => {
    if (!currentEmberId) return;
    const auth = await getAuth();
    if (!auth) return;

    try {
      const resp = await fetch(`${auth.hostname}/api/v1/embers/${currentEmberId}/roles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ name: 'New Role', color: '#99aab5', permissions: '0' }),
      });
      if (!resp.ok) throw new Error('Failed to create role');
      await loadRoles();
      const created = (await resp.json()) as RoleData;
      const found = roles.find(r => r.id === created.id);
      if (found) selectRole(found);
    } catch (err) {
      log.error('Failed to create role', { error: (err as Error).message });
      showError('Failed to create role');
    }
  });

  // ── Save role ─────────────────────────────────────────────────────────

  saveBtn?.addEventListener('click', async () => {
    if (!editingRole || !currentEmberId) return;
    const auth = await getAuth();
    if (!auth) return;

    const name = roleNameInput?.value.trim();
    if (!name) {
      showError('Role name is required');
      return;
    }

    try {
      const resp = await fetch(
        `${auth.hostname}/api/v1/embers/${currentEmberId}/roles/${editingRole.id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${auth.token}`,
          },
          body: JSON.stringify({
            name,
            color: roleColorInput?.value ?? '#5865f2',
            permissions: String(editingPermissions),
          }),
        }
      );
      if (!resp.ok) throw new Error('Failed to update role');
      hideError();
      if (roleEditor) roleEditor.style.display = 'none';
      editingRole = null;
      await loadRoles();
    } catch (err) {
      log.error('Failed to save role', { error: (err as Error).message });
      showError('Failed to save role');
    }
  });

  // ── Delete role ───────────────────────────────────────────────────────

  deleteBtn?.addEventListener('click', async () => {
    if (!editingRole || !currentEmberId || editingRole.isEveryone) return;
    const auth = await getAuth();
    if (!auth) return;

    try {
      const resp = await fetch(
        `${auth.hostname}/api/v1/embers/${currentEmberId}/roles/${editingRole.id}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${auth.token}` },
        }
      );
      if (!resp.ok) throw new Error('Failed to delete role');
      if (roleEditor) roleEditor.style.display = 'none';
      editingRole = null;
      await loadRoles();
    } catch (err) {
      log.error('Failed to delete role', { error: (err as Error).message });
      showError('Failed to delete role');
    }
  });

  cancelEditBtn?.addEventListener('click', () => {
    if (roleEditor) roleEditor.style.display = 'none';
    editingRole = null;
  });

  // ── Member-role assignment tab ────────────────────────────────────────

  async function renderMemberRoleList(): Promise<void> {
    if (!memberListEl || !currentEmberId) return;
    memberListEl.replaceChildren();

    const auth = await getAuth();
    if (!auth) return;

    const members = App.currentMembers;
    if (!members.length) {
      memberListEl.textContent = 'No members loaded.';
      return;
    }

    for (const member of members) {
      const row = document.createElement('div');
      row.style.cssText =
        'display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border-color, #2a2a2a);';

      const nameEl = document.createElement('span');
      nameEl.textContent = member.username;
      nameEl.style.cssText = 'color: var(--text-primary); font-size: 0.9rem;';
      row.appendChild(nameEl);

      const roleSelect = document.createElement('select');
      roleSelect.style.cssText =
        'background: var(--input-bg, #1a1a1a); border: 1px solid var(--border-color, #2a2a2a); color: var(--text-primary); border-radius: 4px; padding: 4px 8px; font-size: 0.85rem;';

      // Fetch this member's current roles
      try {
        const resp = await fetch(
          `${auth.hostname}/api/v1/embers/${currentEmberId}/members/${member.userId}/roles`,
          { headers: { Authorization: `Bearer ${auth.token}` } }
        );
        const data = resp.ok
          ? ((await resp.json()) as { roles: RoleData[] })
          : { roles: [] as RoleData[] };
        const memberRoleIds = new Set(data.roles.map(r => r.id));

        for (const role of roles) {
          if (role.isEveryone) continue;

          const label = document.createElement('label');
          label.style.cssText = 'display: flex; align-items: center; gap: 4px; margin-left: 8px;';

          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = memberRoleIds.has(role.id);
          cb.style.cssText = 'accent-color: var(--accent-color, #5865f2);';
          cb.addEventListener('change', async () => {
            try {
              const url = `${auth.hostname}/api/v1/embers/${currentEmberId}/members/${member.userId}/roles/${role.id}`;
              const method = cb.checked ? 'PUT' : 'DELETE';
              await fetch(url, {
                method,
                headers: { Authorization: `Bearer ${auth.token}` },
              });
            } catch {
              cb.checked = !cb.checked;
            }
          });

          label.appendChild(cb);

          const roleName = document.createElement('span');
          roleName.textContent = role.name;
          roleName.style.cssText = `color: ${role.color || 'var(--text-secondary)'}; font-size: 0.8rem;`;
          label.appendChild(roleName);

          row.appendChild(label);
        }
      } catch {
        // Skip member on error
      }

      memberListEl.appendChild(row);
    }
  }

  // ── Error helpers ─────────────────────────────────────────────────────

  function showError(msg: string): void {
    if (errorEl) {
      errorEl.textContent = msg;
      errorEl.classList.remove('hidden');
    }
  }

  function hideError(): void {
    errorEl?.classList.add('hidden');
  }

  // ── Exports ───────────────────────────────────────────────────────────

  window.openRoleSettingsModal = openRoleSettingsModal;
  window.closeRoleSettingsModal = closeRoleSettingsModal;
})();
