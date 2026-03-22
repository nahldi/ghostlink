/**
 * GhostLink — Launcher Window Renderer
 *
 * Communicates with the Electron main process via the preload bridge
 * (window.api) to manage:
 *   - Server start / stop
 *   - Provider authentication checks & login
 *   - Auto-update lifecycle
 *   - Window controls (minimize / close)
 */

// IPC bridge — nodeIntegration is enabled for wizard/launcher windows
const { ipcRenderer } = require('electron');
const api = {
  invoke: (ch, ...args) => ipcRenderer.invoke(ch, ...args),
  on: (ch, cb) => { ipcRenderer.on(ch, (_e, ...args) => cb(...args)); return () => ipcRenderer.removeAllListeners(ch); },
};
console.log('[launcher] IPC connected');

// ── DOM refs ─────────────────────────────────────────────────────────────────

const $serverDot       = document.getElementById('server-dot');
const $serverStatus    = document.getElementById('server-status-text');
const $btnServer       = document.getElementById('btn-server');
const $portDisplay     = document.getElementById('port-display');
const $providers       = document.getElementById('providers');
const $updateStatus    = document.getElementById('update-status');
const $updateProgress  = document.getElementById('update-progress');
const $progressFill    = document.getElementById('progress-fill');
const $progressText    = document.getElementById('progress-text');
const $btnUpdate       = document.getElementById('btn-update');
const $btnRestart      = document.getElementById('btn-restart');
const $footerStatus    = document.getElementById('footer-status');
const $version         = document.getElementById('version');

// ── State ────────────────────────────────────────────────────────────────────

let serverRunning = false;
let providerStatuses = [];

// ── Titlebar controls ────────────────────────────────────────────────────────

document.getElementById('btn-minimize').addEventListener('click', () => {
  api.invoke('window:minimize');
});

document.getElementById('btn-close').addEventListener('click', () => {
  api.invoke('window:close');
});

// ── Server controls ──────────────────────────────────────────────────────────

$btnServer.addEventListener('click', async () => {
  if (serverRunning) {
    setServerState('stopping');
    const result = await api.invoke('server:stop');
    if (!result || !result.success) {
      setServerState('error');
    }
  } else {
    setServerState('starting');
    const result = await api.invoke('server:start');
    if (!result || !result.success) {
      setServerState('error');
      $footerStatus.textContent = (result && result.error) || 'Server failed to start';
    }
  }
});

/**
 * Update all server-related UI elements to match the given state.
 */
function setServerState(state) {
  switch (state) {
    case 'running':
      serverRunning = true;
      $serverDot.className = 'dot green';
      $serverStatus.textContent = 'Running';
      $serverStatus.className = 'status-label running';
      $btnServer.textContent = 'Stop Server';
      $btnServer.disabled = false;
      $footerStatus.textContent = 'Server running';
      $footerStatus.style.color = '#4ade80';
      break;

    case 'stopped':
      serverRunning = false;
      $serverDot.className = 'dot';
      $serverStatus.textContent = 'Stopped';
      $serverStatus.className = 'status-label';
      $btnServer.textContent = 'Start Server';
      $btnServer.disabled = false;
      $footerStatus.textContent = 'Ready';
      $footerStatus.style.color = '';
      break;

    case 'starting':
      $serverDot.className = 'dot yellow';
      $serverStatus.textContent = 'Starting...';
      $serverStatus.className = 'status-label';
      $btnServer.textContent = 'Starting...';
      $btnServer.disabled = true;
      $footerStatus.textContent = 'Starting server...';
      $footerStatus.style.color = '#facc15';
      break;

    case 'stopping':
      $serverDot.className = 'dot yellow';
      $serverStatus.textContent = 'Stopping...';
      $serverStatus.className = 'status-label';
      $btnServer.textContent = 'Stopping...';
      $btnServer.disabled = true;
      $footerStatus.textContent = 'Stopping server...';
      $footerStatus.style.color = '#facc15';
      break;

    case 'error':
      serverRunning = false;
      $serverDot.className = 'dot red';
      $serverStatus.textContent = 'Error';
      $serverStatus.className = 'status-label';
      $btnServer.textContent = 'Start Server';
      $btnServer.disabled = false;
      $footerStatus.textContent = 'Server error';
      $footerStatus.style.color = '#f87171';
      break;
  }
}

// ── Provider cards ───────────────────────────────────────────────────────────

/**
 * Icon letter abbreviations for each provider (used in the colored circle).
 */
const ICON_LETTERS = {
  anthropic: 'C',
  openai:    'O',
  google:    'G',
  github:    'GH',
};

/**
 * Truncate a string to maxLen characters, adding "..." if truncated.
 */
function truncate(str, maxLen) {
  if (!str) return str;
  return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
}

/**
 * Build or rebuild the provider cards list from an array of AuthStatus objects.
 *
 * Three states per provider:
 *   1. Authenticated → green checkmark + "Connected" badge (no Connect button)
 *   2. Installed but not authenticated → yellow status + "Connect" button
 *   3. CLI not installed → gray status + disabled "Connect" button with tooltip
 */
function renderProviders(statuses) {
  providerStatuses = statuses;
  $providers.innerHTML = '';

  statuses.forEach((s) => {
    const card = document.createElement('div');
    card.className = 'provider-card';
    card.dataset.provider = s.provider;

    // Icon circle with brand color
    const icon = document.createElement('div');
    icon.className = 'provider-icon';
    icon.style.background = s.color;
    icon.textContent = ICON_LETTERS[s.provider] || s.name.charAt(0);

    // Name + status text
    const info = document.createElement('div');
    info.className = 'provider-info';

    const name = document.createElement('div');
    name.className = 'provider-name';
    name.textContent = s.name;

    const notInstalled = !s.installed && !s.authenticated;
    const isConnected = s.authenticated;
    const installedNotAuth = s.installed && !s.authenticated;

    const status = document.createElement('div');
    if (isConnected) {
      status.className = 'provider-status connected';
      status.innerHTML = '<span class="check">&#10003;</span> Connected' +
        (s.user ? ' &middot; ' + escapeHtml(s.user) : '');
    } else if (notInstalled) {
      status.className = 'provider-status not-installed';
      status.textContent = 'Not installed';
      status.style.color = '#888';
    } else {
      status.className = 'provider-status';
      status.textContent = 'Installed — not connected';
      status.style.color = '#facc15';
    }

    // Installed indicator (green check or dash)
    if (s.installed || s.authenticated) {
      const installBadge = document.createElement('div');
      installBadge.style.cssText = 'font-size:9px; color:#4ade80; margin-top:2px;';
      installBadge.innerHTML = '&#10003; CLI installed';
      info.appendChild(name);
      info.appendChild(status);
      info.appendChild(installBadge);
    } else {
      info.appendChild(name);
      info.appendChild(status);
    }

    // Action area — 3 states
    const action = document.createElement('div');
    action.className = 'provider-action';

    if (isConnected) {
      // Green "Connected" badge
      const badge = document.createElement('span');
      badge.className = 'connected-badge';
      badge.textContent = 'Connected';
      action.appendChild(badge);
    } else if (notInstalled) {
      // "Install" button — opens terminal with install command
      const btn = document.createElement('button');
      btn.className = 'connect-btn install-btn';
      btn.textContent = 'Install';
      btn.title = s.installCommand || 'Install the CLI';
      btn.style.background = 'rgba(167, 139, 250, 0.15)';
      btn.style.color = '#a78bfa';
      btn.style.border = '1px solid rgba(167, 139, 250, 0.3)';
      btn.addEventListener('click', async () => {
        btn.textContent = 'Installing...';
        btn.disabled = true;
        await api.invoke('auth:install', s.provider);
        // Re-check after user finishes installing
        setTimeout(() => refreshAuth(), 10000);
      });
      action.appendChild(btn);
    } else {
      // "Connect" button — installed but not authenticated
      const btn = document.createElement('button');
      btn.className = 'connect-btn';
      btn.textContent = 'Connect';
      btn.addEventListener('click', async () => {
        btn.textContent = 'Opening...';
        btn.disabled = true;
        await api.invoke('auth:login', s.provider);
        // Re-check after user completes login
        setTimeout(() => refreshAuth(), 5000);
      });
      action.appendChild(btn);
    }

    card.appendChild(icon);
    card.appendChild(info);
    card.appendChild(action);
    $providers.appendChild(card);
  });
}

/**
 * Request a fresh auth check from main process.
 */
function refreshAuth() {
  api.invoke('auth:check-all');
}

// ── Update UI ────────────────────────────────────────────────────────────────

function setUpdateAvailable(version) {
  $updateStatus.textContent = 'Update available: v' + version;
  $updateStatus.className = '';
  $btnUpdate.style.display = '';
  $btnRestart.style.display = 'none';
  $updateProgress.style.display = 'none';
}

function setUpdateProgress(percent) {
  $updateStatus.textContent = 'Downloading...';
  $btnUpdate.style.display = 'none';
  $updateProgress.style.display = '';
  $progressFill.style.width = percent + '%';
  $progressText.textContent = Math.round(percent) + '%';
}

function setUpdateDownloaded() {
  $updateStatus.textContent = 'Update ready to install';
  $updateProgress.style.display = 'none';
  $btnUpdate.style.display = 'none';
  $btnRestart.style.display = '';
}

function setUpdateUpToDate() {
  $updateStatus.textContent = 'Up to date';
  $updateStatus.className = 'up-to-date';
  $btnUpdate.style.display = 'none';
  $btnRestart.style.display = 'none';
  $updateProgress.style.display = 'none';
}

function setUpdateError(info) {
  const message = (typeof info === 'string') ? info : (info && info.message) || '';
  // If it's a "no releases" type error, show as up-to-date instead
  if (message.includes('no published releases') || message.includes('404') || message.includes('Cannot find')) {
    setUpdateUpToDate();
    return;
  }
  $updateStatus.textContent = 'No updates available';
  $updateStatus.className = '';
  $btnUpdate.style.display = 'none';
  $updateProgress.style.display = 'none';
}

$btnUpdate.addEventListener('click', async () => {
  $btnUpdate.style.display = 'none';
  setUpdateProgress(0);
  await api.invoke('update:download');
});

$btnRestart.addEventListener('click', () => {
  api.invoke('update:install');
});

// ── Event listeners (main → renderer) ────────────────────────────────────────

// Server lifecycle
api.on('server:started', (port) => {
  setServerState('running');
  if (port) $portDisplay.textContent = 'Port: ' + port;
  // Auto-open the chat window after a short delay
  setTimeout(() => {
    api.invoke('app:open-chat');
  }, 2000);
});

api.on('server:stopped', () => {
  setServerState('stopped');
});

api.on('server:error', (errorMsg) => {
  setServerState('error');
  $footerStatus.textContent = errorMsg || 'Server error';
});

// Auth status updates
api.on('auth:status', (statuses) => {
  renderProviders(statuses);
});

// Auto-update lifecycle
api.on('update:available', (info) => {
  setUpdateAvailable(info.version || info);
});

api.on('update:not-available', () => {
  setUpdateUpToDate();
});

api.on('update:progress', (progress) => {
  const percent = typeof progress === 'number' ? progress : (progress.percent || 0);
  setUpdateProgress(percent);
});

api.on('update:downloaded', () => {
  setUpdateDownloaded();
});

api.on('update:error', (err) => {
  setUpdateError(err);
});

// Version info
api.on('app:version', (ver) => {
  $version.textContent = 'v' + ver;
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Settings toggle ──────────────────────────────────────────────────────────

const $settingsToggle = document.getElementById('settings-toggle');
const $settingsBody   = document.getElementById('settings-body');
const $settingsArrow  = document.getElementById('settings-arrow');

if ($settingsToggle && $settingsBody && $settingsArrow) {
  $settingsToggle.addEventListener('click', () => {
    const isOpen = $settingsBody.style.display !== 'none';
    $settingsBody.style.display = isOpen ? 'none' : 'block';
    $settingsArrow.classList.toggle('open', !isOpen);
  });
}

// Settings: folder picker
const $btnPickFolder = document.getElementById('btn-pick-folder');
if ($btnPickFolder) {
  $btnPickFolder.addEventListener('click', () => {
    api.invoke('app:pick-folder');
  });
}
api.on('app:folder-picked', (path) => {
  const $ws = document.getElementById('setting-workspace');
  if ($ws) $ws.value = path;
});

// Settings: save on change
document.querySelectorAll('#settings-body input, #settings-body select').forEach(el => {
  el.addEventListener('change', () => {
    const settings = {
      port: document.getElementById('setting-port')?.value || '8300',
      workspace: document.getElementById('setting-workspace')?.value || '',
      pythonPath: document.getElementById('setting-python')?.value || '',
      platform: document.getElementById('setting-platform')?.value || 'auto',
      theme: document.getElementById('setting-theme')?.value || 'dark',
      autoStart: document.getElementById('setting-autostart')?.checked || false,
      updateChannel: document.getElementById('setting-update-channel')?.value || 'stable',
    };
    api.invoke('app:save-settings', settings);
  });
});

// ── Init ─────────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', async () => {
  // Request initial state from main process
  const status = await api.invoke('server:status');
  if (status && status.running) {
    setServerState('running');
    $portDisplay.textContent = 'Port: ' + status.port;
  }

  // Fetch auth statuses
  api.invoke('auth:check-all');

  // Fetch version
  const ver = await api.invoke('app:get-version');
  if (ver) $version.textContent = 'v' + ver;

  // Check for updates
  api.invoke('update:check');
});
