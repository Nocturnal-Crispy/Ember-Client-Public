/**
 * username-click-handler.ts — Reusable username click utility.
 *
 * Provides makeUsernameClickable() to attach click handlers to any element
 * that displays a username, wiring it up to the user details modal.
 *
 * Load order: must appear in main-loader AFTER user-details-modal.js.
 */
(function (): void {
  const log = window.emberLog.createLogger('UsernameClickHandler');

  /**
   * Make a DOM element behave as a clickable username that opens the
   * user details modal.
   *
   * @param el       - The element to make clickable (span, div, etc.).
   * @param userId   - The user's ID.
   * @param username - The user's display name.
   */
  function makeUsernameClickable(el: HTMLElement, userId: string, username: string): void {
    el.style.cursor = 'pointer';
    el.classList.add('username-clickable');

    el.addEventListener('click', e => {
      e.stopPropagation();
      log.debug('Username clicked', { userId, username });
      (window as any).openUserDetailsModal?.(userId, username);
    });
  }

  // ─── Expose globals ─────────────────────────────────────────────────────────

  window.makeUsernameClickable = makeUsernameClickable;
})();
