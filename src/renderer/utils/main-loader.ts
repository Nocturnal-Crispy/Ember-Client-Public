/**
 * main-loader.ts
 *
 * Fetches all HTML fragment files and assembles the page body, then
 * dynamically loads application scripts in dependency order.
 *
 * Compiled to dist/renderer/utils/main-loader.js via tsconfig.renderer.json.
 * Referenced by src/renderer/index.html as the sole <script> tag.
 */
(function (): void {
  'use strict';

  const FRAGMENT_BASE = '';

  const SCRIPTS: string[] = [
    '../../dist/renderer/utils/logger.js',
    '../../dist/renderer/managers/theme-manager.js',
    '../../dist/renderer/utils/auth-loader.js',
    '../../dist/renderer/services/signal-service.js',
    '../../dist/renderer/services/epoch-service.js',
    '../../dist/renderer/services/epoch-history-service.js',
    '../../dist/renderer/services/invite-ephemeral-key-service.js',
    '../../dist/renderer/managers/signal-session-manager.js',
    '../../dist/renderer/services/history-crypto-service.js',
    '../../dist/renderer/managers/app-state.js',
    '../../dist/renderer/services/voice-service.js',
    '../../dist/renderer/services/websocket-service.js',
    '../../dist/renderer/services/user-service.js',
    '../../dist/renderer/components/user-details-modal.js',
    '../../dist/renderer/utils/username-click-handler.js',
    '../../dist/renderer/components/messages-area.js',
    '../../dist/renderer/components/format-toolbar.js',
    '../../dist/renderer/services/crypto-routing-service.js',
    '../../dist/renderer/services/message-service.js',
    '../../dist/renderer/managers/channel-manager.js',
    '../../dist/renderer/managers/ember-manager.js',
    '../../dist/renderer/managers/invite-manager.js',
    '../../dist/renderer/components/screen-share-modal.js',
    '../../dist/renderer/managers/voice-ui-manager.js',
    '../../dist/renderer/managers/notification-settings.js',
    '../../dist/renderer/managers/plugin-settings.js',
    '../../dist/renderer/managers/app-lock-manager.js',
    '../../dist/renderer/managers/update-notifier.js',
    '../../dist/renderer/components/update-modal.js',
    '../../dist/renderer/managers/version-display.js',
    '../../dist/renderer/managers/direct-messaging-manager.js',
    '../../dist/renderer/managers/direct-messaging-ui.js',
    '../../dist/renderer/managers/read-all-manager.js',
    '../../dist/renderer/managers/emoji-picker.js',
    '../../dist/renderer/managers/gif-picker.js',
    '../../dist/renderer/managers/renderer.js',
  ];

  async function fetchFragment(name: string): Promise<string> {
    const response = await fetch(FRAGMENT_BASE + name);
    if (!response.ok) {
      throw new Error(`[main-loader] Failed to fetch fragment "${name}": HTTP ${response.status}`);
    }
    return response.text();
  }

  /** Parse an HTML string and return a DocumentFragment of its body children. */
  function parseFragment(html: string): DocumentFragment {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const frag = document.createDocumentFragment();
    Array.from(doc.body.childNodes).forEach(node => frag.appendChild(node));
    return frag;
  }

  function loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      // Revert back to regular scripts - ES6 modules cause import resolution issues
      el.onload = () => {
        console.log(`[main-loader] Script loaded successfully: ${src}`);
        resolve();
      };
      el.onerror = () => {
        console.error(`[main-loader] Failed to load script: ${src}`);
        reject(new Error(`[main-loader] Failed to load script: ${src}`));
      };
      document.body.appendChild(el);
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const [
        titleBar,
        serverList,
        channelList,
        dmScreen,
        welcomeScreen,
        chatContainer,
        memberList,
        modalLogout,
        modalAddServer,
        modalJoinServer,
        modalCreateServer,
        modalEditEmber,
        modalCreateInvite,
        modalAcceptInvite,
        ctxChannel,
        ctxEmber,
        modalChannelName,
        modalDeleteConfirm,
        modalSettings,
        overlayReconnection,
        versionDisplay,
        modalAttachment,
        modalImageViewer,
        emojiPicker,
        gifPicker,
        modalExternalLink,
        modalCustomStatus,
        modalUserDetails,
        modalUpdate,
        modalAppLock,
        modalScreenShare,
      ] = await Promise.all([
        fetchFragment('title-bar.html'),
        fetchFragment('server-list.html'),
        fetchFragment('channel-list.html'),
        fetchFragment('dm-screen.html'),
        fetchFragment('welcome-screen.html'),
        fetchFragment('chat-container.html'),
        fetchFragment('member-list.html'),
        fetchFragment('modal-logout.html'),
        fetchFragment('modal-add-server.html'),
        fetchFragment('modal-join-server.html'),
        fetchFragment('modal-create-server.html'),
        fetchFragment('modal-edit-ember.html'),
        fetchFragment('modal-create-invite.html'),
        fetchFragment('modal-accept-invite.html'),
        fetchFragment('context-menu-channel.html'),
        fetchFragment('context-menu-ember.html'),
        fetchFragment('modal-channel-name.html'),
        fetchFragment('modal-delete-confirm.html'),
        fetchFragment('modal-settings.html'),
        fetchFragment('overlay-reconnection.html'),
        fetchFragment('version-display.html'),
        fetchFragment('modal-attachment.html'),
        fetchFragment('modal-image-viewer.html'),
        fetchFragment('emoji-picker.html'),
        fetchFragment('gif-picker.html'),
        fetchFragment('modal-external-link.html'),
        fetchFragment('modal-custom-status.html'),
        fetchFragment('modal-user-details.html'),
        fetchFragment('modal-update.html'),
        fetchFragment('modal-app-lock.html'),
        fetchFragment('modal-screen-share.html'),
      ]);

      // Title bar (top-level)
      document.body.appendChild(parseFragment(titleBar));

      // App container wraps the main layout columns
      const appContainer = document.createElement('div');
      appContainer.className = 'app-container';
      appContainer.appendChild(parseFragment(serverList));
      appContainer.appendChild(parseFragment(channelList));
      appContainer.appendChild(parseFragment(welcomeScreen));
      appContainer.appendChild(parseFragment(chatContainer));
      appContainer.appendChild(parseFragment(memberList));
      document.body.appendChild(appContainer);

      // DM Screen (hidden by default, shown when DM icon is clicked)
      document.body.appendChild(parseFragment(dmScreen));

      // Modals and overlays (top-level, outside app-container)
      document.body.appendChild(parseFragment(modalLogout));
      document.body.appendChild(parseFragment(modalAddServer));
      document.body.appendChild(parseFragment(modalJoinServer));
      document.body.appendChild(parseFragment(modalCreateServer));
      document.body.appendChild(parseFragment(modalEditEmber));
      document.body.appendChild(parseFragment(modalCreateInvite));
      document.body.appendChild(parseFragment(modalAcceptInvite));
      document.body.appendChild(parseFragment(ctxChannel));
      document.body.appendChild(parseFragment(ctxEmber));
      document.body.appendChild(parseFragment(modalChannelName));
      document.body.appendChild(parseFragment(modalDeleteConfirm));
      document.body.appendChild(parseFragment(modalSettings));
      document.body.appendChild(parseFragment(overlayReconnection));
      document.body.appendChild(parseFragment(versionDisplay));
      document.body.appendChild(parseFragment(modalAttachment));
      document.body.appendChild(parseFragment(modalImageViewer));
      document.body.appendChild(parseFragment(emojiPicker));
      document.body.appendChild(parseFragment(gifPicker));
      document.body.appendChild(parseFragment(modalExternalLink));
      document.body.appendChild(parseFragment(modalCustomStatus));
      document.body.appendChild(parseFragment(modalUserDetails));
      document.body.appendChild(parseFragment(modalUpdate));
      document.body.appendChild(parseFragment(modalAppLock));
      document.body.appendChild(parseFragment(modalScreenShare));

      // Load scripts sequentially — order matters for dependencies
      for (const src of SCRIPTS) {
        console.log(`[main-loader] Loading script: ${src}`);
        await loadScript(src);
      }
      console.log('[main-loader] All scripts loaded successfully');
    } catch (err) {
      console.error('[main-loader] Initialization failed:', err);
    }
  });
})();
