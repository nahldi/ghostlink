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

// Try preload bridge first, fall back to direct ipcRenderer (nodeIntegration)
let api = window.api;
if (!api) {
  try {
    const { ipcRenderer } = require('electron');
    api = {
      invoke: (...args) => ipcRenderer.invoke(...args),
      on: (channel, cb) => { ipcRenderer.on(channel, (_e, ...a) => cb(...a)); return () => ipcRenderer.removeAllListeners(channel); },
    };
  } catch {
    document.addEventListener('DOMContentLoaded', () => {
      const errDiv = document.createElement('div');
      errDiv.style.cssText = 'padding:40px;text-align:center;color:#f87171;font-family:sans-serif';
      const h2 = document.createElement('h2');
      h2.textContent = 'Launcher Error';
      const p = document.createElement('p');
      p.textContent = 'Could not initialize GhostLink bridge. Please reinstall.';
      errDiv.appendChild(h2);
      errDiv.appendChild(p);
      document.body.appendChild(errDiv);
    });
  }
}
// IPC ready

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

function renderConnectionsLoadingState() {
  while ($providers.firstChild) $providers.removeChild($providers.firstChild);

  const loadingDiv = document.createElement('div');
  loadingDiv.style.cssText = 'padding:16px;text-align:center;line-height:1.5';

  const title = document.createElement('div');
  title.style.cssText = 'font-weight:600;margin-bottom:4px;color:rgba(255,255,255,0.5);font-size:11px';
  title.textContent = 'Checking connections\u2026';

  const desc = document.createElement('div');
  desc.style.cssText = 'color:rgba(255,255,255,0.3);font-size:10px';
  desc.textContent = 'Detecting installed agent CLIs and auth status.';

  loadingDiv.appendChild(title);
  loadingDiv.appendChild(desc);
  $providers.appendChild(loadingDiv);
}

function renderConnectionsEmptyState() {
  const emptyState = document.createElement('div');
  emptyState.className = 'providers-empty-state';
  emptyState.style.cssText = 'padding:16px;text-align:center;line-height:1.5';

  const title = document.createElement('div');
  title.style.cssText = 'font-weight:600;margin-bottom:4px;color:rgba(255,255,255,0.5);font-size:11px';
  title.textContent = 'No agents detected';

  const desc = document.createElement('div');
  desc.style.cssText = 'color:rgba(255,255,255,0.35);font-size:11px';
  desc.textContent = 'Expand "Supported Agents" below to install CLIs.';

  const hint = document.createElement('div');
  hint.style.cssText = 'margin-top:4px;font-size:9px;color:rgba(255,255,255,0.2)';
  hint.textContent = 'Connected agents will appear here automatically.';

  emptyState.appendChild(title);
  emptyState.appendChild(desc);
  emptyState.appendChild(hint);
  $providers.appendChild(emptyState);
}

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
 * Canonical pricing taxonomy per agent.
 * Used in launcher badges so users know what's free vs paid.
 */
const PRICING_MAP = {
  anthropic: { label: 'Paid', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  openai:    { label: 'Paid', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  grok:      { label: 'Paid', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  github:    { label: 'Paid', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  cursor:    { label: 'Paid', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  google:    { label: 'Free Tier', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  cody:      { label: 'Free Tier', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  pi:        { label: 'Free Tier', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  ollama:    { label: 'Local', color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
  aider:     { label: 'Free + Setup', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  goose:     { label: 'Free + Setup', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  opencode:  { label: 'Free + Setup', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  continue:  { label: 'Free + Setup', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
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
  while ($providers.firstChild) $providers.removeChild($providers.firstChild);

  // Show ALL agents in Connections with real status — no hiding
  const connected = statuses.filter(s => s.authenticated || s.installed);
  const notInstalled = statuses.filter(s => !s.authenticated && !s.installed);

  // If detection returned nothing, show explicit message
  if (statuses.length === 0) {
    renderConnectionsEmptyState();
    return;
  }

  // Populate Supported Agents section with not-installed ones
  const $agentsBody = document.getElementById('agents-body');
  if ($agentsBody) {
    while ($agentsBody.firstChild) $agentsBody.removeChild($agentsBody.firstChild);
    notInstalled.forEach(s => {
      const row = document.createElement('div');
      row.className = 'agent-row';
      const dot = document.createElement('span');
      dot.className = 'agent-dot';
      dot.style.background = s.color;
      const nameEl = document.createElement('span');
      nameEl.className = 'agent-name';
      nameEl.textContent = s.name;
      const provEl = document.createElement('span');
      provEl.className = 'agent-provider';
      provEl.textContent = 'Not installed';
      const btn = document.createElement('button');
      btn.className = 'connect-btn install-btn';
      btn.textContent = 'Install';
      btn.title = s.installCommand || 'Install the CLI';
      btn.style.cssText = 'background:rgba(167,139,250,0.15);color:#a78bfa;border:1px solid rgba(167,139,250,0.3);font-size:10px;padding:3px 10px';
      btn.addEventListener('click', async () => {
        btn.textContent = '...';
        btn.disabled = true;
        await api.invoke('auth:install', s.provider);
        setTimeout(() => refreshAuth(), 10000);
      });
      row.appendChild(dot);
      row.appendChild(nameEl);
      row.appendChild(provEl);
      row.appendChild(btn);
      $agentsBody.appendChild(row);
    });
    if (notInstalled.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'agents-hint';
      hint.textContent = 'All supported agents are installed!';
      $agentsBody.appendChild(hint);
    }
  }

  // Show ALL agents — connected ones first, then not-installed with Install buttons
  // Never show empty connections when we have statuses
  const allToShow = connected.length > 0 ? connected : statuses;

  allToShow.forEach((s) => {
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

    // Pricing badge
    const pricing = PRICING_MAP[s.provider] || PRICING_MAP[s.command];
    if (pricing) {
      const badge = document.createElement('span');
      badge.textContent = pricing.label;
      badge.style.cssText = 'font-size:8px;padding:1px 5px;border-radius:4px;margin-left:6px;font-weight:600;vertical-align:middle;color:' + pricing.color + ';background:' + pricing.bg;
      name.appendChild(badge);
    }

    const notInstalled = !s.installed && !s.authenticated;
    const isConnected = s.authenticated;
    const needsReauth = s.error && s.error.includes('re-auth');
    const installedNotAuth = s.installed && !s.authenticated;

    const status = document.createElement('div');
    if (isConnected) {
      status.className = 'provider-status connected';
      const check = document.createElement('span');
      check.className = 'check';
      check.textContent = '\u2713';
      status.appendChild(check);
      status.appendChild(document.createTextNode(' Connected'));
      if (s.user) {
        status.appendChild(document.createTextNode(' \u00b7 ' + s.user));
      }
    } else if (needsReauth) {
      status.className = 'provider-status';
      status.textContent = 'Needs re-authentication';
      status.style.color = '#f59e0b';
    } else if (notInstalled) {
      status.className = 'provider-status not-installed';
      status.textContent = 'Not installed';
      status.style.color = '#888';
    } else if (installedNotAuth) {
      status.className = 'provider-status';
      status.textContent = 'Installed \u2014 not connected';
      status.style.color = '#facc15';
    } else {
      status.className = 'provider-status not-installed';
      status.textContent = 'Not installed';
      status.style.color = '#888';
    }

    info.appendChild(name);
    info.appendChild(status);

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
  $updateStatus.textContent = message ? ('Update error: ' + message) : 'Update check failed';
  $updateStatus.className = 'error';
  $btnUpdate.style.display = 'none';
  $btnRestart.style.display = 'none';
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
  // Sync auth results to backend after server is fully ready (short delay for port binding)
  setTimeout(() => {
    if (providerStatuses.length > 0) syncConnectedToBackend(providerStatuses);
  }, 1500);
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
  // Sync connected agents to backend so the agent launcher can see them
  syncConnectedToBackend(statuses);
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

/**
 * POST connected agent base names to the backend settings so the
 * chat window's agent launcher can mark them as available.
 */
function syncConnectedToBackend(statuses) {
  if (!serverRunning) return;
  const providerToBase = { anthropic: 'claude', openai: 'codex', google: 'gemini', github: 'copilot' };
  const connected = statuses
    .filter(s => s.authenticated || s.installed)
    .map(s => providerToBase[s.provider] || s.provider)
    .filter(Boolean);
  if (connected.length === 0) return;
  const port = document.getElementById('setting-port')?.value || '8300';
  fetch(`http://127.0.0.1:${port}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectedAgents: connected }),
  }).catch((e) => console.warn('Connected agents sync:', e.message || e));
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function applySavedSettings(settings) {
  if (!settings || typeof settings !== 'object') return;

  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (!el || value == null) return;
    el.value = String(value);
  };

  const setChecked = (id, value) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = Boolean(value);
  };

  setValue('setting-port', settings.port);
  setValue('setting-workspace', settings.workspace);
  setValue('setting-python', settings.pythonPath);
  setValue('setting-platform', settings.platform);
  setValue('setting-theme', settings.theme);
  setValue('setting-update-channel', settings.updateChannel);
  setChecked('setting-autostart', settings.autoStart);
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
  renderConnectionsLoadingState();

  // Fetch version immediately — don't wait for slow auth checks
  api.invoke('app:get-version').then((ver) => {
    $version.textContent = ver ? ('v' + ver) : 'v?';
  }).catch(() => { $version.textContent = 'v?'; });

  // Server status — quick check
  api.invoke('server:status').then((status) => {
    if (status && status.running) {
      setServerState('running');
      $portDisplay.textContent = 'Port: ' + status.port;
    }
  }).catch((e) => console.warn('Server status fetch failed:', e));

  // Load saved launcher settings without waiting on auth/update checks
  api.invoke('app:get-settings').then((settings) => {
    applySavedSettings(settings);
  }).catch((e) => console.warn('Settings fetch failed:', e));

  // Auth checks — can be slow, don't block other UI
  api.invoke('auth:check-all').then((statuses) => {
    if (Array.isArray(statuses) && statuses.length > 0) {
      renderProviders(statuses);
    } else {
      renderProviders([]);
    }
  }).catch((e) => {
    console.warn('Auth status fetch failed:', e);
    renderProviders([]);
  });

  // Update check — fire and forget
  api.invoke('update:check').catch((e) => {
    console.warn('Update check failed:', e);
    setUpdateError(e);
  });
});

// ── Agents toggle ─────────────────────────────────────────────────────────

const $agentsToggle = document.getElementById('agents-toggle');
const $agentsBody = document.getElementById('agents-body');
const $agentsArrow = document.getElementById('agents-arrow');

if ($agentsToggle && $agentsBody && $agentsArrow) {
  $agentsToggle.addEventListener('click', () => {
    const isOpen = $agentsBody.style.display !== 'none';
    $agentsBody.style.display = isOpen ? 'none' : 'block';
    $agentsArrow.classList.toggle('open', !isOpen);
  });
}

// ── Manual check for updates ──────────────────────────────────────────────

const $btnCheckUpdate = document.getElementById('btn-check-update');
if ($btnCheckUpdate) {
  $btnCheckUpdate.addEventListener('click', async () => {
    $btnCheckUpdate.classList.add('spinning');
    $updateStatus.textContent = 'Checking...';
    $updateStatus.className = '';
    try {
      await api.invoke('update:check');
    } catch {}
    setTimeout(() => $btnCheckUpdate.classList.remove('spinning'), 1000);
  });
}
