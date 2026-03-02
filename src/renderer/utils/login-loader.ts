/**
 * login-loader.ts
 *
 * Fetches all login page HTML fragment files and assembles the page body,
 * then dynamically loads auth scripts in order.
 *
 * Compiled to public/src/js/utils/login-loader.js via tsconfig.renderer.json.
 * Referenced by public/login.html as the sole <script> tag.
 */
(function (): void {
  'use strict';

  const FRAGMENT_BASE = 'src/html/';

  const SCRIPTS: string[] = [
    'src/js/renderer/utils/logger.js',
    'src/js/renderer/services/auth-service.js',
  ];

  async function fetchFragment(name: string): Promise<string> {
    const response = await fetch(FRAGMENT_BASE + name);
    if (!response.ok) {
      throw new Error(`[login-loader] Failed to fetch fragment "${name}": HTTP ${response.status}`);
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
      el.onerror = () => reject(new Error(`[login-loader] Failed to load script: ${src}`));
      document.body.appendChild(el);
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const [
        titleBar,
        loginForm,
        modalRecoveryCode,
        overlayLoading,
      ] = await Promise.all([
        fetchFragment('title-bar.html'),
        fetchFragment('login-form.html'),
        fetchFragment('modal-recovery-code.html'),
        fetchFragment('overlay-loading.html'),
      ]);

      document.body.appendChild(parseFragment(titleBar));
      document.body.appendChild(parseFragment(loginForm));
      document.body.appendChild(parseFragment(modalRecoveryCode));
      document.body.appendChild(parseFragment(overlayLoading));

      // Load scripts sequentially — order matters for dependencies
      for (const src of SCRIPTS) {
        await loadScript(src);
      }
    } catch (err) {
      console.error('[login-loader] Initialization failed:', err);
    }
  });
})();
