/**
 * main-loader.ts
 *
 * Fetches all HTML fragment files and assembles the page body, then
 * dynamically loads application scripts in dependency order.
 *
 * Compiled to public/src/js/utils/main-loader.js via tsconfig.renderer.json.
 * Referenced by public/index.html as the sole <script> tag.
 */
(function (): void {
  'use strict';

  const FRAGMENT_BASE = 'src/html/';

  const SCRIPTS: string[] = [
    'src/js/utils/logger.js',
    'src/js/managers/app-state.js',
    'src/js/services/voice-service.js',
    'src/js/services/websocket-service.js',
    'src/js/services/message-service.js',
    'src/js/managers/channel-manager.js',
    'src/js/managers/ember-manager.js',
    'src/js/managers/invite-manager.js',
    'src/js/managers/voice-ui-manager.js',
    'src/js/managers/renderer.js',
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
      el.onload = () => resolve();
      el.onerror = () => reject(new Error(`[main-loader] Failed to load script: ${src}`));
      document.body.appendChild(el);
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const [
        titleBar,
        serverList,
        channelList,
        welcomeScreen,
        chatContainer,
        memberList,
        modalLogout,
        modalAddServer,
        modalJoinServer,
        modalCreateServer,
        modalCreateInvite,
        modalAcceptInvite,
        ctxChannel,
        ctxEmber,
        modalChannelName,
        modalDeleteConfirm,
        modalSettings,
        overlayReconnection,
      ] = await Promise.all([
        fetchFragment('title-bar.html'),
        fetchFragment('server-list.html'),
        fetchFragment('channel-list.html'),
        fetchFragment('welcome-screen.html'),
        fetchFragment('chat-container.html'),
        fetchFragment('member-list.html'),
        fetchFragment('modal-logout.html'),
        fetchFragment('modal-add-server.html'),
        fetchFragment('modal-join-server.html'),
        fetchFragment('modal-create-server.html'),
        fetchFragment('modal-create-invite.html'),
        fetchFragment('modal-accept-invite.html'),
        fetchFragment('context-menu-channel.html'),
        fetchFragment('context-menu-ember.html'),
        fetchFragment('modal-channel-name.html'),
        fetchFragment('modal-delete-confirm.html'),
        fetchFragment('modal-settings.html'),
        fetchFragment('overlay-reconnection.html'),
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

      // Modals and overlays (top-level, outside app-container)
      document.body.appendChild(parseFragment(modalLogout));
      document.body.appendChild(parseFragment(modalAddServer));
      document.body.appendChild(parseFragment(modalJoinServer));
      document.body.appendChild(parseFragment(modalCreateServer));
      document.body.appendChild(parseFragment(modalCreateInvite));
      document.body.appendChild(parseFragment(modalAcceptInvite));
      document.body.appendChild(parseFragment(ctxChannel));
      document.body.appendChild(parseFragment(ctxEmber));
      document.body.appendChild(parseFragment(modalChannelName));
      document.body.appendChild(parseFragment(modalDeleteConfirm));
      document.body.appendChild(parseFragment(modalSettings));
      document.body.appendChild(parseFragment(overlayReconnection));

      // Load scripts sequentially — order matters for dependencies
      for (const src of SCRIPTS) {
        await loadScript(src);
      }
    } catch (err) {
      console.error('[main-loader] Initialization failed:', err);
    }
  });
})();
