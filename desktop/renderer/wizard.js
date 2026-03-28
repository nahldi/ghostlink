/**
 * GhostLink — Setup Wizard Renderer
 */

const api = window.api;
if (!api) {
  throw new Error('GhostLink preload bridge is unavailable in setup wizard');
}
// IPC ready

// ── State ────────────────────────────────────────────────────────────────────

let currentStep = 0;
const totalSteps = 6; // 0-5

const settings = {
  platform: 'windows',
  shell: 'powershell',
  pythonPath: '',
  pythonVersion: '',
  workspace: '',
  port: 8300,
  theme: 'dark',
  autoStart: false,
  setupComplete: true,
};

let wslAvailable = false;
let pythonOk = false;

// ── DOM refs ─────────────────────────────────────────────────────────────────

const $screens = document.querySelectorAll('.wizard-screen');
const $dots = document.querySelectorAll('.step-dot');

// ── Titlebar controls ────────────────────────────────────────────────────────

document.getElementById('btn-minimize')?.addEventListener('click', () => {
  api.invoke('window:minimize');
});

document.getElementById('btn-close')?.addEventListener('click', () => {
  api.invoke('window:close');
});

// ── Navigation ───────────────────────────────────────────────────────────────

function goToStep(step) {
  if (step < 0 || step >= totalSteps) return;

  // If stepping to shell screen (2) but not on Windows, skip it
  if (step === 2 && settings.platform !== 'windows' && settings.platform !== 'wsl') {
    step = currentStep < step ? 3 : 1; // skip forward or backward
  }

  const prevStep = currentStep;
  currentStep = step;

  // Update screens
  $screens.forEach((screen, i) => {
    screen.classList.remove('active', 'exit-left');
    if (i === currentStep) {
      screen.classList.add('active');
    } else if (i === prevStep) {
      screen.classList.add('exit-left');
    }
  });

  // Update dots
  $dots.forEach((dot, i) => {
    dot.classList.remove('active', 'completed');
    if (i === currentStep) {
      dot.classList.add('active');
    } else if (i < currentStep) {
      dot.classList.add('completed');
    }
  });

  // Trigger screen-specific actions
  if (currentStep === 3) {
    runPythonCheck();
  }
  if (currentStep === 5) {
    renderSummary();
  }
}

function nextStep() {
  goToStep(currentStep + 1);
}

function prevStep() {
  goToStep(currentStep - 1);
}

// ── Back buttons ─────────────────────────────────────────────────────────────

document.querySelectorAll('.btn-back').forEach(btn => {
  btn.addEventListener('click', prevStep);
});

// ── Screen 0: Welcome ────────────────────────────────────────────────────────

document.getElementById('btn-welcome-next')?.addEventListener('click', () => {
  nextStep();
  // Detect platform async (don't block navigation)
  detectPlatform().catch(err => console.warn('Platform detect error:', err));
});

// ── Screen 1: Platform Selection ─────────────────────────────────────────────

async function detectPlatform() {
  try {
    const result = await api.invoke('wizard:detect-platform');
    if (result && result.platform) {
      // Pre-select the detected platform
      const radio = document.querySelector(`input[name="platform"][value="${result.platform}"]`);
      if (radio) {
        radio.checked = true;
        radio.closest('.radio-card').classList.add('selected');
        settings.platform = result.platform;
      }

      wslAvailable = result.wslAvailable || false;

      const $msg = document.getElementById('platform-detect-msg');
      let msgText = 'Auto-detected: ' + result.platformLabel;
      if (result.wslAvailable) {
        msgText += ' (WSL available)';
      }
      $msg.textContent = msgText;
      $msg.classList.add('visible');
    }
  } catch (err) {
    console.warn('Platform detection failed:', err);
  }
}

// Radio card selection styling
document.querySelectorAll('#platform-radios .radio-card').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('#platform-radios .radio-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    const radio = card.querySelector('input[type="radio"]');
    radio.checked = true;
    settings.platform = radio.value;
  });
});

document.getElementById('btn-platform-next')?.addEventListener('click', () => {
  if (!settings.platform) return;

  // If WSL selected, default shell to ubuntu
  if (settings.platform === 'wsl') {
    settings.shell = 'ubuntu';
    const radio = document.querySelector('input[name="shell"][value="ubuntu"]');
    if (radio) {
      radio.checked = true;
      radio.closest('.radio-card').classList.add('selected');
    }
  } else if (settings.platform === 'windows') {
    settings.shell = 'powershell';
    const radio = document.querySelector('input[name="shell"][value="powershell"]');
    if (radio) {
      radio.checked = true;
      radio.closest('.radio-card').classList.add('selected');
    }
  } else {
    // macOS / Linux — shell is terminal, skip shell screen
    settings.shell = 'terminal';
  }

  nextStep();
});

// ── Screen 2: Shell Selection ────────────────────────────────────────────────

document.querySelectorAll('#shell-radios .radio-card').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('#shell-radios .radio-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    const radio = card.querySelector('input[type="radio"]');
    radio.checked = true;
    settings.shell = radio.value;
  });
});

document.getElementById('btn-shell-next')?.addEventListener('click', () => {
  nextStep();
});

// ── Screen 3: Python Check ───────────────────────────────────────────────────

const $pythonStatus = document.getElementById('python-status');
const $pythonVersion = document.getElementById('python-version');
const $depsStatus = document.getElementById('deps-status');
const $depsProgress = document.getElementById('deps-progress');
const $depsProgressFill = document.getElementById('deps-progress-fill');
const $depsProgressText = document.getElementById('deps-progress-text');
const $btnPythonNext = document.getElementById('btn-python-next');

async function runPythonCheck() {
  // Reset UI
  $pythonStatus.innerHTML = '<span class="spinner"></span><span>Detecting Python...</span>';
  $pythonStatus.className = 'check-status';
  $pythonStatus.style.display = '';
  $pythonVersion.style.display = 'none';
  $depsStatus.style.display = 'none';
  $depsProgress.style.display = 'none';
  $btnPythonNext.disabled = true;
  pythonOk = false;

  try {
    const result = await api.invoke('wizard:detect-python', settings.platform);

    if (result && result.found) {
      settings.pythonPath = result.pythonPath || 'python';
      settings.pythonVersion = result.version || '';

      $pythonStatus.innerHTML = '<span style="color:#4ade80;font-size:16px;">&#10003;</span><span>Python ' + escapeHtml(result.version) + ' found</span>';
      $pythonStatus.className = 'check-status success';

      if (result.pythonPath) {
        $pythonVersion.textContent = result.pythonPath;
        $pythonVersion.style.display = '';
      }

      // Check dependencies
      if (result.depsInstalled) {
        $depsStatus.innerHTML = '<span style="color:#4ade80;font-size:16px;">&#10003;</span><span>Dependencies installed</span>';
        $depsStatus.className = 'check-status success';
        $depsStatus.style.display = '';
        pythonOk = true;
        $btnPythonNext.disabled = false;
      } else {
        // Need to install deps
        $depsStatus.innerHTML = '<span class="spinner"></span><span>Installing dependencies...</span>';
        $depsStatus.className = 'check-status';
        $depsStatus.style.display = '';
        $depsProgress.style.display = '';

        const installResult = await api.invoke('wizard:install-deps');
        if (installResult && installResult.success) {
          $depsStatus.innerHTML = '<span style="color:#4ade80;font-size:16px;">&#10003;</span><span>Dependencies installed</span>';
          $depsStatus.className = 'check-status success';
          $depsProgress.style.display = 'none';
          pythonOk = true;
          $btnPythonNext.disabled = false;
        } else {
          $depsStatus.innerHTML = '<span style="color:#f87171;font-size:16px;">&#10007;</span><span>Failed to install dependencies</span>';
          $depsStatus.className = 'check-status error';
          $depsProgress.style.display = 'none';
          // Still allow proceeding — user can fix deps later
          pythonOk = true;
          $btnPythonNext.disabled = false;
        }
      }
    } else {
      $pythonStatus.textContent = '\u2717 Python not found \u2014 Install Python 3.10+ to continue';
      $pythonStatus.className = 'check-status error';
      pythonOk = false;
      $btnPythonNext.disabled = true;
    }
  } catch (err) {
    console.error('Python check failed:', err);
    $pythonStatus.textContent = '\u2717 Detection failed \u2014 Install Python 3.10+ and retry';
    $pythonStatus.className = 'check-status error';
    $btnPythonNext.disabled = true;
  }
}

// Listen for install progress updates
api.on('wizard:deps-progress', (percent) => {
  $depsProgressFill.style.width = percent + '%';
  $depsProgressText.textContent = Math.round(percent) + '%';
});

document.getElementById('btn-python-next')?.addEventListener('click', () => {
  nextStep();
});

// ── Screen 4: Default Workspace ──────────────────────────────────────────────

const $workspacePath = document.getElementById('workspace-path');

document.getElementById('btn-browse')?.addEventListener('click', async () => {
  const folder = await api.invoke('wizard:pick-folder');
  if (folder) {
    $workspacePath.value = folder;
    settings.workspace = folder;
  }
});

$workspacePath?.addEventListener('input', () => {
  settings.workspace = $workspacePath.value;
});

// Listen for folder picked event
api.on('wizard:folder-picked', (path) => {
  $workspacePath.value = path;
  settings.workspace = path;
});

document.getElementById('btn-workspace-next')?.addEventListener('click', () => {
  settings.workspace = $workspacePath.value;
  nextStep();
});

// ── Screen 5: Done ───────────────────────────────────────────────────────────

function renderSummary() {
  const $summary = document.getElementById('settings-summary');

  const platformLabels = {
    windows: 'Windows (Native)',
    wsl: 'Windows (WSL)',
    macos: 'macOS',
    linux: 'Linux',
  };

  const shellLabels = {
    ubuntu: 'Ubuntu (WSL)',
    powershell: 'PowerShell',
    cmd: 'Command Prompt',
    terminal: 'Terminal',
  };

  const rows = [
    ['Platform', platformLabels[settings.platform] || settings.platform],
    ['Shell', shellLabels[settings.shell] || settings.shell],
    ['Python', settings.pythonVersion || settings.pythonPath || 'Not detected'],
    ['Workspace', settings.workspace || 'Not set'],
    ['Port', String(settings.port)],
  ];

  $summary.innerHTML = rows.map(([label, value]) =>
    '<div class="summary-row"><span class="summary-label">' + escapeHtml(label) +
    '</span><span class="summary-value">' + escapeHtml(value) + '</span></div>'
  ).join('');
}

document.getElementById('btn-finish')?.addEventListener('click', async () => {
  const $btn = document.getElementById('btn-finish');
  $btn.textContent = 'Starting...';
  $btn.disabled = true;

  try {
    await api.invoke('wizard:complete', settings);
  } catch (err) {
    console.error('Failed to complete wizard:', err);
    $btn.textContent = 'Start GhostLink';
    $btn.disabled = false;
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Init ─────────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  goToStep(0);
});
