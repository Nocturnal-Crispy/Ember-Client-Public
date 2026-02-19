const { ipcRenderer } = require('electron');
const messageInput = document.getElementById('messageInput');
const messagesContainer = document.getElementById('messages');

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

// Message Input
messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && messageInput.value.trim()) {
    addMessage('User', messageInput.value);
    messageInput.value = '';
  }
});

function addMessage(author, text) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message';
  
  const now = new Date();
  const timeString = now.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit',
    hour12: true 
  });
  
  messageDiv.innerHTML = `
    <div class="message-avatar">${author.charAt(0).toUpperCase()}</div>
    <div class="message-content">
      <div class="message-header">
        <span class="message-author">${author}</span>
        <span class="message-timestamp">Today at ${timeString}</span>
      </div>
      <div class="message-text">${escapeHtml(text)}</div>
    </div>
  `;
  
  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

console.log('Ember app initialized!');
