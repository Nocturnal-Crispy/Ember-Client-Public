// Compatibility shim: reconstruct original variable shapes from the contextBridge API
const ipcRenderer = window.electronAPI.ipc;
const _n = window.electronAPI.nacl;
const nacl = {
  randomBytes: _n.randomBytes,
  box: Object.assign((m, n, pk, sk) => _n.box(m, n, pk, sk), {
    open: (b, n, pk, sk) => _n.boxOpen(b, n, pk, sk),
    keyPair: () => _n.boxKeyPair(),
    nonceLength: _n.BOX_NONCE_LENGTH,
  }),
  secretbox: Object.assign((m, n, k) => _n.secretbox(m, n, k), {
    open: (b, n, k) => _n.secretboxOpen(b, n, k),
    nonceLength: _n.SECRETBOX_NONCE_LENGTH,
    keyLength: _n.SECRETBOX_KEY_LENGTH,
  }),
};
const naclUtil = window.electronAPI.naclUtil;
const emberCrypto = window.electronAPI.crypto;

const messageInput = document.getElementById('messageInput');
const messagesContainer = document.getElementById('messages');

const emberKeyCache = new Map();
let activeChannelId = null;
let wsConnection = null;
let wsReconnectTimer = null;

// Voice state
let voiceManager = null;
let activeVoiceChannelId = null;
let voiceParticipants = new Map(); // userID → username

// Window Controls
document.getElementById('minimize-btn').addEventListener('click', () => {
  ipcRenderer.send('window-minimize');
});

document.getElementById('maximize-btn').addEventListener('click', () => {
  ipcRenderer.send('window-maximize');
});

document.getElementById('close-btn').addEventListener('click', () => {
  ipcRenderer.send('window-close');
});

const logoutBtn = document.getElementById('logout-btn');
const logoutModal = document.getElementById('logout-modal');
const modalCancelBtn = document.getElementById('modal-cancel-btn');
const modalLogoutBtn = document.getElementById('modal-logout-btn');

if (logoutBtn && logoutModal) {
  logoutBtn.addEventListener('click', () => {
    logoutModal.classList.remove('hidden');
  });
}

if (modalCancelBtn && logoutModal) {
  modalCancelBtn.addEventListener('click', () => {
    logoutModal.classList.add('hidden');
  });
}

if (modalLogoutBtn && logoutModal) {
  modalLogoutBtn.addEventListener('click', () => {
    logoutModal.classList.add('hidden');
    forceLogout();
  });
}

if (logoutModal) {
  logoutModal.addEventListener('click', (e) => {
    if (e.target === logoutModal) {
      logoutModal.classList.add('hidden');
    }
  });
}

// Message Input
messageInput.addEventListener('keypress', async (e) => {
  if (e.key === 'Enter' && messageInput.value.trim()) {
    const plaintext = messageInput.value.trim();
    messageInput.value = '';
    await sendEncryptedMessage(plaintext);
  }
});

async function sendEncryptedMessage(plaintext) {
  if (!activeChannelId || !activeEmberId) return;
  const emberKey = emberKeyCache.get(activeEmberId);
  if (!emberKey) {
    console.error('No ember key available for encryption');
    return;
  }
  try {
    const auth = await ipcRenderer.invoke('get-auth');
    if (!auth || !auth.token || !auth.hostname) return;
    const ciphertext = emberCrypto.encryptMessage(plaintext, emberKey);
    const response = await fetch(`${auth.hostname}/api/v1/channels/${activeChannelId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${auth.token}`
      },
      body: JSON.stringify({ ciphertext })
    });
    if (response.ok) {
      const msgData = await response.json();
      displayDecryptedMessage(msgData);
    } else {
      console.error('Failed to send message');
    }
  } catch (error) {
    console.error('Error sending message:', error);
  }
}

function formatTimestamp(unixSeconds) {
  const date = unixSeconds ? new Date(unixSeconds * 1000) : new Date();
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  if (isToday) return `Today at ${timeStr}`;
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday at ${timeStr}`;
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${timeStr}`;
}

function addMessage(author, text, timestamp) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message';
  const timeString = formatTimestamp(timestamp);
  messageDiv.innerHTML = `
    <div class="message-avatar">${author.charAt(0).toUpperCase()}</div>
    <div class="message-content">
      <div class="message-header">
        <span class="message-author">${escapeHtml(author)}</span>
        <span class="message-timestamp">${timeString}</span>
      </div>
      <div class="message-text">${escapeHtml(text)}</div>
    </div>
  `;
  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function displayDecryptedMessage(msg) {
  if (!activeEmberId) return;
  const emberKey = emberKeyCache.get(activeEmberId);
  if (!emberKey) {
    addMessage(msg.username || 'Unknown', '[Encrypted message - key unavailable]', msg.created_at);
    return;
  }
  const plaintext = emberCrypto.decryptMessage(msg.ciphertext, emberKey);
  if (plaintext === null) {
    addMessage(msg.username || 'Unknown', '[Failed to decrypt message]', msg.created_at);
    return;
  }
  addMessage(msg.username || 'Unknown', plaintext, msg.created_at);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

let healthcheckInterval = null;
let reconnectionTimeout = null;
let reconnectionStartTime = null;
let reconnectionTimerInterval = null;

const reconnectionOverlay = document.getElementById('reconnection-overlay');
const reconnectionTimer = document.getElementById('reconnection-timer');
const reconnectionDisconnectBtn = document.getElementById('reconnection-disconnect-btn');

async function performHealthcheck() {
  try {
    const auth = await ipcRenderer.invoke('get-auth');
    
    if (!auth || !auth.hostname || !auth.token) {
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${auth.hostname}/api/v1/health`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${auth.token}`
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      if (reconnectionOverlay && !reconnectionOverlay.classList.contains('hidden')) {
        hideReconnectionOverlay();
      }
    } else {
      showReconnectionOverlay();
    }
  } catch (error) {
    showReconnectionOverlay();
  }
}

function showReconnectionOverlay() {
  if (reconnectionOverlay && reconnectionOverlay.classList.contains('hidden')) {
    reconnectionOverlay.classList.remove('hidden');
    reconnectionStartTime = Date.now();
    
    reconnectionTimeout = setTimeout(() => {
      forceLogout();
    }, 60000);

    updateReconnectionTimer();
    reconnectionTimerInterval = setInterval(updateReconnectionTimer, 100);
  }
}

function hideReconnectionOverlay() {
  if (reconnectionOverlay) {
    reconnectionOverlay.classList.add('hidden');
  }
  
  if (reconnectionTimeout) {
    clearTimeout(reconnectionTimeout);
    reconnectionTimeout = null;
  }
  
  if (reconnectionTimerInterval) {
    clearInterval(reconnectionTimerInterval);
    reconnectionTimerInterval = null;
  }
  
  reconnectionStartTime = null;
}

function updateReconnectionTimer() {
  if (!reconnectionStartTime || !reconnectionTimer) {
    return;
  }

  const elapsed = Date.now() - reconnectionStartTime;
  const remaining = Math.max(0, 60 - Math.floor(elapsed / 1000));
  
  reconnectionTimer.textContent = `Time remaining: ${remaining}s`;
  
  if (remaining === 0) {
    clearInterval(reconnectionTimerInterval);
    reconnectionTimerInterval = null;
  }
}

function forceLogout() {
  hideReconnectionOverlay();
  disconnectWebSocket();
  emberKeyCache.clear();
  activeChannelId = null;
  if (healthcheckInterval) {
    clearInterval(healthcheckInterval);
    healthcheckInterval = null;
  }
  ipcRenderer.send('auth-logout');
}

if (reconnectionDisconnectBtn) {
  reconnectionDisconnectBtn.addEventListener('click', () => {
    forceLogout();
  });
}

healthcheckInterval = setInterval(performHealthcheck, 5000);

performHealthcheck();

const userInfo = document.getElementById('user-info');
const userMenu = document.getElementById('user-menu');
const menuStatus = document.getElementById('menu-status');
const statusSubmenu = document.getElementById('status-submenu');
const menuEditProfile = document.getElementById('menu-edit-profile');
const menuLogout = document.getElementById('menu-logout');
const userStatusText = document.getElementById('user-status-text');

if (userInfo && userMenu) {
  userInfo.addEventListener('click', (e) => {
    e.stopPropagation();
    userMenu.classList.toggle('hidden');
    if (statusSubmenu && !userMenu.classList.contains('hidden')) {
      statusSubmenu.classList.add('hidden');
    }
  });
}

document.addEventListener('click', (e) => {
  if (userMenu && !userMenu.classList.contains('hidden')) {
    if (!userMenu.contains(e.target) && !userInfo.contains(e.target)) {
      userMenu.classList.add('hidden');
      if (statusSubmenu) {
        statusSubmenu.classList.add('hidden');
      }
    }
  }
});

if (menuStatus && statusSubmenu) {
  menuStatus.addEventListener('mouseenter', () => {
    statusSubmenu.classList.remove('hidden');
  });

  menuStatus.addEventListener('mouseleave', (e) => {
    const relatedTarget = e.relatedTarget;
    if (!statusSubmenu.contains(relatedTarget)) {
      setTimeout(() => {
        if (!statusSubmenu.matches(':hover')) {
          statusSubmenu.classList.add('hidden');
        }
      }, 100);
    }
  });

  statusSubmenu.addEventListener('mouseleave', () => {
    statusSubmenu.classList.add('hidden');
  });

  statusSubmenu.addEventListener('click', (e) => {
    e.stopPropagation();
  });
}

if (statusSubmenu) {
  const statusOptions = statusSubmenu.querySelectorAll('.status-option');
  statusOptions.forEach(option => {
    option.addEventListener('click', async () => {
      const displayStatus = option.getAttribute('data-status');
      const statusMap = { 'Online': 'online', 'Idle': 'idle', 'Do Not Disturb': 'dnd', 'Invisible': 'invisible' };
      const apiStatus = statusMap[displayStatus] || 'online';
      userMenu.classList.add('hidden');
      statusSubmenu.classList.add('hidden');
      await updateUserStatus(apiStatus, displayStatus);
    });
  });
}

async function updateUserStatus(apiStatus, displayStatus) {
  try {
    const auth = await ipcRenderer.invoke('get-auth');
    if (!auth || !auth.token || !auth.hostname) return;
    const response = await fetch(`${auth.hostname}/api/v1/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${auth.token}`
      },
      body: JSON.stringify({ status: apiStatus })
    });
    if (response.ok) {
      if (userStatusText) userStatusText.textContent = displayStatus;
      updateUserPanelStatusColor(apiStatus);
      handlePresenceUpdate({ user_id: auth.user_id, username: auth.username, status: apiStatus });
    }
  } catch (error) {
    console.error('Error updating status:', error);
  }
}

function updateUserPanelStatusColor(status) {
  const statusEl = document.getElementById('user-status-text');
  if (!statusEl) return;
  statusEl.classList.remove('status-online', 'status-idle', 'status-dnd', 'status-offline');
  const classMap = { online: 'status-online', idle: 'status-idle', dnd: 'status-dnd', invisible: 'status-offline', offline: 'status-offline' };
  statusEl.classList.add(classMap[status] || 'status-online');

  const iconMap = {
    online: 'Icons/ember_connected.png',
    idle: 'Icons/ember_idle.gif',
    dnd: 'Icons/ember_error.png',
    invisible: 'Icons/ember_disconnected.png',
    offline: 'Icons/ember_disconnected.png'
  };
  const iconSrc = iconMap[status] || 'Icons/ember_connected.png';
  const userStatusIcon = document.getElementById('user-status-icon');
  if (userStatusIcon) userStatusIcon.src = iconSrc;
  const menuStatusIcon = document.getElementById('menu-status-icon');
  if (menuStatusIcon) menuStatusIcon.src = iconSrc;
}

if (menuEditProfile) {
  menuEditProfile.addEventListener('click', () => {
    userMenu.classList.add('hidden');
    openSettingsModal('my-account');
  });
}

if (menuLogout) {
  menuLogout.addEventListener('click', () => {
    userMenu.classList.add('hidden');
    if (logoutModal) {
      logoutModal.classList.remove('hidden');
    }
  });
}

console.log('Ember app initialized!');

// Server Management
let currentEmbers = [];
let activeEmberId = null;

async function fetchEmbers() {
  try {
    const auth = await ipcRenderer.invoke('get-auth');
    if (!auth || !auth.token || !auth.hostname) {
      console.error('Not authenticated');
      return [];
    }

    const response = await fetch(`${auth.hostname}/api/v1/embers`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${auth.token}`
      }
    });

    if (!response.ok) {
      console.error('Failed to fetch embers');
      return [];
    }

    const data = await response.json();
    return data.embers || [];
  } catch (error) {
    console.error('Error fetching embers:', error);
    return [];
  }
}

async function fetchCategories(emberId) {
  try {
    const auth = await ipcRenderer.invoke('get-auth');
    if (!auth || !auth.token || !auth.hostname) return [];
    const response = await fetch(`${auth.hostname}/api/v1/embers/${emberId}/categories`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${auth.token}` }
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.categories || [];
  } catch (error) {
    console.error('Error fetching categories:', error);
    return [];
  }
}

async function fetchChannels(emberId) {
  try {
    const auth = await ipcRenderer.invoke('get-auth');
    if (!auth || !auth.token || !auth.hostname) {
      console.error('Not authenticated');
      return [];
    }

    const response = await fetch(`${auth.hostname}/api/v1/embers/${emberId}/channels`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${auth.token}`
      }
    });

    if (!response.ok) {
      console.error('Failed to fetch channels');
      return [];
    }

    const data = await response.json();
    return data.channels || [];
  } catch (error) {
    console.error('Error fetching channels:', error);
    return [];
  }
}

function renderServerList(embers) {
  const serverList = document.querySelector('.server-list');
  if (!serverList) return;

  const addServerBtn = serverList.querySelector('.add-server');
  const separator = serverList.querySelector('.server-separator');
  
  const existingServers = serverList.querySelectorAll('.server-icon:not(.add-server)');
  existingServers.forEach(el => el.remove());

  embers.forEach((ember, index) => {
    const serverIcon = document.createElement('div');
    serverIcon.className = 'server-icon';
    serverIcon.dataset.emberId = ember.id;
    
    if (index === 0 && !activeEmberId) {
      serverIcon.classList.add('active');
      activeEmberId = ember.id;
      loadServerContent(ember.id, ember.name);
    } else if (ember.id === activeEmberId) {
      serverIcon.classList.add('active');
    }

    if (ember.icon_data) {
      const img = document.createElement('img');
      img.src = ember.icon_data;
      img.alt = ember.name;
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      serverIcon.appendChild(img);
    } else {
      const initial = document.createElement('span');
      initial.textContent = ember.name.charAt(0).toUpperCase();
      serverIcon.appendChild(initial);
    }

    serverIcon.addEventListener('click', () => {
      switchToServer(ember.id, ember.name);
    });

    if (separator) {
      serverList.insertBefore(serverIcon, separator);
    } else {
      serverList.insertBefore(serverIcon, addServerBtn);
    }
  });

  currentEmbers = embers;
}

function switchToServer(emberId, emberName) {
  const serverIcons = document.querySelectorAll('.server-icon');
  serverIcons.forEach(icon => {
    if (icon.dataset.emberId === emberId) {
      icon.classList.add('active');
    } else {
      icon.classList.remove('active');
    }
  });

  activeEmberId = emberId;
  loadServerContent(emberId, emberName);
}

async function fetchEmberKey(emberId) {
  if (emberKeyCache.has(emberId)) return emberKeyCache.get(emberId);
  try {
    const auth = await ipcRenderer.invoke('get-auth');
    const device = await ipcRenderer.invoke('get-device-identity');
    if (!auth || !auth.token || !auth.hostname || !device) return null;
    const response = await fetch(`${auth.hostname}/api/v1/embers/${emberId}/key`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${auth.token}` }
    });
    if (!response.ok) return null;
    const data = await response.json();
    const privateKey = naclUtil.decodeBase64(device.private_key);
    const publicKey = naclUtil.decodeBase64(device.public_key);
    const emberKey = emberCrypto.decryptEmberKeyForUser(data.encrypted_key, publicKey, privateKey);
    if (emberKey) {
      emberKeyCache.set(emberId, emberKey);
    }
    return emberKey;
  } catch (error) {
    console.error('Error fetching ember key:', error);
    return null;
  }
}

async function fetchMessages(channelId) {
  try {
    const auth = await ipcRenderer.invoke('get-auth');
    if (!auth || !auth.token || !auth.hostname) return [];
    const response = await fetch(`${auth.hostname}/api/v1/channels/${channelId}/messages`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${auth.token}` }
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.messages || [];
  } catch (error) {
    console.error('Error fetching messages:', error);
    return [];
  }
}

async function loadChannelMessages(channelId) {
  if (!messagesContainer) return;
  messagesContainer.innerHTML = '';
  activeChannelId = channelId;
  wsSubscribeToChannel(channelId);
  const messages = await fetchMessages(channelId);
  messages.forEach(msg => displayDecryptedMessage(msg));
}

async function loadServerContent(emberId, emberName) {
  const serverHeader = document.querySelector('.server-header h3');
  if (serverHeader) {
    serverHeader.textContent = emberName;
  }
  await fetchEmberKey(emberId);
  const [channels, categories] = await Promise.all([
    fetchChannels(emberId),
    fetchCategories(emberId)
  ]);
  renderChannels(channels, categories);
  const members = await fetchMembers(emberId);
  renderMemberList(members);
  wsSubscribeToEmber(emberId);
}

async function fetchMembers(emberId) {
  try {
    const auth = await ipcRenderer.invoke('get-auth');
    if (!auth || !auth.token || !auth.hostname) return [];
    const response = await fetch(`${auth.hostname}/api/v1/embers/${emberId}/members`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${auth.token}` }
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.members || [];
  } catch (error) {
    console.error('Error fetching members:', error);
    return [];
  }
}

let currentMembers = [];

function renderMemberList(members) {
  const memberList = document.getElementById('member-list');
  if (!memberList) return;
  memberList.innerHTML = '';
  currentMembers = members;
  const groups = {
    online: { label: 'ONLINE', members: [] },
    idle: { label: 'IDLE', members: [] },
    dnd: { label: 'DO NOT DISTURB', members: [] },
    offline: { label: 'OFFLINE', members: [] }
  };
  members.forEach(member => {
    const key = (member.status === 'invisible') ? 'offline' : (member.status || 'offline');
    if (groups[key]) {
      groups[key].members.push(member);
    } else {
      groups.offline.members.push(member);
    }
  });
  const groupOrder = ['online', 'idle', 'dnd', 'offline'];
  groupOrder.forEach(key => {
    const group = groups[key];
    if (group.members.length === 0) return;
    const categoryEl = document.createElement('div');
    categoryEl.className = 'member-category';
    categoryEl.textContent = `${group.label} — ${group.members.length}`;
    memberList.appendChild(categoryEl);
    const statusIconMap = {
      online: 'Icons/ember_connected.png',
      idle: 'Icons/ember_idle.gif',
      dnd: 'Icons/ember_error.png',
      offline: 'Icons/ember_disconnected.png'
    };
    group.members.forEach(member => {
      const memberEl = document.createElement('div');
      memberEl.className = 'member';
      memberEl.dataset.userId = member.user_id;
      if (key === 'offline') memberEl.classList.add('offline');
      const statusClass = key === 'dnd' ? 'dnd' : key;
      const iconSrc = statusIconMap[key] || 'Icons/ember_disconnected.png';
      memberEl.innerHTML = `
        <div class="member-avatar ${statusClass}">
          ${escapeHtml((member.username || '?').charAt(0).toUpperCase())}
          <img class="status-icon" src="${iconSrc}" alt="${key}">
        </div>
        <span class="member-name">${escapeHtml(member.username || 'Unknown')}</span>
      `;
      memberList.appendChild(memberEl);
    });
  });
}

function renderChannels(channels, categories) {
  categories = categories || [];
  const channelsContainer = document.querySelector('.channels');
  if (!channelsContainer) return;

  channelsContainer.innerHTML = '';

  // Group channels by category_id; uncategorized go first
  const channelsByCategory = {};
  const uncategorized = [];
  channels.forEach(ch => {
    if (ch.category_id) {
      if (!channelsByCategory[ch.category_id]) channelsByCategory[ch.category_id] = [];
      channelsByCategory[ch.category_id].push(ch);
    } else {
      uncategorized.push(ch);
    }
  });

  let autoSelect = null;

  function appendChannel(channel) {
    const channelEl = document.createElement('div');
    channelEl.className = 'channel';
    channelEl.dataset.channelId = channel.id;
    channelEl.dataset.itemType = 'channel';
    channelEl.dataset.catId = channel.category_id || '';
    const icon = channel.type === 'voice' ? '🔊' : '#';
    channelEl.innerHTML = `
      <span class="channel-icon">${icon}</span>
      <span class="channel-name">${escapeHtml(channel.name)}</span>
    `;
    channelEl.addEventListener('click', () => {
      document.querySelectorAll('.channel').forEach(el => el.classList.remove('active'));
      channelEl.classList.add('active');
      if (channel.type === 'voice') {
        joinVoiceChannel(channel.id, channel.name);
      } else {
        updateChatHeader(channel.name, channel.description || '');
        loadChannelMessages(channel.id);
      }
    });
    channelEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showChannelContextMenu(e.clientX, e.clientY, {
        type: 'channel',
        id: channel.id,
        name: channel.name,
        channelType: channel.type,
        categoryId: channel.category_id || null,
        description: channel.description || ''
      });
    });
    // Drag-and-drop for channels
    channelEl.setAttribute('draggable', 'true');
    channelEl.addEventListener('dragstart', (e) => {
      dragItem = { type: 'channel', id: channel.id };
      e.dataTransfer.effectAllowed = 'move';
      channelEl.classList.add('dragging');
    });
    channelEl.addEventListener('dragend', () => {
      channelEl.classList.remove('dragging');
      clearDragHighlights();
    });
    channelEl.addEventListener('dragover', (e) => {
      if (!dragItem || dragItem.type !== 'channel') return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      clearDragHighlights();
      channelEl.classList.add('drag-over-top');
    });
    channelEl.addEventListener('dragleave', () => {
      channelEl.classList.remove('drag-over-top');
    });
    channelEl.addEventListener('drop', async (e) => {
      e.preventDefault();
      clearDragHighlights();
      if (!dragItem || dragItem.type !== 'channel' || dragItem.id === channel.id) return;
      const dropped = dragItem;
      dragItem = null;
      await reorderChannels(dropped.id, channel.id, channel.category_id || null);
    });
    if (!autoSelect && channel.type === 'text') {
      autoSelect = { el: channelEl, channel };
    }
    channelsContainer.appendChild(channelEl);

    // Participant list container for voice channels
    if (channel.type === 'voice') {
      const participantList = document.createElement('div');
      participantList.className = 'voice-participant-list';
      participantList.dataset.voiceChannelId = channel.id;
      channelsContainer.appendChild(participantList);
    }
  }

  function appendCategory(cat) {
    const catEl = document.createElement('div');
    catEl.className = 'channel-category';
    catEl.dataset.categoryId = cat.id;
    catEl.dataset.itemType = 'category';
    catEl.innerHTML = `
      <span class="category-arrow">▼</span>
      <span class="category-name">${escapeHtml(cat.name.toUpperCase())}</span>
    `;
    catEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showChannelContextMenu(e.clientX, e.clientY, {
        type: 'category',
        id: cat.id,
        name: cat.name,
        channelType: null,
        categoryId: cat.id
      });
    });
    // Drag-and-drop for categories
    catEl.setAttribute('draggable', 'true');
    catEl.addEventListener('dragstart', (e) => {
      dragItem = { type: 'category', id: cat.id };
      e.dataTransfer.effectAllowed = 'move';
      catEl.classList.add('dragging');
    });
    catEl.addEventListener('dragend', () => {
      catEl.classList.remove('dragging');
      clearDragHighlights();
    });
    catEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      clearDragHighlights();
      catEl.classList.add('drag-over-top');
    });
    catEl.addEventListener('dragleave', () => {
      catEl.classList.remove('drag-over-top');
    });
    catEl.addEventListener('drop', async (e) => {
      e.preventDefault();
      clearDragHighlights();
      if (!dragItem) return;
      const dropped = dragItem;
      dragItem = null;
      if (dropped.type === 'channel') {
        // Move channel into this category (append to end)
        await reorderChannels(dropped.id, null, cat.id);
      } else if (dropped.type === 'category' && dropped.id !== cat.id) {
        await reorderCategories(dropped.id, cat.id);
      }
    });
    channelsContainer.appendChild(catEl);
  }

  // Uncategorized channels first (no header)
  uncategorized.forEach(appendChannel);

  // Categories with their channels
  categories.forEach(cat => {
    appendCategory(cat);
    (channelsByCategory[cat.id] || []).forEach(appendChannel);
  });

  // Auto-select first text channel
  if (autoSelect) {
    autoSelect.el.classList.add('active');
    updateChatHeader(autoSelect.channel.name, autoSelect.channel.description || '');
    loadChannelMessages(autoSelect.channel.id);
  }
}

let dragItem = null;

function clearDragHighlights() {
  document.querySelectorAll('.drag-over-top').forEach(el => el.classList.remove('drag-over-top'));
}

async function reorderChannels(draggedId, beforeChannelId, newCategoryId) {
  const auth = await ipcRenderer.invoke('get-auth');
  if (!auth || !auth.token || !auth.hostname || !activeEmberId) return;

  const allChannelEls = Array.from(document.querySelectorAll('.channel'));
  const updates = [];
  let position = 0;
  let inserted = false;

  for (const el of allChannelEls) {
    const id = el.dataset.channelId;
    const catId = el.dataset.catId || null;
    if (id === draggedId) continue;
    if (beforeChannelId && id === beforeChannelId) {
      updates.push({ id: draggedId, position: position++, category_id: newCategoryId || null });
      inserted = true;
    }
    updates.push({ id, position: position++, category_id: catId === '' ? null : catId });
  }
  if (!inserted) {
    updates.push({ id: draggedId, position: position, category_id: newCategoryId || null });
  }

  try {
    await fetch(`${auth.hostname}/api/v1/embers/${activeEmberId}/channels/reorder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.token}` },
      body: JSON.stringify({ channels: updates })
    });
    const [channels, categories] = await Promise.all([fetchChannels(activeEmberId), fetchCategories(activeEmberId)]);
    renderChannels(channels, categories);
  } catch (e) {
    console.error('Failed to reorder channels:', e);
  }
}

async function reorderCategories(draggedId, beforeCategoryId) {
  const auth = await ipcRenderer.invoke('get-auth');
  if (!auth || !auth.token || !auth.hostname || !activeEmberId) return;

  const allCatEls = Array.from(document.querySelectorAll('.channel-category'));
  const updates = [];
  let position = 0;
  let inserted = false;

  for (const el of allCatEls) {
    const id = el.dataset.categoryId;
    if (id === draggedId) continue;
    if (id === beforeCategoryId) {
      updates.push({ id: draggedId, position: position++ });
      inserted = true;
    }
    updates.push({ id, position: position++ });
  }
  if (!inserted) {
    updates.push({ id: draggedId, position: position });
  }

  try {
    await fetch(`${auth.hostname}/api/v1/embers/${activeEmberId}/categories/reorder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.token}` },
      body: JSON.stringify({ categories: updates })
    });
    const [channels, categories] = await Promise.all([fetchChannels(activeEmberId), fetchCategories(activeEmberId)]);
    renderChannels(channels, categories);
  } catch (e) {
    console.error('Failed to reorder categories:', e);
  }
}

function updateChatHeader(channelName, description) {
  const chatHeader = document.querySelector('.chat-header');
  if (chatHeader) {
    const channelTitle = chatHeader.querySelector('.channel-title');
    const channelDesc = chatHeader.querySelector('.channel-description');
    if (channelTitle) channelTitle.textContent = channelName;
    if (channelDesc) channelDesc.textContent = description || '';
  }
}

function showWelcomeScreen() {
  const welcomeScreen = document.getElementById('welcome-screen');
  const chatContainer = document.getElementById('chat-container');
  const memberList = document.getElementById('member-list');
  const channels = document.querySelector('.channels');
  const serverHeader = document.querySelector('.server-header');
  if (welcomeScreen) welcomeScreen.classList.remove('hidden');
  if (chatContainer) chatContainer.style.display = 'none';
  if (memberList) memberList.style.display = 'none';
  if (channels) channels.style.display = 'none';
  if (serverHeader) serverHeader.style.display = 'none';
}

function hideWelcomeScreen() {
  const welcomeScreen = document.getElementById('welcome-screen');
  const chatContainer = document.getElementById('chat-container');
  const memberList = document.getElementById('member-list');
  const channels = document.querySelector('.channels');
  const serverHeader = document.querySelector('.server-header');
  if (welcomeScreen) welcomeScreen.classList.add('hidden');
  if (chatContainer) chatContainer.style.display = '';
  if (memberList) memberList.style.display = '';
  if (channels) channels.style.display = '';
  if (serverHeader) serverHeader.style.display = '';
}

async function verifyUserExists() {
  try {
    const auth = await ipcRenderer.invoke('get-auth');
    if (!auth || !auth.token || !auth.hostname) {
      forceLogout();
      return false;
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${auth.hostname}/api/v1/me`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${auth.token}` },
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      forceLogout();
      return false;
    }
    return true;
  } catch (error) {
    console.error('User verification failed:', error);
    forceLogout();
    return false;
  }
}

async function initializeApp() {
  const isValid = await verifyUserExists();
  if (!isValid) return;
  const auth = await ipcRenderer.invoke('get-auth');
  if (auth && auth.username) {
    const usernameEl = document.querySelector('.user-panel .username');
    if (usernameEl) usernameEl.textContent = auth.username;
  }
  const embers = await fetchEmbers();
  if (embers.length > 0) {
    hideWelcomeScreen();
    renderServerList(embers);
  } else {
    showWelcomeScreen();
  }
}

// Create Server Modal Logic
const createServerModal = document.getElementById('create-server-modal');
const createServerBtn = document.getElementById('create-server-btn');
const createServerCancelBtn = document.getElementById('create-server-cancel-btn');
const serverNameInput = document.getElementById('server-name-input');
const serverIconUpload = document.getElementById('server-icon-upload');
const uploadIconBtn = document.getElementById('upload-icon-btn');
const serverIconUrl = document.getElementById('server-icon-url');
const loadUrlBtn = document.getElementById('load-url-btn');
const iconPreview = document.getElementById('icon-preview');
const removeIconBtn = document.getElementById('remove-icon-btn');
const createServerError = document.getElementById('create-server-error');
const uploadSection = document.getElementById('upload-section');
const urlSection = document.getElementById('url-section');
const iconToggleBtns = document.querySelectorAll('.icon-toggle-btn');
const addServerBtn = document.querySelector('.add-server');

let currentIconData = null;
let currentIconSource = 'upload';

const addServerModal = document.getElementById('add-server-modal');
const addServerCreateBtn = document.getElementById('add-server-create-btn');
const addServerJoinBtn = document.getElementById('add-server-join-btn');
const addServerCancelBtn = document.getElementById('add-server-cancel-btn');

if (addServerBtn) {
  addServerBtn.addEventListener('click', () => {
    if (addServerModal) addServerModal.classList.remove('hidden');
  });
}

if (addServerCancelBtn) {
  addServerCancelBtn.addEventListener('click', () => {
    if (addServerModal) addServerModal.classList.add('hidden');
  });
}

if (addServerModal) {
  addServerModal.addEventListener('click', (e) => {
    if (e.target === addServerModal) addServerModal.classList.add('hidden');
  });
}

if (addServerCreateBtn) {
  addServerCreateBtn.addEventListener('click', () => {
    if (addServerModal) addServerModal.classList.add('hidden');
    openCreateServerModal();
  });
}

if (addServerJoinBtn) {
  addServerJoinBtn.addEventListener('click', () => {
    if (addServerModal) addServerModal.classList.add('hidden');
    openJoinServerModal();
  });
}

function openCreateServerModal() {
  if (createServerModal) {
    createServerModal.classList.remove('hidden');
    resetCreateServerForm();
  }
}

function closeCreateServerModal() {
  if (createServerModal) {
    createServerModal.classList.add('hidden');
    resetCreateServerForm();
  }
}

function resetCreateServerForm() {
  if (serverNameInput) serverNameInput.value = '';
  if (serverIconUrl) serverIconUrl.value = '';
  if (serverIconUpload) serverIconUpload.value = '';
  currentIconData = null;
  updateIconPreview(null);
  hideCreateServerError();
  currentIconSource = 'upload';
  updateIconSourceUI();
}

function updateIconSourceUI() {
  iconToggleBtns.forEach(btn => {
    if (btn.dataset.source === currentIconSource) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  if (currentIconSource === 'upload') {
    uploadSection?.classList.remove('hidden');
    urlSection?.classList.add('hidden');
  } else {
    uploadSection?.classList.add('hidden');
    urlSection?.classList.remove('hidden');
  }
}

iconToggleBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    currentIconSource = btn.dataset.source;
    updateIconSourceUI();
    currentIconData = null;
    updateIconPreview(null);
  });
});

if (uploadIconBtn) {
  uploadIconBtn.addEventListener('click', () => {
    serverIconUpload?.click();
  });
}

if (serverIconUpload) {
  serverIconUpload.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const resizedBase64 = await resizeImage(file, 512, 512);
        currentIconData = resizedBase64;
        updateIconPreview(resizedBase64);
      } catch (error) {
        showCreateServerError('Failed to process image');
        console.error('Image processing error:', error);
      }
    }
  });
}

if (loadUrlBtn) {
  loadUrlBtn.addEventListener('click', async () => {
    const url = serverIconUrl?.value.trim();
    if (!url) {
      showCreateServerError('Please enter an image URL');
      return;
    }

    if (!isValidUrl(url)) {
      showCreateServerError('Please enter a valid URL');
      return;
    }

    try {
      currentIconData = url;
      updateIconPreview(url);
    } catch (error) {
      showCreateServerError('Failed to load image from URL');
      console.error('URL load error:', error);
    }
  });
}

if (removeIconBtn) {
  removeIconBtn.addEventListener('click', () => {
    currentIconData = null;
    updateIconPreview(null);
    if (serverIconUpload) serverIconUpload.value = '';
    if (serverIconUrl) serverIconUrl.value = '';
  });
}

function updateIconPreview(data) {
  if (!iconPreview) return;

  iconPreview.innerHTML = '';

  if (data) {
    const img = document.createElement('img');
    img.src = data;
    img.onerror = () => {
      iconPreview.innerHTML = '<span class="preview-placeholder">Failed to load image</span>';
      removeIconBtn?.classList.add('hidden');
    };
    img.onload = () => {
      removeIconBtn?.classList.remove('hidden');
    };
    iconPreview.appendChild(img);
  } else {
    iconPreview.innerHTML = '<span class="preview-placeholder">No icon selected</span>';
    removeIconBtn?.classList.add('hidden');
  }
}

function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

async function resizeImage(file, maxWidth, maxHeight) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          const aspectRatio = width / height;
          if (width > height) {
            width = maxWidth;
            height = width / aspectRatio;
          } else {
            height = maxHeight;
            width = height * aspectRatio;
          }
        }

        canvas.width = maxWidth;
        canvas.height = maxHeight;
        const ctx = canvas.getContext('2d');
        
        const offsetX = (maxWidth - width) / 2;
        const offsetY = (maxHeight - height) / 2;
        
        ctx.fillStyle = '#2f3136';
        ctx.fillRect(0, 0, maxWidth, maxHeight);
        ctx.drawImage(img, offsetX, offsetY, width, height);

        resolve(canvas.toDataURL(file.type || 'image/png'));
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

if (createServerCancelBtn) {
  createServerCancelBtn.addEventListener('click', () => {
    closeCreateServerModal();
  });
}

if (createServerModal) {
  createServerModal.addEventListener('click', (e) => {
    if (e.target === createServerModal) {
      closeCreateServerModal();
    }
  });
}

if (createServerBtn) {
  createServerBtn.addEventListener('click', async () => {
    await handleCreateServer();
  });
}

async function handleCreateServer() {
  const serverName = serverNameInput?.value.trim();

  if (!serverName) {
    showCreateServerError('Server name is required');
    return;
  }

  if (serverName.length > 100) {
    showCreateServerError('Server name must be 100 characters or less');
    return;
  }

  try {
    createServerBtn.disabled = true;
    createServerBtn.textContent = 'Creating...';

    const auth = await ipcRenderer.invoke('get-auth');
    if (!auth || !auth.token || !auth.hostname) {
      showCreateServerError('Not authenticated');
      return;
    }

    const device = await ipcRenderer.invoke('get-device-identity');
    if (!device) {
      showCreateServerError('Device identity not found');
      return;
    }

    const emberKey = emberCrypto.generateEmberKey();
    const publicKeyBytes = naclUtil.decodeBase64(device.public_key);
    const privateKeyBytes = naclUtil.decodeBase64(device.private_key);
    const encryptedEmberKey = emberCrypto.encryptEmberKeyForUser(emberKey, publicKeyBytes, privateKeyBytes);

    const requestBody = {
      name: serverName,
      encrypted_ember_key: encryptedEmberKey
    };

    if (currentIconData) {
      requestBody.icon_data = currentIconData;
    }

    const response = await fetch(`${auth.hostname}/api/v1/embers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${auth.token}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to create server');
    }

    const newEmber = await response.json();

    if (newEmber.id) {
      emberKeyCache.set(newEmber.id, emberKey);
    }

    closeCreateServerModal();
    
    console.log('Server created successfully:', newEmber);

    hideWelcomeScreen();
    const embers = await fetchEmbers();
    renderServerList(embers);
    
    if (newEmber.id) {
      switchToServer(newEmber.id, newEmber.name);
    }

  } catch (error) {
    showCreateServerError(error.message || 'Failed to create server');
    console.error('Create server error:', error);
  } finally {
    createServerBtn.disabled = false;
    createServerBtn.textContent = 'Create Server';
  }
}

function showCreateServerError(message) {
  if (createServerError) {
    createServerError.textContent = message;
    createServerError.classList.remove('hidden');
  }
}

function hideCreateServerError() {
  if (createServerError) {
    createServerError.classList.add('hidden');
  }
}

// Join Server Modal
const joinServerModal = document.getElementById('join-server-modal');
const joinInviteInput = document.getElementById('join-invite-input');
const joinServerBtn = document.getElementById('join-server-btn');
const joinServerCancelBtn = document.getElementById('join-server-cancel-btn');
const joinServerError = document.getElementById('join-server-error');

function openJoinServerModal() {
  if (!joinServerModal) return;
  if (joinInviteInput) joinInviteInput.value = '';
  if (joinServerError) joinServerError.classList.add('hidden');
  if (joinServerBtn) {
    joinServerBtn.disabled = false;
    joinServerBtn.textContent = 'Join';
  }
  joinServerModal.classList.remove('hidden');
  if (joinInviteInput) joinInviteInput.focus();
}

function closeJoinServerModal() {
  if (joinServerModal) joinServerModal.classList.add('hidden');
}

function showJoinServerError(message) {
  if (joinServerError) {
    joinServerError.textContent = message;
    joinServerError.classList.remove('hidden');
  }
}

if (joinServerCancelBtn) {
  joinServerCancelBtn.addEventListener('click', closeJoinServerModal);
}

if (joinServerModal) {
  joinServerModal.addEventListener('click', (e) => {
    if (e.target === joinServerModal) closeJoinServerModal();
  });
}

function parseInviteInput(input) {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/\/invite\/([A-Za-z0-9]+)\/?$/);
  if (urlMatch) {
    try {
      const url = new URL(trimmed);
      const hostname = url.origin;
      return { code: urlMatch[1], hostname };
    } catch (_) {
      return { code: urlMatch[1], hostname: null };
    }
  }
  const codeMatch = trimmed.match(/^[A-Za-z0-9]+$/);
  if (codeMatch) {
    return { code: trimmed, hostname: null };
  }
  return null;
}

if (joinServerBtn) {
  joinServerBtn.addEventListener('click', async () => {
    const value = joinInviteInput ? joinInviteInput.value : '';
    if (!value.trim()) {
      showJoinServerError('Please enter an invite link or code');
      return;
    }
    const parsed = parseInviteInput(value);
    if (!parsed) {
      showJoinServerError('Invalid invite link or code');
      return;
    }
    joinServerBtn.disabled = true;
    joinServerBtn.textContent = 'Loading...';
    closeJoinServerModal();
    await processInviteLink(parsed.code, parsed.hostname);
  });
}

if (joinInviteInput) {
  joinInviteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && joinServerBtn) joinServerBtn.click();
  });
}

// Server Header Dropdown
const serverHeader = document.getElementById('server-header');
const serverHeaderMenu = document.getElementById('server-header-menu');
const invitePeopleBtn = document.getElementById('invite-people-btn');

if (serverHeader && serverHeaderMenu) {
  serverHeader.addEventListener('click', (e) => {
    e.stopPropagation();
    serverHeaderMenu.classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!serverHeaderMenu.classList.contains('hidden') && !serverHeaderMenu.contains(e.target)) {
      serverHeaderMenu.classList.add('hidden');
    }
  });
}

// Create Invite Modal
const createInviteModal = document.getElementById('create-invite-modal');
const createInviteBtn = document.getElementById('create-invite-btn');
const createInviteCancelBtn = document.getElementById('create-invite-cancel-btn');
const inviteExpirationSelect = document.getElementById('invite-expiration');
const inviteMaxUsesSelect = document.getElementById('invite-max-uses');
const inviteLinkResult = document.getElementById('invite-link-result');
const inviteLinkInput = document.getElementById('invite-link-input');
const inviteCopyBtn = document.getElementById('invite-copy-btn');
const createInviteError = document.getElementById('create-invite-error');

if (invitePeopleBtn) {
  invitePeopleBtn.addEventListener('click', () => {
    serverHeaderMenu.classList.add('hidden');
    openCreateInviteModal();
  });
}

function openCreateInviteModal() {
  if (!createInviteModal) return;
  resetCreateInviteForm();
  createInviteModal.classList.remove('hidden');
}

function closeCreateInviteModal() {
  if (createInviteModal) createInviteModal.classList.add('hidden');
  resetCreateInviteForm();
}

function resetCreateInviteForm() {
  if (inviteExpirationSelect) inviteExpirationSelect.value = '86400';
  if (inviteMaxUsesSelect) inviteMaxUsesSelect.value = '0';
  if (inviteLinkResult) inviteLinkResult.classList.add('hidden');
  if (inviteLinkInput) inviteLinkInput.value = '';
  if (createInviteBtn) {
    createInviteBtn.disabled = false;
    createInviteBtn.textContent = 'Generate Link';
  }
  hideCreateInviteError();
}

function showCreateInviteError(message) {
  if (createInviteError) {
    createInviteError.textContent = message;
    createInviteError.classList.remove('hidden');
  }
}

function hideCreateInviteError() {
  if (createInviteError) createInviteError.classList.add('hidden');
}

if (createInviteCancelBtn) {
  createInviteCancelBtn.addEventListener('click', closeCreateInviteModal);
}

if (createInviteModal) {
  createInviteModal.addEventListener('click', (e) => {
    if (e.target === createInviteModal) closeCreateInviteModal();
  });
}

if (createInviteBtn) {
  createInviteBtn.addEventListener('click', async () => {
    await handleCreateInvite();
  });
}

if (inviteCopyBtn) {
  inviteCopyBtn.addEventListener('click', () => {
    if (inviteLinkInput && inviteLinkInput.value) {
      navigator.clipboard.writeText(inviteLinkInput.value).then(() => {
        inviteCopyBtn.textContent = 'Copied!';
        setTimeout(() => { inviteCopyBtn.textContent = 'Copy'; }, 2000);
      });
    }
  });
}

async function handleCreateInvite() {
  if (!activeEmberId) {
    showCreateInviteError('No server selected');
    return;
  }
  const emberKey = emberKeyCache.get(activeEmberId);
  if (!emberKey) {
    showCreateInviteError('Ember key not available');
    return;
  }
  try {
    createInviteBtn.disabled = true;
    createInviteBtn.textContent = 'Generating...';
    const auth = await ipcRenderer.invoke('get-auth');
    if (!auth || !auth.token || !auth.hostname) {
      showCreateInviteError('Not authenticated');
      return;
    }
    const expiresIn = parseInt(inviteExpirationSelect.value) || 0;
    const maxUses = parseInt(inviteMaxUsesSelect.value) || 0;
    const inviteCode = Array.from(crypto.getRandomValues(new Uint8Array(4)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    const inviteKeyData = await emberCrypto.encryptEmberKeyForInvite(emberKey, inviteCode);
    const requestBody = {
      code: inviteCode,
      encrypted_ember_key: inviteKeyData.encrypted,
      key_salt: inviteKeyData.salt
    };
    if (expiresIn > 0) requestBody.expires_in = expiresIn;
    if (maxUses > 0) requestBody.max_uses = maxUses;
    const response = await fetch(`${auth.hostname}/api/v1/embers/${activeEmberId}/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${auth.token}`
      },
      body: JSON.stringify(requestBody)
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to create invite');
    }
    const data = await response.json();
    if (inviteLinkInput) inviteLinkInput.value = data.invite_url;
    if (inviteLinkResult) inviteLinkResult.classList.remove('hidden');
  } catch (error) {
    showCreateInviteError(error.message || 'Failed to create invite');
    console.error('Create invite error:', error);
  } finally {
    createInviteBtn.disabled = false;
    createInviteBtn.textContent = 'Generate Link';
  }
}

// Accept Invite Modal
const acceptInviteModal = document.getElementById('accept-invite-modal');
const acceptInviteCancelBtn = document.getElementById('accept-invite-cancel-btn');
const acceptInviteJoinBtn = document.getElementById('accept-invite-join-btn');
const acceptInviteIcon = document.getElementById('accept-invite-icon');
const acceptInviteName = document.getElementById('accept-invite-name');
const acceptInviteMembers = document.getElementById('accept-invite-members');
const acceptInviteError = document.getElementById('accept-invite-error');

let pendingInvite = null;

function openAcceptInviteModal(inviteInfo) {
  if (!acceptInviteModal) return;
  pendingInvite = inviteInfo;
  if (acceptInviteIcon) {
    if (inviteInfo.ember_icon) {
      acceptInviteIcon.innerHTML = `<img src="${escapeHtml(inviteInfo.ember_icon)}" alt="icon" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    } else {
      acceptInviteIcon.textContent = (inviteInfo.ember_name || '?').charAt(0).toUpperCase();
    }
  }
  if (acceptInviteName) acceptInviteName.textContent = inviteInfo.ember_name || 'Unknown Server';
  if (acceptInviteMembers) acceptInviteMembers.textContent = `${inviteInfo.member_count || 0} members`;
  if (acceptInviteError) acceptInviteError.classList.add('hidden');
  if (acceptInviteJoinBtn) {
    acceptInviteJoinBtn.disabled = false;
    acceptInviteJoinBtn.textContent = 'Join Server';
  }
  acceptInviteModal.classList.remove('hidden');
}

function closeAcceptInviteModal() {
  if (acceptInviteModal) acceptInviteModal.classList.add('hidden');
  pendingInvite = null;
}

function showAcceptInviteError(message) {
  if (acceptInviteError) {
    acceptInviteError.textContent = message;
    acceptInviteError.classList.remove('hidden');
  }
}

if (acceptInviteCancelBtn) {
  acceptInviteCancelBtn.addEventListener('click', closeAcceptInviteModal);
}

if (acceptInviteModal) {
  acceptInviteModal.addEventListener('click', (e) => {
    if (e.target === acceptInviteModal) closeAcceptInviteModal();
  });
}

if (acceptInviteJoinBtn) {
  acceptInviteJoinBtn.addEventListener('click', async () => {
    await handleAcceptInvite();
  });
}

async function handleAcceptInvite() {
  if (!pendingInvite) return;
  try {
    acceptInviteJoinBtn.disabled = true;
    acceptInviteJoinBtn.textContent = 'Joining...';
    const auth = await ipcRenderer.invoke('get-auth');
    const device = await ipcRenderer.invoke('get-device-identity');
    if (!auth || !auth.token || !device) {
      showAcceptInviteError('Not authenticated');
      return;
    }
    const hostname = pendingInvite.hostname || auth.hostname;
    const emberKey = await emberCrypto.decryptEmberKeyFromInvite(
      pendingInvite.encrypted_ember_key,
      pendingInvite.code,
      pendingInvite.key_salt
    );
    if (!emberKey) {
      showAcceptInviteError('Failed to decrypt ember key from invite');
      return;
    }
    const publicKeyBytes = naclUtil.decodeBase64(device.public_key);
    const privateKeyBytes = naclUtil.decodeBase64(device.private_key);
    const encryptedEmberKey = emberCrypto.encryptEmberKeyForUser(emberKey, publicKeyBytes, privateKeyBytes);
    const response = await fetch(`${hostname}/api/v1/invites/${pendingInvite.code}/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${auth.token}`
      },
      body: JSON.stringify({ encrypted_ember_key: encryptedEmberKey })
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to join server');
    }
    const data = await response.json();
    if (data.ember_id) {
      emberKeyCache.set(data.ember_id, emberKey);
    }
    closeAcceptInviteModal();
    hideWelcomeScreen();
    const embers = await fetchEmbers();
    renderServerList(embers);
    if (data.ember_id) {
      switchToServer(data.ember_id, data.ember_name);
    }
  } catch (error) {
    showAcceptInviteError(error.message || 'Failed to join server');
    console.error('Accept invite error:', error);
  } finally {
    if (acceptInviteJoinBtn) {
      acceptInviteJoinBtn.disabled = false;
      acceptInviteJoinBtn.textContent = 'Join Server';
    }
  }
}

async function processInviteLink(code, hostname) {
  try {
    const auth = await ipcRenderer.invoke('get-auth');
    if (!auth || !auth.token) {
      console.error('Not authenticated, cannot process invite');
      return;
    }
    const targetHostname = hostname || auth.hostname;
    const response = await fetch(`${targetHostname}/api/v1/invites/${code}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${auth.token}` }
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Failed to fetch invite info:', errorData.error || response.status);
      return;
    }
    const inviteInfo = await response.json();
    inviteInfo.hostname = targetHostname;
    openAcceptInviteModal(inviteInfo);
  } catch (error) {
    console.error('Error processing invite link:', error);
  }
}

ipcRenderer.on('handle-invite-link', (_event, invite) => {
  processInviteLink(invite.code, invite.hostname);
});

// WebSocket Connection
async function connectWebSocket() {
  if (wsConnection && wsConnection.readyState === WebSocket.OPEN) return;
  try {
    const auth = await ipcRenderer.invoke('get-auth');
    if (!auth || !auth.token || !auth.hostname) return;
    const wsUrl = auth.hostname.replace(/^http/, 'ws').replace(/:8085\b/, ':8086') + '/ws?token=' + encodeURIComponent(auth.token);
    wsConnection = new WebSocket(wsUrl);
    wsConnection.onopen = () => {
      console.log('WebSocket connected');
      if (activeChannelId) {
        wsSubscribeToChannel(activeChannelId);
      }
      if (activeEmberId) {
        wsSubscribeToEmber(activeEmberId);
      }
    };
    wsConnection.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'new_message' && data.payload) {
          handleIncomingMessage(data.payload);
        } else if (data.type === 'presence_update' && data.payload) {
          handlePresenceUpdate(data.payload);
        } else if (data.type === 'voice_offer' || data.type === 'voice_ice_candidate' ||
                   data.type === 'voice_speaking' || data.type === 'voice_participants') {
          if (voiceManager) voiceManager.handleMessage(data);
        } else if (data.type === 'voice_user_joined' && data.payload) {
          handleVoiceUserJoined(data.payload);
        } else if (data.type === 'voice_user_left' && data.payload) {
          handleVoiceUserLeft(data.payload);
        }
      } catch (err) {
        console.error('WebSocket message parse error:', err);
      }
    };
    wsConnection.onclose = () => {
      console.log('WebSocket disconnected');
      wsConnection = null;
      if (!wsReconnectTimer) {
        wsReconnectTimer = setTimeout(() => {
          wsReconnectTimer = null;
          connectWebSocket();
        }, 3000);
      }
    };
    wsConnection.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  } catch (error) {
    console.error('Failed to connect WebSocket:', error);
  }
}

function wsSubscribeToChannel(channelId) {
  if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) return;
  wsConnection.send(JSON.stringify({ type: 'subscribe', channel_id: channelId }));
}

function wsSubscribeToEmber(emberId) {
  if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) return;
  wsConnection.send(JSON.stringify({ type: 'subscribe_ember', ember_id: emberId }));
}

function handlePresenceUpdate(payload) {
  const { user_id, username, status } = payload;
  const memberIdx = currentMembers.findIndex(m => m.user_id === user_id);
  if (memberIdx !== -1) {
    currentMembers[memberIdx].status = status;
  } else {
    currentMembers.push({ user_id, username, status, role: 'member' });
  }
  renderMemberList(currentMembers);
}

async function handleIncomingMessage(payload) {
  if (payload.channel_id !== activeChannelId) return;
  const auth = await ipcRenderer.invoke('get-auth');
  if (auth && payload.sender_user_id === auth.user_id) return;
  displayDecryptedMessage(payload);
}

function disconnectWebSocket() {
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }
  if (wsConnection) {
    wsConnection.close();
    wsConnection = null;
  }
}

// ─── Channel Context Menu ─────────────────────────────────────────────────────

const channelContextMenu = document.getElementById('channel-context-menu');
let contextMenuTarget = null;

function showChannelContextMenu(x, y, target) {
  if (!channelContextMenu) return;
  contextMenuTarget = target;

  const editLabel = document.getElementById('ctx-edit-label');
  if (editLabel) {
    editLabel.textContent = target.type === 'category' ? 'Edit Category' : 'Edit Channel';
  }
  const deleteLabel = document.getElementById('ctx-delete-label');
  if (deleteLabel) {
    deleteLabel.textContent = target.type === 'category' ? 'Delete Category' : 'Delete Channel';
  }

  // Show/hide edit and delete items for empty-space clicks
  const showEditDelete = target.type !== 'empty';
  const editSep = document.getElementById('ctx-edit-separator');
  const editItem = document.getElementById('ctx-edit-item');
  const deleteSep = document.getElementById('ctx-delete-separator');
  const deleteItem = document.getElementById('ctx-delete-item');
  if (editSep) editSep.style.display = showEditDelete ? '' : 'none';
  if (editItem) editItem.style.display = showEditDelete ? '' : 'none';
  if (deleteSep) deleteSep.style.display = showEditDelete ? '' : 'none';
  if (deleteItem) deleteItem.style.display = showEditDelete ? '' : 'none';

  // Show first so we can measure height
  channelContextMenu.classList.remove('hidden');
  const menuRect = channelContextMenu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - menuRect.width - 5);
  const top = Math.min(y, window.innerHeight - menuRect.height - 5);
  channelContextMenu.style.left = `${left}px`;
  channelContextMenu.style.top = `${top}px`;
}

function hideChannelContextMenu() {
  if (channelContextMenu) channelContextMenu.classList.add('hidden');
  contextMenuTarget = null;
}

document.addEventListener('click', () => hideChannelContextMenu());

document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('.channel') && !e.target.closest('.channel-category')) {
    hideChannelContextMenu();
    if (e.target.closest('.channels') && activeEmberId) {
      e.preventDefault();
      showChannelContextMenu(e.clientX, e.clientY, {
        type: 'empty',
        id: null,
        name: null,
        channelType: null,
        categoryId: null
      });
    }
  }
});

document.getElementById('ctx-new-text-channel')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const categoryId = contextMenuTarget?.categoryId || null;
  hideChannelContextMenu();
  openChannelNameModal('create-text', categoryId, null, '');
});

document.getElementById('ctx-new-voice-channel')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const categoryId = contextMenuTarget?.categoryId || null;
  hideChannelContextMenu();
  openChannelNameModal('create-voice', categoryId, null, '');
});

document.getElementById('ctx-edit-item')?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!contextMenuTarget) return;
  const mode = contextMenuTarget.type === 'category' ? 'edit-category' : 'edit-channel';
  const id = contextMenuTarget.id;
  const name = contextMenuTarget.name;
  const description = contextMenuTarget.description || '';
  hideChannelContextMenu();
  openChannelNameModal(mode, null, id, name, description);
});

document.getElementById('ctx-new-category')?.addEventListener('click', (e) => {
  e.stopPropagation();
  hideChannelContextMenu();
  openChannelNameModal('create-category', null, null, '');
});

document.getElementById('ctx-delete-item')?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!contextMenuTarget || contextMenuTarget.type === 'empty') return;
  const isCategory = contextMenuTarget.type === 'category';
  const titleEl = document.getElementById('delete-modal-title');
  const msgEl = document.getElementById('delete-modal-message');
  if (titleEl) titleEl.textContent = isCategory ? 'Delete Category' : 'Delete Channel';
  if (msgEl) {
    msgEl.textContent = isCategory
      ? `Are you sure you want to delete "${contextMenuTarget.name}"? Channels inside will become uncategorized.`
      : `Are you sure you want to delete "${contextMenuTarget.name}"? All messages will be permanently lost.`;
  }
  if (channelContextMenu) channelContextMenu.classList.add('hidden');
  document.getElementById('delete-confirm-modal')?.classList.remove('hidden');
});

document.getElementById('delete-modal-cancel-btn')?.addEventListener('click', () => {
  document.getElementById('delete-confirm-modal')?.classList.add('hidden');
  contextMenuTarget = null;
});

document.getElementById('delete-modal-confirm-btn')?.addEventListener('click', async () => {
  if (!contextMenuTarget) return;
  const target = contextMenuTarget;
  const btn = document.getElementById('delete-modal-confirm-btn');
  if (btn) btn.disabled = true;
  try {
    const auth = await ipcRenderer.invoke('get-auth');
    if (!auth || !auth.token || !auth.hostname) return;
    let res;
    if (target.type === 'category') {
      res = await fetch(`${auth.hostname}/api/v1/embers/${activeEmberId}/categories/${target.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${auth.token}` }
      });
    } else {
      res = await fetch(`${auth.hostname}/api/v1/channels/${target.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${auth.token}` }
      });
    }
    if (res.ok) {
      if (target.type === 'channel' && target.id === activeChannelId) {
        activeChannelId = null;
        updateChatHeader('', '');
        if (messagesContainer) messagesContainer.innerHTML = '';
      }
      document.getElementById('delete-confirm-modal')?.classList.add('hidden');
      const [channels, categories] = await Promise.all([
        fetchChannels(activeEmberId),
        fetchCategories(activeEmberId)
      ]);
      renderChannels(channels, categories);
    } else {
      const err = await res.json().catch(() => ({}));
      console.error('Delete failed:', err.error);
    }
  } catch (err) {
    console.error('Delete error:', err);
  } finally {
    if (btn) btn.disabled = false;
    contextMenuTarget = null;
  }
});

// ─── Channel / Category Name Modal ───────────────────────────────────────────

const channelNameModal = document.getElementById('channel-name-modal');
const channelModalTitle = document.getElementById('channel-modal-title');
const channelNameInput = document.getElementById('channel-name-input');
const channelModalConfirmBtn = document.getElementById('channel-modal-confirm-btn');
const channelModalCancelBtn = document.getElementById('channel-modal-cancel-btn');
const channelModalError = document.getElementById('channel-modal-error');

let channelModalMode = null;
let channelModalTargetId = null;
let channelModalCategoryId = null;

const CHANNEL_MODAL_CONFIG = {
  'create-text':     { title: 'Create Text Channel',  label: 'CHANNEL NAME',  confirm: 'Create' },
  'create-voice':    { title: 'Create Voice Channel', label: 'CHANNEL NAME',  confirm: 'Create' },
  'edit-channel':    { title: 'Edit Channel',         label: 'CHANNEL NAME',  confirm: 'Save'   },
  'create-category': { title: 'Create Category',      label: 'CATEGORY NAME', confirm: 'Create' },
  'edit-category':   { title: 'Edit Category',        label: 'CATEGORY NAME', confirm: 'Save'   },
};

function openChannelNameModal(mode, categoryId, targetId, currentName, currentDescription = '') {
  channelModalMode = mode;
  channelModalTargetId = targetId || null;
  channelModalCategoryId = categoryId || null;

  const cfg = CHANNEL_MODAL_CONFIG[mode] || {};
  if (channelModalTitle) channelModalTitle.textContent = cfg.title || 'Name';
  const labelEl = document.getElementById('channel-name-label');
  if (labelEl) labelEl.textContent = cfg.label || 'NAME';
  if (channelModalConfirmBtn) channelModalConfirmBtn.textContent = cfg.confirm || 'Confirm';
  if (channelNameInput) channelNameInput.value = currentName || '';
  if (channelModalError) channelModalError.classList.add('hidden');
  if (channelModalConfirmBtn) channelModalConfirmBtn.disabled = false;

  const descGroup = document.getElementById('channel-desc-group');
  const descInput = document.getElementById('channel-desc-input');
  const showDesc = mode === 'edit-channel';
  if (descGroup) descGroup.style.display = showDesc ? '' : 'none';
  if (descInput) descInput.value = showDesc ? currentDescription : '';

  if (channelNameModal) channelNameModal.classList.remove('hidden');
  setTimeout(() => channelNameInput?.focus(), 50);
}

function closeChannelNameModal() {
  if (channelNameModal) channelNameModal.classList.add('hidden');
  channelModalMode = null;
  channelModalTargetId = null;
  channelModalCategoryId = null;
}

function showChannelModalError(msg) {
  if (channelModalError) {
    channelModalError.textContent = msg;
    channelModalError.classList.remove('hidden');
  }
}

if (channelModalCancelBtn) {
  channelModalCancelBtn.addEventListener('click', closeChannelNameModal);
}

if (channelNameModal) {
  channelNameModal.addEventListener('click', (e) => {
    if (e.target === channelNameModal) closeChannelNameModal();
  });
}

if (channelNameInput) {
  channelNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') channelModalConfirmBtn?.click();
  });
}

if (channelModalConfirmBtn) {
  channelModalConfirmBtn.addEventListener('click', async () => {
    const name = channelNameInput?.value.trim();
    if (!name) {
      showChannelModalError('Name is required');
      return;
    }
    channelModalConfirmBtn.disabled = true;
    try {
      const auth = await ipcRenderer.invoke('get-auth');
      if (!auth || !auth.token || !auth.hostname) {
        showChannelModalError('Not authenticated');
        return;
      }

      if (channelModalMode === 'create-text' || channelModalMode === 'create-voice') {
        const type = channelModalMode === 'create-text' ? 'text' : 'voice';
        const body = { name, type };
        if (channelModalCategoryId) body.category_id = channelModalCategoryId;
        const res = await fetch(`${auth.hostname}/api/v1/embers/${activeEmberId}/channels`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.token}` },
          body: JSON.stringify(body)
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to create channel');
        }
      } else if (channelModalMode === 'edit-channel') {
        const descInput = document.getElementById('channel-desc-input');
        const description = descInput ? descInput.value.trim() : '';
        const res = await fetch(`${auth.hostname}/api/v1/channels/${channelModalTargetId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.token}` },
          body: JSON.stringify({ name, description })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to update channel');
        }
      } else if (channelModalMode === 'create-category') {
        const res = await fetch(`${auth.hostname}/api/v1/embers/${activeEmberId}/categories`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.token}` },
          body: JSON.stringify({ name })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to create category');
        }
      } else if (channelModalMode === 'edit-category') {
        const res = await fetch(`${auth.hostname}/api/v1/embers/${activeEmberId}/categories/${channelModalTargetId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auth.token}` },
          body: JSON.stringify({ name })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to update category');
        }
      }

      closeChannelNameModal();
      const [channels, categories] = await Promise.all([
        fetchChannels(activeEmberId),
        fetchCategories(activeEmberId)
      ]);
      renderChannels(channels, categories);
    } catch (error) {
      showChannelModalError(error.message || 'Something went wrong');
    } finally {
      if (channelModalConfirmBtn) channelModalConfirmBtn.disabled = false;
    }
  });
}

// ─── Voice Channel Functions ───────────────────────────────────────────────

async function joinVoiceChannel(channelId, channelName) {
  if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) return;

  // If already in a voice channel, silently leave it before joining the new one
  if (activeVoiceChannelId && activeVoiceChannelId !== channelId && voiceManager) {
    await voiceManager.leaveChannel();
    activeVoiceChannelId = null;
    voiceParticipants.clear();
    hideVoiceControls();
    renderVoiceParticipants(null);
    document.querySelectorAll('.voice-avatar.speaking').forEach(el => el.classList.remove('speaking'));
  }

  const auth = await ipcRenderer.invoke('get-auth');
  if (!auth) return;

  // Initialize VoiceManager if needed
  if (!voiceManager) {
    voiceManager = new VoiceManager(wsConnection, auth);
    voiceManager.onSpeakingChanged = (userId, isSpeaking) => {
      updateSpeakingIndicator(userId, isSpeaking);
    };
    voiceManager.onParticipantsChanged = (participants) => {
      voiceParticipants.clear();
      participants.forEach(p => voiceParticipants.set(p.user_id, p.username));
      renderVoiceParticipants(activeVoiceChannelId);
    };
  } else {
    voiceManager.ws = wsConnection;
    voiceManager.auth = auth;
  }

  const voiceSettings = await ipcRenderer.invoke('get-voice-video-settings').catch(() => null);
  const joined = await voiceManager.joinChannel(channelId, voiceSettings);
  if (!joined) return;

  playVoiceSound('userJoin');
  activeVoiceChannelId = channelId;
  showVoiceControls(channelName);
}

async function leaveVoiceChannel() {
  if (!voiceManager) return;
  await voiceManager.leaveChannel();
  activeVoiceChannelId = null;
  voiceParticipants.clear();
  hideVoiceControls();
  renderVoiceParticipants(null);
  document.querySelectorAll('.voice-avatar.speaking').forEach(el => el.classList.remove('speaking'));
}

function handleVoiceUserJoined(payload) {
  const { channel_id, user_id, username } = payload;
  voiceParticipants.set(user_id, username);
  renderVoiceParticipants(channel_id);
  playVoiceSound('userJoin');
}

function handleVoiceUserLeft(payload) {
  const { channel_id, user_id } = payload;
  voiceParticipants.delete(user_id);
  renderVoiceParticipants(channel_id);
  updateSpeakingIndicator(user_id, false);
  const selfId = voiceManager && voiceManager.auth && voiceManager.auth.user_id;
  if (user_id !== selfId) playVoiceSound('userLeave');
}

function renderVoiceParticipants(channelId) {
  if (!channelId) {
    document.querySelectorAll('.voice-participant-list').forEach(el => { el.innerHTML = ''; });
    return;
  }
  const list = document.querySelector(`.voice-participant-list[data-voice-channel-id="${channelId}"]`);
  if (!list) return;
  list.innerHTML = '';
  voiceParticipants.forEach((username, userId) => {
    const item = document.createElement('div');
    item.className = 'voice-participant';
    item.dataset.userId = userId;

    const avatar = document.createElement('div');
    avatar.className = 'voice-avatar';
    avatar.dataset.userId = userId;
    avatar.textContent = username.charAt(0).toUpperCase();

    const nameEl = document.createElement('span');
    nameEl.className = 'voice-username';
    nameEl.textContent = username;

    item.appendChild(avatar);
    item.appendChild(nameEl);
    list.appendChild(item);
  });
}

function updateSpeakingIndicator(userId, isSpeaking) {
  document.querySelectorAll(`.voice-avatar[data-user-id="${userId}"]`).forEach(el => {
    el.classList.toggle('speaking', isSpeaking);
  });
}

function showVoiceControls(channelName) {
  const panel = document.getElementById('voice-controls');
  if (!panel) return;
  panel.classList.remove('hidden');
  const nameEl = panel.querySelector('.voice-channel-name');
  if (nameEl) nameEl.textContent = '\uD83D\uDD0A ' + channelName;
}

function hideVoiceControls() {
  const panel = document.getElementById('voice-controls');
  if (panel) panel.classList.add('hidden');
}

// Voice control button handlers
document.getElementById('voice-mute-btn')?.addEventListener('click', () => {
  if (!voiceManager) return;
  const muted = voiceManager.toggleMute();
  const btn = document.getElementById('voice-mute-btn');
  btn.classList.toggle('active', muted);
  btn.title = muted ? 'Unmute' : 'Mute';
  btn.textContent = muted ? '\uD83D\uDD07' : '\uD83C\uDFA4';
  playVoiceSound(muted ? 'mute' : 'unmute');
});

document.getElementById('voice-deafen-btn')?.addEventListener('click', () => {
  if (!voiceManager) return;
  const deafened = voiceManager.toggleDeafen();
  const btn = document.getElementById('voice-deafen-btn');
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

// ─── End Voice Channel Functions ──────────────────────────────────────────

// Update initializeApp to connect WebSocket
const originalInitializeApp = initializeApp;
async function initializeAppWithWS() {
  await originalInitializeApp();
  await connectWebSocket();
}
initializeAppWithWS();

// ─── User Settings Modal ──────────────────────────────────────────────────────

const settingsModal = document.getElementById('settings-modal');
const settingsCloseBtn = document.getElementById('settings-close-btn');
const settingsLogoutBtn = document.getElementById('settings-logout-btn');
const settingsNavItems = document.querySelectorAll('.settings-nav-item[data-page]');

function openSettingsModal(page) {
  if (!settingsModal) return;
  settingsModal.classList.remove('hidden');
  switchSettingsPage(page || 'my-account');
  populateSettingsAccount();
}

function closeSettingsModal() {
  if (settingsModal) settingsModal.classList.add('hidden');
}

function switchSettingsPage(page) {
  settingsNavItems.forEach(item => {
    if (item.dataset.page === page) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  document.querySelectorAll('.settings-page').forEach(el => {
    el.classList.add('hidden');
  });

  const target = document.getElementById(`settings-page-${page}`);
  if (target) target.classList.remove('hidden');
}

async function populateSettingsAccount() {
  try {
    const auth = await ipcRenderer.invoke('get-auth');
    if (!auth) return;
    const username = auth.username || '';
    const avatarEl = document.getElementById('settings-avatar-display');
    const usernameDisplay = document.getElementById('settings-username-display');
    const tagDisplay = document.getElementById('settings-user-tag-display');
    const accountUsername = document.getElementById('settings-account-username');
    const displayName = document.getElementById('settings-display-name');
    if (avatarEl) avatarEl.textContent = username.charAt(0).toUpperCase() || 'U';
    if (usernameDisplay) usernameDisplay.textContent = username;
    if (tagDisplay) tagDisplay.textContent = username;
    if (accountUsername) accountUsername.textContent = username;
    if (displayName) displayName.textContent = username;
  } catch (e) {
    console.error('Failed to populate settings account:', e);
  }
}

settingsNavItems.forEach(item => {
  item.addEventListener('click', () => {
    switchSettingsPage(item.dataset.page);
  });
});

if (settingsCloseBtn) {
  settingsCloseBtn.addEventListener('click', closeSettingsModal);
}

if (settingsLogoutBtn) {
  settingsLogoutBtn.addEventListener('click', () => {
    closeSettingsModal();
    if (logoutModal) logoutModal.classList.remove('hidden');
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && settingsModal && !settingsModal.classList.contains('hidden')) {
    closeSettingsModal();
  }
});

// =====================================================
// Voice & Video Settings
// =====================================================

// Sound settings cache — loaded once and refreshed on save
let _vvSounds = null;

async function _loadVVSounds() {
  try {
    const s = await ipcRenderer.invoke('get-voice-video-settings');
    _vvSounds = (s && s.sounds) ? s.sounds : null;
  } catch (e) {
    _vvSounds = null;
  }
}
_loadVVSounds();

function playVoiceSound(type) {
  if (_vvSounds && _vvSounds[type] === false) return;
  if (typeof generateNotificationSound === 'function') generateNotificationSound(type);
}

let _micTestStream = null;
let _micTestAnimFrame = null;
let _cameraPreviewStream = null;
let _pttListening = false;

function _clearSelect(sel) {
  while (sel.options.length > 0) sel.remove(0);
}

function _addOption(sel, value, label) {
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = label;
  sel.appendChild(opt);
}

async function enumerateAudioDevices() {
  const inputSel = document.getElementById('vv-input-device');
  const outputSel = document.getElementById('vv-output-device');
  if (!inputSel || !outputSel) return;

  try {
    const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
    const devices = await navigator.mediaDevices.enumerateDevices();
    if (tempStream) tempStream.getTracks().forEach(t => t.stop());

    _clearSelect(inputSel);
    _clearSelect(outputSel);
    _addOption(inputSel, 'default', 'Default Microphone');
    _addOption(outputSel, 'default', 'Default Speaker');

    devices.forEach(d => {
      const label = d.label || (d.kind + ' (' + d.deviceId.slice(0, 8) + ')');
      if (d.kind === 'audioinput') _addOption(inputSel, d.deviceId, label);
      if (d.kind === 'audiooutput') _addOption(outputSel, d.deviceId, label);
    });
  } catch (e) {
    console.warn('[VV] enumerateAudioDevices failed:', e);
  }
}

async function enumerateCameras() {
  const cameraSel = document.getElementById('vv-camera-device');
  if (!cameraSel) return;

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    _clearSelect(cameraSel);
    _addOption(cameraSel, 'default', 'Default Camera');
    devices.filter(d => d.kind === 'videoinput').forEach(d => {
      const label = d.label || ('Camera (' + d.deviceId.slice(0, 8) + ')');
      _addOption(cameraSel, d.deviceId, label);
    });
  } catch (e) {
    console.warn('[VV] enumerateCameras failed:', e);
  }
}

function startMicTest() {
  const btn = document.getElementById('vv-mic-test-btn');
  const canvas = document.getElementById('mic-visualizer');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  if (_micTestStream) {
    stopMicTest();
    return;
  }

  const inputSel = document.getElementById('vv-input-device');
  const deviceId = inputSel ? inputSel.value : 'default';
  const audioConstraints = deviceId === 'default' ? true : { deviceId: { exact: deviceId } };

  navigator.mediaDevices.getUserMedia({ audio: audioConstraints }).then(stream => {
    _micTestStream = stream;
    if (btn) btn.textContent = 'Stop Test';

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const highlightRgb = getComputedStyle(document.documentElement).getPropertyValue('--rgb-highlight').trim() || '255,80,40';

    const draw = () => {
      if (!_micTestStream) { audioCtx.close(); return; }
      _micTestAnimFrame = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(data);
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const barW = Math.max(2, Math.floor(w / data.length * 2));
      data.forEach((v, i) => {
        const barH = Math.round((v / 255) * h);
        const alpha = (0.4 + (v / 255) * 0.6).toFixed(2);
        ctx.fillStyle = 'rgba(' + highlightRgb + ',' + alpha + ')';
        ctx.fillRect(i * (barW + 1), h - barH, barW, barH);
      });
    };
    draw();
  }).catch(e => {
    console.warn('[VV] Mic test failed:', e);
  });
}

function stopMicTest() {
  const btn = document.getElementById('vv-mic-test-btn');
  const canvas = document.getElementById('mic-visualizer');

  if (_micTestAnimFrame) { cancelAnimationFrame(_micTestAnimFrame); _micTestAnimFrame = null; }
  if (_micTestStream) { _micTestStream.getTracks().forEach(t => t.stop()); _micTestStream = null; }
  if (btn) btn.textContent = 'Test Microphone';
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

function startCameraPreview() {
  const video = document.getElementById('camera-preview');
  const placeholder = document.getElementById('camera-preview-placeholder');
  const btn = document.getElementById('vv-camera-test-btn');
  if (!video) return;

  if (_cameraPreviewStream) {
    stopCameraPreview();
    return;
  }

  const cameraSel = document.getElementById('vv-camera-device');
  const deviceId = cameraSel ? cameraSel.value : 'default';
  const videoConstraints = deviceId === 'default' ? true : { deviceId: { exact: deviceId } };

  navigator.mediaDevices.getUserMedia({ video: videoConstraints }).then(stream => {
    _cameraPreviewStream = stream;
    video.srcObject = stream;
    video.style.display = 'block';
    if (placeholder) placeholder.style.display = 'none';
    if (btn) btn.textContent = 'Stop Preview';
  }).catch(e => {
    console.warn('[VV] Camera preview failed:', e);
  });
}

function stopCameraPreview() {
  const video = document.getElementById('camera-preview');
  const placeholder = document.getElementById('camera-preview-placeholder');
  const btn = document.getElementById('vv-camera-test-btn');

  if (_cameraPreviewStream) { _cameraPreviewStream.getTracks().forEach(t => t.stop()); _cameraPreviewStream = null; }
  if (video) { video.srcObject = null; video.style.display = 'none'; }
  if (placeholder) placeholder.style.display = '';
  if (btn) btn.textContent = 'Test Video';
}

function updatePttKeyRowVisibility(enabled) {
  const row = document.getElementById('vv-ptt-key-row');
  if (row) row.style.display = enabled ? 'flex' : 'none';
}

function updateSensitivityRowVisibility(autoEnabled) {
  const row = document.getElementById('vv-sensitivity-row');
  if (row) row.style.display = autoEnabled ? 'none' : 'flex';
}

function startPttKeyCapture() {
  const btn = document.getElementById('vv-ptt-key-btn');
  if (!btn || _pttListening) return;
  _pttListening = true;
  btn.textContent = 'Press any key...';
  btn.classList.add('listening');

  const onKey = (e) => {
    e.preventDefault();
    e.stopPropagation();
    _pttListening = false;
    btn.classList.remove('listening');
    btn.textContent = e.code;
    btn.dataset.keyCode = e.code;
    document.removeEventListener('keydown', onKey, true);
  };
  document.addEventListener('keydown', onKey, true);
}

async function populateVoiceVideoSettings() {
  try {
    const settings = await ipcRenderer.invoke('get-voice-video-settings');
    if (!settings) return;

    await enumerateAudioDevices();
    await enumerateCameras();

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    const setChecked = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };

    setVal('vv-input-device', settings.inputDevice);
    setVal('vv-output-device', settings.outputDevice);
    setVal('vv-input-volume', settings.inputVolume);
    setVal('vv-output-volume', settings.outputVolume);
    setVal('vv-sensitivity', settings.sensitivityThreshold);

    const ivv = document.getElementById('vv-input-volume-val');
    const ovv = document.getElementById('vv-output-volume-val');
    const svv = document.getElementById('vv-sensitivity-val');
    if (ivv) ivv.textContent = settings.inputVolume + '%';
    if (ovv) ovv.textContent = settings.outputVolume + '%';
    if (svv) svv.textContent = settings.sensitivityThreshold;

    setChecked('vv-echo-cancellation', settings.echoCancellation);
    setChecked('vv-noise-suppression', settings.noiseSuppression);
    setChecked('vv-auto-gain', settings.autoGainControl);
    setChecked('vv-auto-sensitivity', settings.autoSensitivity);
    setChecked('vv-ptt-enabled', settings.pushToTalk);
    setChecked('vv-always-preview', settings.alwaysPreviewVideo);

    const pttBtn = document.getElementById('vv-ptt-key-btn');
    if (pttBtn) { pttBtn.textContent = settings.pttKey; pttBtn.dataset.keyCode = settings.pttKey; }

    updatePttKeyRowVisibility(settings.pushToTalk);
    updateSensitivityRowVisibility(settings.autoSensitivity);

    setVal('vv-camera-device', settings.cameraDevice);

    const sounds = settings.sounds || {};
    ['mute', 'unmute', 'deafen', 'undeafen', 'userJoin', 'userLeave', 'disconnect'].forEach(k => {
      setChecked('vv-sound-' + k, sounds[k] !== false);
    });
  } catch (e) {
    console.error('[VV] populateVoiceVideoSettings failed:', e);
  }
}

async function saveVoiceVideoSettings() {
  const getVal = (id) => { const el = document.getElementById(id); return el ? el.value : null; };
  const getChecked = (id) => { const el = document.getElementById(id); return el ? el.checked : false; };
  const getInt = (id) => { const v = parseInt(getVal(id), 10); return isNaN(v) ? 0 : v; };

  const pttBtn = document.getElementById('vv-ptt-key-btn');

  const settings = {
    inputDevice: getVal('vv-input-device') || 'default',
    outputDevice: getVal('vv-output-device') || 'default',
    inputVolume: getInt('vv-input-volume'),
    outputVolume: getInt('vv-output-volume'),
    echoCancellation: getChecked('vv-echo-cancellation'),
    noiseSuppression: getChecked('vv-noise-suppression'),
    autoGainControl: getChecked('vv-auto-gain'),
    autoSensitivity: getChecked('vv-auto-sensitivity'),
    sensitivityThreshold: getInt('vv-sensitivity'),
    pushToTalk: getChecked('vv-ptt-enabled'),
    pttKey: pttBtn ? (pttBtn.dataset.keyCode || pttBtn.textContent || 'Backquote') : 'Backquote',
    cameraDevice: getVal('vv-camera-device') || 'default',
    alwaysPreviewVideo: getChecked('vv-always-preview'),
    sounds: {
      mute: getChecked('vv-sound-mute'),
      unmute: getChecked('vv-sound-unmute'),
      deafen: getChecked('vv-sound-deafen'),
      undeafen: getChecked('vv-sound-undeafen'),
      userJoin: getChecked('vv-sound-userJoin'),
      userLeave: getChecked('vv-sound-userLeave'),
      disconnect: getChecked('vv-sound-disconnect'),
    },
  };

  try {
    await ipcRenderer.invoke('save-voice-video-settings', settings);
    _vvSounds = settings.sounds;
    if (typeof voiceManager !== 'undefined' && voiceManager) {
      voiceManager.applySettings(settings);
    }
    const statusEl = document.getElementById('vv-save-status');
    if (statusEl) {
      statusEl.textContent = 'Saved!';
      setTimeout(() => { statusEl.textContent = ''; }, 2000);
    }
  } catch (e) {
    console.error('[VV] saveVoiceVideoSettings failed:', e);
  }
}

// Wire up Voice & Video page controls
(function initVoiceVideoControls() {
  const sliderMap = [
    ['vv-input-volume', 'vv-input-volume-val', function(v) { return v + '%'; }],
    ['vv-output-volume', 'vv-output-volume-val', function(v) { return v + '%'; }],
    ['vv-sensitivity', 'vv-sensitivity-val', function(v) { return v; }],
  ];
  sliderMap.forEach(function(entry) {
    const slider = document.getElementById(entry[0]);
    const valEl = document.getElementById(entry[1]);
    const fmt = entry[2];
    if (slider && valEl) {
      slider.addEventListener('input', function() { valEl.textContent = fmt(slider.value); });
    }
  });

  const pttToggle = document.getElementById('vv-ptt-enabled');
  if (pttToggle) {
    pttToggle.addEventListener('change', function() { updatePttKeyRowVisibility(pttToggle.checked); });
  }

  const autoSensToggle = document.getElementById('vv-auto-sensitivity');
  if (autoSensToggle) {
    autoSensToggle.addEventListener('change', function() { updateSensitivityRowVisibility(autoSensToggle.checked); });
  }

  const pttKeyBtn = document.getElementById('vv-ptt-key-btn');
  if (pttKeyBtn) pttKeyBtn.addEventListener('click', startPttKeyCapture);

  const micTestBtn = document.getElementById('vv-mic-test-btn');
  if (micTestBtn) micTestBtn.addEventListener('click', startMicTest);

  const cameraTestBtn = document.getElementById('vv-camera-test-btn');
  if (cameraTestBtn) cameraTestBtn.addEventListener('click', startCameraPreview);

  document.querySelectorAll('.sound-preview-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var type = btn.dataset.sound;
      if (type && typeof generateNotificationSound === 'function') {
        generateNotificationSound(type);
      }
    });
  });

  const saveBtn = document.getElementById('vv-save-btn');
  if (saveBtn) saveBtn.addEventListener('click', saveVoiceVideoSettings);
})();

// Patch switchSettingsPage to load VV settings when navigating to that page
var _origSwitchSettingsPage = switchSettingsPage;
switchSettingsPage = function(page) {
  _origSwitchSettingsPage(page);
  if (page === 'voice-video') {
    stopMicTest();
    stopCameraPreview();
    populateVoiceVideoSettings();
  }
};
