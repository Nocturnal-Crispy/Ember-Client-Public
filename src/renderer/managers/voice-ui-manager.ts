/**
 * Voice UI manager — TypeScript conversion of public/voice-ui.js.
 * Handles voice channel join/leave, camera, video grid, settings modal, and V&V settings.
 */
(function (): void {
  const App = window.App;
  const ipcRenderer = window.electronAPI.ipc;
  const log = window.emberLog.createLogger('VoiceUI');

  // ─── Voice Channel Functions ───────────────────────────────────────────────

  async function joinVoiceChannel(channelId: string, channelName: string): Promise<void> {
    if (!App.wsConnection || App.wsConnection.readyState !== WebSocket.OPEN) {
      log.warn('Cannot join voice channel: WebSocket not connected');
      return;
    }
    log.info('Joining voice channel', { channel_id: channelId, name: channelName });

    if (App.activeVoiceChannelId && App.activeVoiceChannelId !== channelId && App.voiceManager) {
      const leavingChannelId = App.activeVoiceChannelId;
      if (App.localCameraOn && App.wsConnection?.readyState === WebSocket.OPEN) {
        App.wsConnection.send(JSON.stringify({ type: 'voice_camera_off' }));
      }
      App.localCameraOn = false;
      App.videoParticipants.clear();
      updateVideoGridVisibility();
      const cameraBtn = document.getElementById('voice-camera-btn');
      if (cameraBtn) { cameraBtn.classList.remove('active'); cameraBtn.title = 'Start Camera'; cameraBtn.textContent = '📷'; }
      await (App.voiceManager as { leaveChannel(): Promise<void> }).leaveChannel();

      // Optimistically remove self from sidebar presence for the channel being left
      const leavingSelfId = (App.voiceManager as { auth?: AuthForVoice } | null)?.auth?.user_id;
      if (leavingSelfId) {
        const presence = App.voiceChannelPresence.get(leavingChannelId);
        if (presence) {
          const updated = new Map(presence);
          updated.delete(leavingSelfId);
          App.voiceChannelPresence.set(leavingChannelId, updated);
          renderVoiceParticipants(leavingChannelId);
        }
      }

      App.activeVoiceChannelId = null;
      App.voiceParticipants.clear();
      hideVoiceControls();
      renderVoiceParticipants(null);
      document.querySelectorAll('.voice-avatar.speaking').forEach(el => el.classList.remove('speaking'));
    }

    const auth = await ipcRenderer.invoke('get-auth') as AuthForVoice | null;
    if (!auth) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const VoiceManagerClass = (window as any).VoiceManager as new (ws: WebSocket, auth: AuthForVoice) => Record<string, unknown>;

    if (!App.voiceManager) {
      App.voiceManager = new VoiceManagerClass(App.wsConnection!, auth);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vm = App.voiceManager as any;
      vm.onSpeakingChanged    = (userId: string, isSpeaking: boolean) => updateSpeakingIndicator(userId, isSpeaking);
      vm.onParticipantsChanged = (participants: { user_id: string; username: string }[]) => {
        // Update own-session participant list (used for video grid)
        App.voiceParticipants.clear();
        participants.forEach((p: { user_id: string; username: string }) => App.voiceParticipants.set(p.user_id, p.username));
        // Update cross-channel presence for this channel's sidebar using captured channelId
        const presenceMap = new Map<string, string>();
        participants.forEach((p: { user_id: string; username: string }) => presenceMap.set(p.user_id, p.username));
        App.voiceChannelPresence.set(channelId, presenceMap);
        renderVoiceParticipants(App.activeVoiceChannelId);
      };
      vm.onCameraStateChanged = (userId: string, isOn: boolean) => handleRemoteCameraStateChanged(userId, isOn);
      vm.onVideoStreamAdded   = (streamId: string, stream: MediaStream) => handleRemoteVideoStream(streamId, stream);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vm = App.voiceManager as any;
      vm.ws   = App.wsConnection!;
      vm.auth = auth;
      // Re-capture channelId in the participants callback for the new channel
      vm.onParticipantsChanged = (participants: { user_id: string; username: string }[]) => {
        App.voiceParticipants.clear();
        participants.forEach((p: { user_id: string; username: string }) => App.voiceParticipants.set(p.user_id, p.username));
        const presenceMap = new Map<string, string>();
        participants.forEach((p: { user_id: string; username: string }) => presenceMap.set(p.user_id, p.username));
        App.voiceChannelPresence.set(channelId, presenceMap);
        renderVoiceParticipants(App.activeVoiceChannelId);
      };
    }

    // Register the SFU-connected callback before joining so UI and sound fire only
    // once the WebRTC peer connection to the SFU is actually established.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (App.voiceManager as any).onConnected = () => {
      log.info('SFU connection established, showing voice controls', { channel_id: channelId });
      playVoiceSound('userJoin');
      App.activeVoiceChannelId = channelId;
      showVoiceControls(channelName);
      renderVoiceParticipants(channelId);
    };

    const voiceSettings = await ipcRenderer.invoke('get-voice-video-settings').catch(() => null) as VoiceSettings | null;
    const joined = await (App.voiceManager as { joinChannel(id: string, s: VoiceSettings | null): Promise<boolean> }).joinChannel(channelId, voiceSettings);
    if (!joined) { log.error('Failed to join voice channel', { channel_id: channelId }); return; }

    log.info('Voice channel join initiated, waiting for SFU connection', { channel_id: channelId });
  }

  async function leaveVoiceChannel(): Promise<void> {
    if (!App.voiceManager) return;
    const leavingChannelId = App.activeVoiceChannelId;
    log.info('Leaving voice channel', { channel_id: leavingChannelId ?? '' });
    if (App.localCameraOn && App.wsConnection?.readyState === WebSocket.OPEN) {
      App.wsConnection.send(JSON.stringify({ type: 'voice_camera_off' }));
    }
    App.localCameraOn = false;
    App.videoParticipants.clear();
    if (App.activeView === 'voice') showTextChannelView();
    updateVideoGridVisibility();
    const cameraBtn = document.getElementById('voice-camera-btn') as HTMLButtonElement | null;
    if (cameraBtn) { cameraBtn.classList.remove('active'); cameraBtn.title = 'Start Camera'; cameraBtn.textContent = '📷'; cameraBtn.disabled = false; }
    await (App.voiceManager as { leaveChannel(): Promise<void> }).leaveChannel();

    // Optimistically remove self from sidebar presence before the server confirms
    const selfId = (App.voiceManager as { auth?: AuthForVoice } | null)?.auth?.user_id;
    if (selfId && leavingChannelId) {
      const presence = App.voiceChannelPresence.get(leavingChannelId);
      if (presence) {
        const updated = new Map(presence);
        updated.delete(selfId);
        App.voiceChannelPresence.set(leavingChannelId, updated);
        renderVoiceParticipants(leavingChannelId);
      }
    }

    App.activeVoiceChannelId = null;
    App.voiceParticipants.clear();
    hideVoiceControls();
    document.querySelectorAll('.voice-avatar.speaking').forEach(el => el.classList.remove('speaking'));
  }

  function handleVoiceUserJoined(payload: { channel_id: string; user_id: string; username: string }): void {
    const { channel_id, user_id, username } = payload;
    log.info('Voice user joined', { channel_id, user_id, username });

    // Update cross-channel sidebar presence (visible to all ember members)
    const existingJoined = App.voiceChannelPresence.get(channel_id) ?? new Map<string, string>();
    App.voiceChannelPresence.set(channel_id, new Map(existingJoined).set(user_id, username));
    renderVoiceParticipants(channel_id);

    // Only update own-session state and play sound when it's our active channel
    if (channel_id === App.activeVoiceChannelId) {
      App.voiceParticipants.set(user_id, username);
      playVoiceSound('userJoin');
    }
  }

  function handleVoiceUserLeft(payload: { channel_id: string; user_id: string }): void {
    const { channel_id, user_id } = payload;
    log.info('Voice user left', { channel_id, user_id });

    // Update cross-channel sidebar presence
    const channelPresence = App.voiceChannelPresence.get(channel_id);
    if (channelPresence) {
      const updated = new Map(channelPresence);
      updated.delete(user_id);
      App.voiceChannelPresence.set(channel_id, updated);
      renderVoiceParticipants(channel_id);
    }

    // Only update own-session state when it's our active channel
    if (channel_id === App.activeVoiceChannelId) {
      App.voiceParticipants.delete(user_id);
      App.videoParticipants.delete(user_id);
      removeVideoTile(user_id);
      updateVideoGridVisibility();
      updateSpeakingIndicator(user_id, false);
      const selfId = (App.voiceManager as { auth?: AuthForVoice } | null)?.auth?.user_id;
      if (user_id !== selfId) playVoiceSound('userLeave');
    }
  }

  function renderVoiceParticipants(channelId: string | null): void {
    if (!channelId) {
      document.querySelectorAll('.voice-participant-list').forEach(el => el.replaceChildren());
      return;
    }
    const list = document.querySelector<HTMLElement>(`.voice-participant-list[data-voice-channel-id="${channelId}"]`);
    if (!list) return;
    list.replaceChildren();
    const participants = App.voiceChannelPresence.get(channelId);
    if (!participants) return;
    participants.forEach((username, userId) => {
      const item = document.createElement('div');
      item.className = 'voice-participant';
      item.dataset['userId'] = userId;
      const avatar = document.createElement('div');
      avatar.className = 'voice-avatar';
      avatar.dataset['userId'] = userId;
      avatar.textContent = username.charAt(0).toUpperCase();
      const nameEl = document.createElement('span');
      nameEl.className = 'voice-username';
      nameEl.textContent = username;
      item.appendChild(avatar);
      item.appendChild(nameEl);
      list.appendChild(item);
    });
  }

  // Fetch voice presence for all voice channels in an ember and render them in the sidebar.
  async function fetchAndRenderVoicePresence(emberId: string): Promise<void> {
    const auth = await ipcRenderer.invoke('get-auth') as { token?: string; hostname?: string } | null;
    if (!auth || !auth.token || !auth.hostname) return;
    try {
      const res = await fetch(`${auth.hostname}/api/v1/embers/${emberId}/voice/participants`, {
        headers: { 'Authorization': `Bearer ${auth.token}` },
      });
      if (!res.ok) return;
      const data = await res.json() as { channels: Record<string, Array<{ user_id: string; username: string }>> };
      App.voiceChannelPresence.clear();
      for (const [channelId, participants] of Object.entries(data.channels)) {
        const presenceMap = new Map<string, string>();
        for (const p of participants) presenceMap.set(p.user_id, p.username);
        App.voiceChannelPresence.set(channelId, presenceMap);
      }
      // Re-render all voice participant lists that are currently in the DOM
      App.voiceChannelPresence.forEach((_, channelId) => renderVoiceParticipants(channelId));
    } catch (e) {
      log.error('Failed to fetch voice presence', { error: String(e) });
    }
  }

  function updateSpeakingIndicator(userId: string, isSpeaking: boolean): void {
    document.querySelectorAll<HTMLElement>(`.voice-avatar[data-user-id="${userId}"]`).forEach(el => {
      el.classList.toggle('speaking', isSpeaking);
    });
  }

  function showVoiceControls(channelName: string): void {
    const panel = document.getElementById('voice-controls');
    if (!panel) return;
    panel.classList.remove('hidden');
    const nameEl = panel.querySelector('.voice-channel-name');
    if (nameEl) nameEl.textContent = '\uD83D\uDD0A ' + channelName;
  }

  function hideVoiceControls(): void {
    document.getElementById('voice-controls')?.classList.add('hidden');
  }

  document.getElementById('voice-mute-btn')?.addEventListener('click', () => {
    if (!App.voiceManager) return;
    const muted = (App.voiceManager as { toggleMute(): boolean }).toggleMute();
    const btn = document.getElementById('voice-mute-btn');
    if (!btn) return;
    btn.classList.toggle('active', muted);
    btn.title = muted ? 'Unmute' : 'Mute';
    btn.textContent = muted ? '\uD83D\uDD07' : '\uD83C\uDFA4';
    playVoiceSound(muted ? 'mute' : 'unmute');
  });

  document.getElementById('voice-deafen-btn')?.addEventListener('click', () => {
    if (!App.voiceManager) return;
    const deafened = (App.voiceManager as { toggleDeafen(): boolean }).toggleDeafen();
    const btn = document.getElementById('voice-deafen-btn');
    if (!btn) return;
    btn.classList.toggle('active', deafened);
    btn.title = deafened ? 'Undeafen' : 'Deafen';
    btn.textContent = deafened ? '\uD83D\uDD15' : '\uD83C\uDFA7';
    playVoiceSound(deafened ? 'deafen' : 'undeafen');
  });

  document.getElementById('voice-disconnect-btn')?.addEventListener('click', () => {
    playVoiceSound('disconnect');
    leaveVoiceChannel();
    document.querySelectorAll('.channel').forEach(el => el.classList.remove('active'));
  });

  document.getElementById('voice-camera-btn')?.addEventListener('click', () => toggleCamera());

  // ─── View Switching Functions ──────────────────────────────────────────────

  function showVoiceChannelView(): void {
    const grid = document.getElementById('video-grid');
    const messages = document.getElementById('messages');
    const inputContainer = document.querySelector<HTMLElement>('.message-input-container');
    if (!grid || !messages) return;
    App.activeView = 'voice';
    App.videoGridVisible = true;
    grid.style.display = '';
    messages.style.display = 'none';
    if (inputContainer) inputContainer.style.display = 'none';
    const headerIcon = document.querySelector<HTMLElement>('.chat-header .channel-icon');
    if (headerIcon) headerIcon.textContent = '🔊';
    renderVideoGrid();
  }

  function showTextChannelView(): void {
    const grid = document.getElementById('video-grid');
    const messages = document.getElementById('messages');
    const inputContainer = document.querySelector<HTMLElement>('.message-input-container');
    if (!grid || !messages) return;
    App.activeView = 'text';
    App.videoGridVisible = false;
    grid.style.display = 'none';
    messages.style.display = '';
    if (inputContainer) inputContainer.style.display = '';
    const headerIcon = document.querySelector<HTMLElement>('.chat-header .channel-icon');
    if (headerIcon) headerIcon.textContent = '#';
  }

  // ─── Camera / Video Functions ──────────────────────────────────────────────

  async function toggleCamera(): Promise<void> {
    if (!App.voiceManager || !App.activeVoiceChannelId) return;
    const btn = document.getElementById('voice-camera-btn') as HTMLButtonElement | null;
    if (btn) btn.disabled = true;
    try {
      if (!App.localCameraOn) {
        const voiceSettings = await ipcRenderer.invoke('get-voice-video-settings').catch(() => null) as VoiceSettings | null;
        const cameraDeviceId = voiceSettings?.cameraDevice && voiceSettings.cameraDevice !== 'default' ? voiceSettings.cameraDevice : null;
        let testStream: MediaStream | undefined;
        try {
          testStream = await navigator.mediaDevices.getUserMedia({ video: cameraDeviceId ? { deviceId: { exact: cameraDeviceId } } : true });
          testStream.getTracks().forEach(t => t.stop());
        } catch (e) {
          log.warn('Camera permission denied or no device found', { error: String(e) });
          return;
        }
        const joined = await (App.voiceManager as { enableCamera(id: string | null): Promise<boolean> }).enableCamera(cameraDeviceId);
        if (!joined) return;
        App.localCameraOn = true;
        App.videoParticipants.add('__self__');
        if (App.wsConnection?.readyState === WebSocket.OPEN) App.wsConnection.send(JSON.stringify({ type: 'voice_camera_on' }));
        if (btn) { btn.classList.add('active'); btn.title = 'Stop Camera'; btn.textContent = '\u{1F3A5}'; }
      } else {
        await (App.voiceManager as { disableCamera(): Promise<boolean> }).disableCamera();
        App.localCameraOn = false;
        App.videoParticipants.delete('__self__');
        if (App.wsConnection?.readyState === WebSocket.OPEN) App.wsConnection.send(JSON.stringify({ type: 'voice_camera_off' }));
        if (btn) { btn.classList.remove('active'); btn.title = 'Start Camera'; btn.textContent = '\u{1F4F7}'; }
      }
      updateVideoGridVisibility();
      renderVideoGrid();
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function updateVideoGridVisibility(): void {
    // When viewing the voice channel, keep the grid visible regardless of camera state.
    // When viewing a text channel, keep the grid hidden regardless of camera state.
    if (App.activeView === 'voice') {
      const grid = document.getElementById('video-grid');
      const messages = document.getElementById('messages');
      const inputContainer = document.querySelector<HTMLElement>('.message-input-container');
      if (grid) grid.style.display = '';
      if (messages) messages.style.display = 'none';
      if (inputContainer) inputContainer.style.display = 'none';
      App.videoGridVisible = true;
    } else {
      const grid = document.getElementById('video-grid');
      const messages = document.getElementById('messages');
      const inputContainer = document.querySelector<HTMLElement>('.message-input-container');
      if (grid) grid.style.display = 'none';
      if (messages) messages.style.display = '';
      if (inputContainer) inputContainer.style.display = '';
      App.videoGridVisible = false;
    }
  }

  function renderVideoGrid(): void {
    const grid = document.getElementById('video-grid');
    if (!grid) return;
    grid.replaceChildren();

    const vm = App.voiceManager as { auth?: AuthForVoice; localVideoStream?: MediaStream | null; remoteVideoStreams?: Map<string, MediaStream> } | null;
    const selfId = vm?.auth?.user_id;
    const selfUsername = vm?.auth?.username;

    grid.appendChild(createVideoTile('__self__', selfUsername ?? 'You', App.localCameraOn ? (vm?.localVideoStream ?? null) : null, true));

    App.voiceParticipants.forEach((username, userId) => {
      if (userId === selfId) return;
      const hasCamera = App.videoParticipants.has(userId);
      let stream: MediaStream | null = null;
      if (hasCamera && vm?.remoteVideoStreams) {
        vm.remoteVideoStreams.forEach(s => { if (!stream) stream = s; });
      }
      grid.appendChild(createVideoTile(userId, username, hasCamera ? stream : null, false));
    });
  }

  function createVideoTile(userId: string, username: string, stream: MediaStream | null, isSelf: boolean): HTMLElement {
    const tile = document.createElement('div');
    tile.className = 'video-tile';
    tile.dataset['userId'] = userId;

    if (stream) {
      const video = document.createElement('video') as HTMLVideoElement;
      video.autoplay = true;
      video.playsInline = true;
      if (isSelf) video.muted = true;
      video.srcObject = stream;
      tile.appendChild(video);
    } else {
      const avatar = document.createElement('div');
      avatar.className = 'video-tile-avatar';
      avatar.textContent = (username ?? '?').charAt(0).toUpperCase();
      tile.appendChild(avatar);
    }

    const label = document.createElement('div');
    label.className = 'video-tile-label';
    label.textContent = isSelf ? (username ? username + ' (You)' : 'You') : (username ?? userId);
    tile.appendChild(label);
    return tile;
  }

  function removeVideoTile(userId: string): void {
    const grid = document.getElementById('video-grid');
    if (!grid) return;
    grid.querySelector<HTMLElement>(`.video-tile[data-user-id="${userId}"]`)?.remove();
  }

  function handleRemoteCameraStateChanged(userId: string, isOn: boolean): void {
    log.info('Remote camera state changed', { user_id: userId, camera_on: isOn });
    if (isOn) { App.videoParticipants.add(userId); }
    else { App.videoParticipants.delete(userId); removeVideoTile(userId); }
    updateVideoGridVisibility();
    if (isOn || App.videoGridVisible) renderVideoGrid();
  }

  function handleRemoteVideoStream(streamId: string, stream: MediaStream): void {
    log.debug('Remote video stream added', { stream_id: streamId });
    const grid = document.getElementById('video-grid');
    if (!grid) return;
    for (const userId of App.videoParticipants) {
      if (userId === '__self__') continue;
      const tile = grid.querySelector<HTMLElement>(`.video-tile[data-user-id="${userId}"]`);
      if (tile && !tile.querySelector('video')) {
        tile.querySelector('.video-tile-avatar')?.remove();
        const video = document.createElement('video') as HTMLVideoElement;
        video.autoplay = true;
        video.playsInline = true;
        video.srcObject = stream;
        tile.insertBefore(video, tile.firstChild);
        return;
      }
    }
  }

  // ─── User Settings Modal ───────────────────────────────────────────────────

  const settingsModal     = document.getElementById('settings-modal');
  const settingsCloseBtn  = document.getElementById('settings-close-btn');
  const settingsLogoutBtn = document.getElementById('settings-logout-btn');
  const settingsNavItems  = document.querySelectorAll<HTMLElement>('.settings-nav-item[data-page]');

  function openSettingsModal(page?: string): void {
    if (!settingsModal) return;
    settingsModal.classList.remove('hidden');
    switchSettingsPage(page ?? 'my-account');
    populateSettingsAccount();
  }

  function closeSettingsModal(): void {
    settingsModal?.classList.add('hidden');
  }

  function switchSettingsPage(page: string): void {
    settingsNavItems.forEach(item => item.classList.toggle('active', item.dataset['page'] === page));
    document.querySelectorAll('.settings-page').forEach(el => el.classList.add('hidden'));
    document.getElementById('settings-page-' + page)?.classList.remove('hidden');
    if (page === 'voice-video') {
      stopMicTest();
      stopCameraPreview();
      populateVoiceVideoSettings();
    }
  }

  async function populateSettingsAccount(): Promise<void> {
    log.debug('Populating settings account panel');
    try {
      const auth = await ipcRenderer.invoke('get-auth') as { username?: string } | null;
      if (!auth) return;
      const username = auth.username ?? '';
      const set = (id: string, val: string) => { const el = document.getElementById(id); if (el) el.textContent = val; };
      const avatarEl = document.getElementById('settings-avatar-display');
      if (avatarEl) avatarEl.textContent = username.charAt(0).toUpperCase() || 'U';
      set('settings-username-display', username);
      set('settings-user-tag-display', username);
      set('settings-account-username', username);
      set('settings-display-name', username);
    } catch (e) {
      log.error('Failed to populate settings account', { error: String(e) });
    }
  }

  settingsNavItems.forEach(item => item.addEventListener('click', () => switchSettingsPage(item.dataset['page'] ?? '')));
  settingsCloseBtn?.addEventListener('click', closeSettingsModal);
  settingsLogoutBtn?.addEventListener('click', () => {
    closeSettingsModal();
    document.getElementById('logout-modal')?.classList.remove('hidden');
  });
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape' && settingsModal && !settingsModal.classList.contains('hidden')) closeSettingsModal();
  });

  // ─── Voice & Video Settings ────────────────────────────────────────────────

  async function _loadVVSounds(): Promise<void> {
    try {
      const s = await ipcRenderer.invoke('get-voice-video-settings') as VoiceSettings | null;
      App._vvSounds = (s?.sounds as Partial<Record<string, boolean>> | null) ?? null;
    } catch (_) { App._vvSounds = null; }
  }
  _loadVVSounds();

  function playVoiceSound(type: string): void {
    if (App._vvSounds && App._vvSounds[type] === false) return;
    const gen = (window as unknown as { generateNotificationSound?: (t: string) => void }).generateNotificationSound;
    if (typeof gen === 'function') gen(type);
  }

  function _clearSelect(sel: HTMLSelectElement): void {
    while (sel.options.length > 0) sel.remove(0);
  }

  function _addOption(sel: HTMLSelectElement, value: string, label: string): void {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    sel.appendChild(opt);
  }

  async function enumerateAudioDevices(): Promise<void> {
    const inputSel  = document.getElementById('vv-input-device') as HTMLSelectElement | null;
    const outputSel = document.getElementById('vv-output-device') as HTMLSelectElement | null;
    if (!inputSel || !outputSel) return;
    try {
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (tempStream) tempStream.getTracks().forEach(t => t.stop());
      _clearSelect(inputSel); _clearSelect(outputSel);
      _addOption(inputSel, 'default', 'Default Microphone');
      _addOption(outputSel, 'default', 'Default Speaker');
      devices.forEach(d => {
        const label = d.label || (d.kind + ' (' + d.deviceId.slice(0, 8) + ')');
        if (d.kind === 'audioinput')  _addOption(inputSel,  d.deviceId, label);
        if (d.kind === 'audiooutput') _addOption(outputSel, d.deviceId, label);
      });
    } catch (e) { console.warn('[VV] enumerateAudioDevices failed:', e); }
  }

  async function enumerateCameras(): Promise<void> {
    const cameraSel = document.getElementById('vv-camera-device') as HTMLSelectElement | null;
    if (!cameraSel) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      _clearSelect(cameraSel);
      _addOption(cameraSel, 'default', 'Default Camera');
      devices.filter(d => d.kind === 'videoinput').forEach(d => {
        _addOption(cameraSel, d.deviceId, d.label || ('Camera (' + d.deviceId.slice(0, 8) + ')'));
      });
    } catch (e) { console.warn('[VV] enumerateCameras failed:', e); }
  }

  function startMicTest(): void {
    const btn    = document.getElementById('vv-mic-test-btn') as HTMLButtonElement | null;
    const canvas = document.getElementById('mic-visualizer') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    if (App._micTestStream) { stopMicTest(); return; }

    const inputSel   = document.getElementById('vv-input-device') as HTMLSelectElement | null;
    const deviceId   = inputSel ? inputSel.value : 'default';
    const audioConstraints: MediaStreamConstraints['audio'] = deviceId === 'default' ? true : { deviceId: { exact: deviceId } };

    navigator.mediaDevices.getUserMedia({ audio: audioConstraints }).then(stream => {
      App._micTestStream = stream;
      if (btn) btn.textContent = 'Stop Test';
      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const highlightRgb = getComputedStyle(document.documentElement).getPropertyValue('--rgb-highlight').trim() || '255,80,40';

      const draw = () => {
        if (!App._micTestStream) { audioCtx.close(); return; }
        App._micTestAnimFrame = requestAnimationFrame(draw);
        analyser.getByteFrequencyData(data);
        const w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        const barW = Math.max(2, Math.floor(w / data.length * 2));
        data.forEach((v, i) => {
          const barH  = Math.round((v / 255) * h);
          const alpha = (0.4 + (v / 255) * 0.6).toFixed(2);
          ctx.fillStyle = `rgba(${highlightRgb},${alpha})`;
          ctx.fillRect(i * (barW + 1), h - barH, barW, barH);
        });
      };
      draw();
    }).catch(e => { console.warn('[VV] Mic test failed:', e); });
  }

  function stopMicTest(): void {
    const btn    = document.getElementById('vv-mic-test-btn') as HTMLButtonElement | null;
    const canvas = document.getElementById('mic-visualizer') as HTMLCanvasElement | null;
    if (App._micTestAnimFrame) { cancelAnimationFrame(App._micTestAnimFrame); App._micTestAnimFrame = null; }
    if (App._micTestStream) { App._micTestStream.getTracks().forEach(t => t.stop()); App._micTestStream = null; }
    if (btn) btn.textContent = 'Test Microphone';
    if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  }

  function startCameraPreview(): void {
    const video = document.getElementById('camera-preview') as HTMLVideoElement | null;
    const placeholder = document.getElementById('camera-preview-placeholder');
    const btn = document.getElementById('vv-camera-test-btn') as HTMLButtonElement | null;
    if (!video) return;
    if (App._cameraPreviewStream) { stopCameraPreview(); return; }

    const cameraSel = document.getElementById('vv-camera-device') as HTMLSelectElement | null;
    const deviceId  = cameraSel ? cameraSel.value : 'default';
    const videoConstraints: MediaStreamConstraints['video'] = deviceId === 'default' ? true : { deviceId: { exact: deviceId } };

    navigator.mediaDevices.getUserMedia({ video: videoConstraints }).then(stream => {
      App._cameraPreviewStream = stream;
      video.srcObject = stream;
      video.style.display = 'block';
      if (placeholder) placeholder.style.display = 'none';
      if (btn) btn.textContent = 'Stop Preview';
    }).catch(e => { console.warn('[VV] Camera preview failed:', e); });
  }

  function stopCameraPreview(): void {
    const video = document.getElementById('camera-preview') as HTMLVideoElement | null;
    const placeholder = document.getElementById('camera-preview-placeholder');
    const btn = document.getElementById('vv-camera-test-btn') as HTMLButtonElement | null;
    if (App._cameraPreviewStream) { App._cameraPreviewStream.getTracks().forEach(t => t.stop()); App._cameraPreviewStream = null; }
    if (video) { video.srcObject = null; video.style.display = 'none'; }
    if (placeholder) placeholder.style.display = '';
    if (btn) btn.textContent = 'Test Video';
  }

  function updatePttKeyRowVisibility(enabled: boolean): void {
    const row = document.getElementById('vv-ptt-key-row');
    if (row) row.style.display = enabled ? 'flex' : 'none';
  }

  function updateSensitivityRowVisibility(autoEnabled: boolean): void {
    const row = document.getElementById('vv-sensitivity-row');
    if (row) row.style.display = autoEnabled ? 'none' : 'flex';
  }

  function startPttKeyCapture(): void {
    const btn = document.getElementById('vv-ptt-key-btn') as HTMLButtonElement | null;
    if (!btn || App._pttListening) return;
    App._pttListening = true;
    btn.textContent = 'Press any key...';
    btn.classList.add('listening');
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      App._pttListening = false;
      btn.classList.remove('listening');
      btn.textContent = e.code;
      (btn as HTMLButtonElement & { dataset: DOMStringMap }).dataset['keyCode'] = e.code;
      document.removeEventListener('keydown', onKey, true);
    };
    document.addEventListener('keydown', onKey, true);
  }

  async function populateVoiceVideoSettings(): Promise<void> {
    try {
      const settings = await ipcRenderer.invoke('get-voice-video-settings') as VoiceSettings | null;
      if (!settings) return;

      await enumerateAudioDevices();
      await enumerateCameras();

      const setVal = (id: string, val: unknown) => { const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null; if (el) el.value = String(val ?? ''); };
      const setChecked = (id: string, val: boolean) => { const el = document.getElementById(id) as HTMLInputElement | null; if (el) el.checked = val; };

      setVal('vv-input-device', settings.inputDevice);
      setVal('vv-output-device', settings.outputDevice);
      setVal('vv-input-volume', settings.inputVolume);
      setVal('vv-output-volume', settings.outputVolume);
      setVal('vv-sensitivity', settings.sensitivityThreshold);

      const ivv = document.getElementById('vv-input-volume-val');
      const ovv = document.getElementById('vv-output-volume-val');
      const svv = document.getElementById('vv-sensitivity-val');
      if (ivv) ivv.textContent = (settings.inputVolume ?? 0) + '%';
      if (ovv) ovv.textContent = (settings.outputVolume ?? 0) + '%';
      if (svv) svv.textContent = String(settings.sensitivityThreshold ?? 0);

      setChecked('vv-echo-cancellation', settings.echoCancellation ?? true);
      setChecked('vv-noise-suppression', settings.noiseSuppression ?? true);
      setChecked('vv-auto-gain', settings.autoGainControl ?? true);
      setChecked('vv-auto-sensitivity', settings.autoSensitivity ?? true);
      setChecked('vv-ptt-enabled', settings.pushToTalk ?? false);
      setChecked('vv-always-preview', settings.alwaysPreviewVideo ?? false);

      const pttBtn = document.getElementById('vv-ptt-key-btn') as HTMLButtonElement & { dataset: DOMStringMap } | null;
      if (pttBtn) { pttBtn.textContent = settings.pttKey ?? 'Backquote'; pttBtn.dataset['keyCode'] = settings.pttKey ?? 'Backquote'; }

      updatePttKeyRowVisibility(settings.pushToTalk ?? false);
      updateSensitivityRowVisibility(settings.autoSensitivity ?? true);
      setVal('vv-camera-device', settings.cameraDevice);

      const sounds = settings.sounds ?? {};
      (['mute', 'unmute', 'deafen', 'undeafen', 'userJoin', 'userLeave', 'disconnect'] as SoundType[]).forEach(k => {
        setChecked('vv-sound-' + k, sounds[k] !== false);
      });
    } catch (e) { console.error('[VV] populateVoiceVideoSettings failed:', e); }
  }

  async function saveVoiceVideoSettings(): Promise<void> {
    log.info('Saving voice/video settings');
    const getVal = (id: string) => { const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null; return el ? el.value : null; };
    const getChecked = (id: string) => { const el = document.getElementById(id) as HTMLInputElement | null; return el ? el.checked : false; };
    const getInt = (id: string) => { const v = parseInt(getVal(id) ?? '', 10); return isNaN(v) ? 0 : v; };

    const pttBtn = document.getElementById('vv-ptt-key-btn') as HTMLButtonElement & { dataset: DOMStringMap } | null;

    const settings: VoiceSettings = {
      inputDevice:   getVal('vv-input-device') ?? 'default',
      outputDevice:  getVal('vv-output-device') ?? 'default',
      inputVolume:   getInt('vv-input-volume'),
      outputVolume:  getInt('vv-output-volume'),
      echoCancellation: getChecked('vv-echo-cancellation'),
      noiseSuppression: getChecked('vv-noise-suppression'),
      autoGainControl:  getChecked('vv-auto-gain'),
      autoSensitivity:  getChecked('vv-auto-sensitivity'),
      sensitivityThreshold: getInt('vv-sensitivity'),
      pushToTalk: getChecked('vv-ptt-enabled'),
      pttKey: pttBtn ? (pttBtn.dataset['keyCode'] || pttBtn.textContent || 'Backquote') : 'Backquote',
      cameraDevice: getVal('vv-camera-device') ?? 'default',
      alwaysPreviewVideo: getChecked('vv-always-preview'),
      sounds: {
        mute:       getChecked('vv-sound-mute'),
        unmute:     getChecked('vv-sound-unmute'),
        deafen:     getChecked('vv-sound-deafen'),
        undeafen:   getChecked('vv-sound-undeafen'),
        userJoin:   getChecked('vv-sound-userJoin'),
        userLeave:  getChecked('vv-sound-userLeave'),
        disconnect: getChecked('vv-sound-disconnect'),
      },
    };

    try {
      await ipcRenderer.invoke('save-voice-video-settings', settings);
      App._vvSounds = settings.sounds as Partial<Record<string, boolean>> | null;
      log.info('Voice/video settings saved successfully');
      if (App.voiceManager) {
        log.debug('Applying new voice/video settings to active voice session');
        (App.voiceManager as { applySettings(s: VoiceSettings): void }).applySettings(settings);
      }
      const statusEl = document.getElementById('vv-save-status');
      if (statusEl) { statusEl.textContent = 'Saved!'; setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000); }
    } catch (e) {
      log.error('Failed to save voice/video settings', { error: String(e) });
    }
  }

  // Wire up Voice & Video page controls
  (function initVoiceVideoControls() {
    type SliderEntry = [string, string, (v: string) => string];
    const sliderMap: SliderEntry[] = [
      ['vv-input-volume',  'vv-input-volume-val',  v => v + '%'],
      ['vv-output-volume', 'vv-output-volume-val', v => v + '%'],
      ['vv-sensitivity',   'vv-sensitivity-val',   v => v],
    ];
    sliderMap.forEach(([sliderId, valId, fmt]) => {
      const slider = document.getElementById(sliderId) as HTMLInputElement | null;
      const valEl  = document.getElementById(valId);
      if (slider && valEl) slider.addEventListener('input', () => { valEl.textContent = fmt(slider.value); });
    });

    const pttToggle = document.getElementById('vv-ptt-enabled') as HTMLInputElement | null;
    pttToggle?.addEventListener('change', () => updatePttKeyRowVisibility(pttToggle.checked));

    const autoSensToggle = document.getElementById('vv-auto-sensitivity') as HTMLInputElement | null;
    autoSensToggle?.addEventListener('change', () => updateSensitivityRowVisibility(autoSensToggle.checked));

    document.getElementById('vv-ptt-key-btn')?.addEventListener('click', startPttKeyCapture);
    document.getElementById('vv-mic-test-btn')?.addEventListener('click', startMicTest);
    document.getElementById('vv-camera-test-btn')?.addEventListener('click', startCameraPreview);

    document.querySelectorAll<HTMLElement>('.sound-preview-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset['sound'];
        if (type) playVoiceSound(type);
      });
    });

    document.getElementById('vv-save-btn')?.addEventListener('click', saveVoiceVideoSettings);
  })();

  function cleanupVoiceOnDisconnect(): void {
    log.warn('WebSocket disconnected, cleaning up voice state');
    // Clear all sidebar voice presence — data is stale until reconnected
    App.voiceChannelPresence.clear();
    renderVoiceParticipants(null);

    if (!App.voiceManager || !App.activeVoiceChannelId) return;
    log.warn('Cleaning up active voice session', { channel_id: App.activeVoiceChannelId });
    App.localCameraOn = false;
    App.videoParticipants.clear();
    if (App.activeView === 'voice') showTextChannelView();
    updateVideoGridVisibility();
    const cameraBtn = document.getElementById('voice-camera-btn') as HTMLButtonElement | null;
    if (cameraBtn) { cameraBtn.classList.remove('active'); cameraBtn.title = 'Start Camera'; cameraBtn.textContent = '\u{1F4F7}'; cameraBtn.disabled = false; }
    (App.voiceManager as { _cleanup(): void })._cleanup();
    App.activeVoiceChannelId = null;
    App.voiceParticipants.clear();
    hideVoiceControls();
    document.querySelectorAll('.voice-avatar.speaking').forEach(el => el.classList.remove('speaking'));
    playVoiceSound('disconnect');
  }

  window.fetchAndRenderVoicePresence = fetchAndRenderVoicePresence;
  window.showVoiceChannelView    = showVoiceChannelView;
  window.showTextChannelView     = showTextChannelView;
  window.joinVoiceChannel        = joinVoiceChannel;
  window.leaveVoiceChannel       = leaveVoiceChannel;
  window.handleVoiceUserJoined   = handleVoiceUserJoined;
  window.handleVoiceUserLeft     = handleVoiceUserLeft;
  window.renderVoiceParticipants = renderVoiceParticipants;
  window.updateSpeakingIndicator = updateSpeakingIndicator;
  window.showVoiceControls       = showVoiceControls;
  window.hideVoiceControls       = hideVoiceControls;
  window.toggleCamera            = toggleCamera;
  window.openSettingsModal       = openSettingsModal;
  window.closeSettingsModal      = closeSettingsModal;
  window.switchSettingsPage      = switchSettingsPage;
  window.playVoiceSound             = playVoiceSound;
  window.cleanupVoiceOnDisconnect   = cleanupVoiceOnDisconnect;
})();
