/**
 * Read All Manager — marks all channels and DM conversations as read.
 *
 * Handles the #read-all-btn button in the server list sidebar.
 * Delegates to clearAllChannelUnread (channel-manager) and
 * clearAllDmUnread (direct-messaging-ui) which are both client-side
 * operations — no server call is needed since read state is not persisted.
 */
(function (): void {
  const log = window.emberLog.createLogger('ReadAllManager');

  const btn = document.getElementById('read-all-btn') as HTMLElement | null;
  if (!btn) {
    log.warn('Read All button not found in DOM');
    return;
  }

  function executeReadAll(): void {
    window.clearAllChannelUnread?.();
    window.clearAllDmUnread?.();
    log.info('All messages marked as read');
  }

  btn.addEventListener('click', executeReadAll);
  window.readAll = executeReadAll;
})();
