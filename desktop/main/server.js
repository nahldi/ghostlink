"use strict";
/**
 * ServerManager — Manages the Python FastAPI backend process.
 *
 * Handles finding the correct Python interpreter, resolving the backend
 * directory for both dev and packaged environments, spawning the process,
 * health-checking until the server is ready, and graceful shutdown.
 *
 * When the user's platform setting is "wsl", all Python commands run
 * inside WSL and paths are translated from Windows to WSL format.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.serverManager = void 0;
const child_process_1 = require("child_process");
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const http_1 = __importDefault(require("http"));
const electron_log_1 = __importDefault(require("electron-log"));
const os_1 = __importDefault(require("os"));
// ── Platform helpers ─────────────────────────────────────────────────────────
function getSettings() {
    try {
        const settingsPath = path_1.default.join(os_1.default.homedir(), '.ghostlink', 'settings.json');
        if (!fs_1.default.existsSync(settingsPath))
            return null;
        return JSON.parse(fs_1.default.readFileSync(settingsPath, 'utf-8'));
    }
    catch {
        return null;
    }
}
function isWsl() {
    const settings = getSettings();
    return settings?.platform === 'wsl';
}
/**
 * Convert a Windows path like C:\Users\foo\bar to WSL path /mnt/c/Users/foo/bar.
 */
function winToWsl(windowsPath) {
    let p = windowsPath.replace(/\\/g, '/');
    const driveMatch = p.match(/^([A-Za-z]):\//);
    if (driveMatch) {
        p = `/mnt/${driveMatch[1].toLowerCase()}/${p.slice(3)}`;
    }
    return p;
}
class ServerManager {
    process = null;
    port = 8300;
    onServerExit = null;
    // ---------- public API ----------
    /**
     * Start the backend server.
     * Resolves the Python path and backend directory, spawns `python app.py`,
     * then polls the health endpoint until it responds (up to 30 s).
     */
    async start() {
        if (this.process) {
            electron_log_1.default.info('Server already running (pid %d)', this.process.pid);
            return { success: true, port: this.port };
        }
        // Kill ALL stale GhostLink processes and free ports
        try {
            if (isWsl()) {
                // Kill by port AND by process name — covers all cases
                const killCmd = [
                    // Kill by port (multiple methods for compatibility)
                    `lsof -ti:${this.port} | xargs -r kill -9`,
                    `lsof -ti:8200 | xargs -r kill -9`,
                    `lsof -ti:8201 | xargs -r kill -9`,
                    `fuser -k ${this.port}/tcp`,
                    `fuser -k 8200/tcp`,
                    `fuser -k 8201/tcp`,
                    // Kill by process name — catches orphaned Python servers
                    `pkill -9 -f 'python.*app\\.py'`,
                    `pkill -9 -f 'uvicorn'`,
                ].join('; ');
                (0, child_process_1.execSync)(`wsl bash -c "${killCmd}" 2>/dev/null`, { stdio: 'ignore', timeout: 8_000 });
            }
            else {
                (0, child_process_1.execSync)(`kill $(lsof -ti:${this.port}) 2>/dev/null; kill $(lsof -ti:8200) 2>/dev/null; kill $(lsof -ti:8201) 2>/dev/null; pkill -9 -f 'python.*app.py' 2>/dev/null`, { stdio: 'ignore', timeout: 5_000 });
            }
            // Wait for OS to fully release the ports
            await new Promise(r => setTimeout(r, 2000));
            electron_log_1.default.info('Cleared stale processes on ports %d, 8200, 8201', this.port);
        }
        catch { /* no stale processes — normal */ }
        const useWsl = isWsl();
        const backendPath = this.getBackendPath();
        if (useWsl) {
            return this.startViaWsl(backendPath);
        }
        // ---- Native path ----
        const pythonPath = this.getPythonPath();
        if (!pythonPath) {
            const msg = 'Could not find a Python interpreter. Please install Python 3.10+.';
            electron_log_1.default.error(msg);
            return { success: false, error: msg };
        }
        if (!fs_1.default.existsSync(backendPath)) {
            const msg = `Backend directory not found: ${backendPath}`;
            electron_log_1.default.error(msg);
            return { success: false, error: msg };
        }
        // Ensure Python deps are installed (first-run auto-install)
        try {
            (0, child_process_1.execSync)(`${pythonPath} -c "import fastapi"`, { stdio: 'ignore', timeout: 5000 });
        }
        catch {
            electron_log_1.default.info('Python deps not installed — running pip install...');
            const reqFile = path_1.default.join(backendPath, 'requirements.txt');
            if (fs_1.default.existsSync(reqFile)) {
                try {
                    (0, child_process_1.execSync)(`${pythonPath} -m pip install -r "${reqFile}"`, { stdio: 'pipe', timeout: 120000 });
                    electron_log_1.default.info('Python deps installed successfully');
                }
                catch (pipErr) {
                    electron_log_1.default.error('pip install failed:', pipErr.message);
                    return { success: false, error: 'Failed to install Python dependencies. Run: pip install -r requirements.txt' };
                }
            }
        }
        electron_log_1.default.info('Starting backend — python=%s  cwd=%s  port=%d', pythonPath, backendPath, this.port);
        try {
            this.process = (0, child_process_1.spawn)(pythonPath, ['app.py'], {
                cwd: backendPath,
                env: {
                    ...process.env,
                    PORT: String(this.port),
                    PYTHONUNBUFFERED: '1',
                },
                stdio: ['ignore', 'pipe', 'pipe'],
                detached: process.platform !== 'win32',
            });
            this.attachProcessHandlers();
            await this.waitForReady();
            electron_log_1.default.info('Backend server is ready on port %d', this.port);
            return { success: true, port: this.port };
        }
        catch (err) {
            electron_log_1.default.error('Failed to start backend:', err);
            await this.stop();
            return { success: false, error: err.message ?? String(err) };
        }
    }
    /**
     * Start the backend through WSL.
     * Spawns: wsl bash -c "cd <wslPath> && source ../.venv/bin/activate && python app.py"
     */
    async startViaWsl(backendPath) {
        let wslBackend = winToWsl(backendPath);
        // Check Python is available in WSL
        try {
            (0, child_process_1.execSync)('wsl bash -lc "python3 --version"', { stdio: 'pipe', timeout: 10_000 });
        }
        catch {
            return { success: false, error: 'Python3 not found in WSL. Install Python 3.10+ in your WSL distro.' };
        }
        // OneDrive / cloud paths often aren't fully accessible from WSL
        // Test by actually trying to read a file, not just checking if dir exists
        let pathAccessible = false;
        try {
            const result = (0, child_process_1.execSync)(`wsl bash -c "cat '${wslBackend}/app.py' > /dev/null 2>&1 && echo ok"`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10_000 }).trim();
            pathAccessible = result.includes('ok');
        }
        catch { }
        // Also check if the path contains OneDrive — these are always problematic
        if (wslBackend.toLowerCase().includes('onedrive')) {
            electron_log_1.default.info('OneDrive path detected — will copy to /tmp/ for WSL compatibility');
            pathAccessible = false;
        }
        if (!pathAccessible) {
            electron_log_1.default.info('Backend path not accessible from WSL (%s) — copying to /tmp/ghostlink-backend/', wslBackend);
            try {
                // Clean up stale temp files from previous runs before copying
                (0, child_process_1.execSync)('wsl bash -c "rm -rf /tmp/ghostlink-backend /tmp/ghostlink-frontend"', { stdio: 'pipe', timeout: 5_000 });
                // Create dir and copy files using wsl
                (0, child_process_1.execSync)('wsl bash -c "mkdir -p /tmp/ghostlink-backend"', { stdio: 'pipe', timeout: 5_000 });
                // Copy Python files and subdirectories (plugins/) via wsl
                // Note: execSync with wsl is required here — paths are pre-validated, no user input
                const copyDir = (srcDir, wslDest) => {
                    for (const entry of fs_1.default.readdirSync(srcDir, { withFileTypes: true })) {
                        if (entry.name.startsWith('__pycache__') || entry.name === 'data' || entry.name === 'uploads' || entry.name === '.venv')
                            continue;
                        const srcPath = path_1.default.join(srcDir, entry.name);
                        if (entry.isDirectory()) {
                            (0, child_process_1.execSync)(`wsl bash -c "mkdir -p '${wslDest}/${entry.name}'"`, { stdio: 'pipe', timeout: 5_000 });
                            copyDir(srcPath, `${wslDest}/${entry.name}`);
                        }
                        else if (/\.(py|txt|toml|json)$/.test(entry.name)) {
                            const content = fs_1.default.readFileSync(srcPath, 'utf-8');
                            (0, child_process_1.execSync)(`wsl bash -c "cat > '${wslDest}/${entry.name}'"`, {
                                input: content,
                                stdio: ['pipe', 'pipe', 'pipe'],
                                timeout: 5_000,
                            });
                        }
                    }
                };
                copyDir(backendPath, '/tmp/ghostlink-backend');
                // Copy frontend dist — check both packaged layout (frontend/) and dev layout (frontend/dist/)
                let frontendSrc = path_1.default.resolve(backendPath, '..', 'frontend', 'dist');
                if (!fs_1.default.existsSync(frontendSrc) || !fs_1.default.existsSync(path_1.default.join(frontendSrc, 'index.html'))) {
                    // Packaged app: electron-builder copies dist contents directly to frontend/
                    frontendSrc = path_1.default.resolve(backendPath, '..', 'frontend');
                }
                if (fs_1.default.existsSync(frontendSrc) && fs_1.default.existsSync(path_1.default.join(frontendSrc, 'index.html'))) {
                    electron_log_1.default.info('Copying frontend from %s to /tmp/ghostlink-frontend/', frontendSrc);
                    (0, child_process_1.execSync)('wsl bash -c "rm -rf /tmp/ghostlink-frontend && mkdir -p /tmp/ghostlink-frontend"', { stdio: 'pipe', timeout: 5_000 });
                    const copyFrontend = (dir, wslDir) => {
                        for (const entry of fs_1.default.readdirSync(dir, { withFileTypes: true })) {
                            const fullPath = path_1.default.join(dir, entry.name);
                            const wslPath = `${wslDir}/${entry.name}`;
                            if (entry.isDirectory()) {
                                (0, child_process_1.execSync)(`wsl bash -c "mkdir -p '${wslPath}'"`, { stdio: 'pipe', timeout: 5_000 });
                                copyFrontend(fullPath, wslPath);
                            }
                            else {
                                const buf = fs_1.default.readFileSync(fullPath);
                                (0, child_process_1.execSync)(`wsl bash -c "cat > '${wslPath}'"`, {
                                    input: buf,
                                    stdio: ['pipe', 'pipe', 'pipe'],
                                    timeout: 10_000,
                                });
                            }
                        }
                    };
                    copyFrontend(frontendSrc, '/tmp/ghostlink-frontend');
                    // Update config to point to the copied frontend (not in a /dist subfolder)
                    (0, child_process_1.execSync)(`wsl bash -c "sed -i 's|static_dir.*|static_dir = \\\"/tmp/ghostlink-frontend\\\"|' /tmp/ghostlink-backend/config.toml"`, { stdio: 'pipe', timeout: 5_000 });
                    electron_log_1.default.info('Frontend copied to /tmp/ghostlink-frontend/');
                }
                else {
                    electron_log_1.default.warn('Frontend dist not found at %s — chat UI will not be available', frontendSrc);
                }
                wslBackend = '/tmp/ghostlink-backend';
                electron_log_1.default.info('Backend copied to %s', wslBackend);
            }
            catch (copyErr) {
                electron_log_1.default.error('Failed to copy backend to WSL:', copyErr.message);
                return { success: false, error: 'Cannot access backend from WSL (OneDrive path). Try installing to a local folder instead.' };
            }
        }
        // Check if ALL required deps are installed
        const requiredModules = ['fastapi', 'uvicorn', 'aiosqlite', 'mcp', 'tomli', 'websockets'];
        let depsOk = true;
        for (const mod of requiredModules) {
            try {
                (0, child_process_1.execSync)(`wsl bash -lc "python3 -c \\"import ${mod}\\""`, { stdio: 'pipe', timeout: 10_000 });
            }
            catch {
                depsOk = false;
                break;
            }
        }
        if (!depsOk) {
            electron_log_1.default.info('Python deps missing in WSL — creating venv and installing...');
            try {
                // First, check if python3-venv is available. If not, try to install it.
                try {
                    (0, child_process_1.execSync)('wsl bash -lc "python3 -m venv --help >/dev/null 2>&1"', { stdio: 'pipe', timeout: 10_000 });
                }
                catch {
                    electron_log_1.default.info('python3-venv not available — attempting to install...');
                    try {
                        (0, child_process_1.execSync)('wsl bash -lc "sudo apt-get update -qq && sudo apt-get install -y -qq python3-venv 2>&1"', { stdio: 'pipe', timeout: 60_000 });
                        electron_log_1.default.info('python3-venv installed successfully');
                    }
                    catch (venvInstallErr) {
                        electron_log_1.default.warn('Could not auto-install python3-venv: %s', venvInstallErr.message);
                    }
                }
                // Create a venv at the backend location (avoids PEP 668 restrictions)
                const venvCmd = `python3 -m venv '${wslBackend}/.venv' 2>&1`;
                (0, child_process_1.execSync)(`wsl bash -lc "${venvCmd}"`, { stdio: 'pipe', timeout: 30_000 });
                electron_log_1.default.info('Created venv at %s/.venv', wslBackend);
                // Install deps into the venv
                const pipCmd = `source '${wslBackend}/.venv/bin/activate' && pip install fastapi uvicorn aiosqlite python-multipart mcp tomli websockets 2>&1`;
                (0, child_process_1.execSync)(`wsl bash -lc "${pipCmd}"`, { stdio: 'pipe', timeout: 120_000 });
                electron_log_1.default.info('WSL Python deps installed into venv');
            }
            catch (pipErr) {
                electron_log_1.default.error('pip install failed in WSL:', pipErr.message);
                // Try with --break-system-packages as last resort
                try {
                    (0, child_process_1.execSync)('wsl bash -lc "pip3 install --break-system-packages fastapi uvicorn aiosqlite python-multipart mcp tomli websockets 2>&1"', { stdio: 'pipe', timeout: 120_000 });
                    electron_log_1.default.info('WSL Python deps installed (system-wide with --break-system-packages)');
                }
                catch (fallbackErr) {
                    electron_log_1.default.error('All pip install methods failed:', fallbackErr.message);
                    return { success: false, error: 'Failed to install Python deps. Open Ubuntu terminal and run:\nsudo apt update && sudo apt install -y python3-venv python3-pip\npython3 -m venv ~/.ghostlink-venv && source ~/.ghostlink-venv/bin/activate && pip install fastapi uvicorn aiosqlite python-multipart mcp tomli websockets' };
                }
            }
        }
        // Build the activation + run command — check venv at backend dir first (we may have just created it)
        const venvActivate = [
            `${wslBackend}/.venv/bin/activate`,
            `${wslBackend}/../.venv/bin/activate`,
        ];
        let bashCmd = `cd '${wslBackend}' && `;
        const venvChecks = venvActivate.map(v => `if [ -f '${v}' ]; then source '${v}'; fi`).join('; ');
        bashCmd += `${venvChecks}; PORT=${this.port} PYTHONUNBUFFERED=1 python3 app.py 2>&1`;
        electron_log_1.default.info('Starting backend via WSL — bash -lc "%s"', bashCmd);
        // Capture all output for crash diagnostics
        let serverOutput = '';
        try {
            this.process = (0, child_process_1.spawn)('wsl', ['bash', '-lc', bashCmd], {
                env: { ...process.env },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            // Capture stdout/stderr for diagnostics
            this.process.stdout?.on('data', (data) => {
                const text = data.toString();
                serverOutput += text;
                if (serverOutput.length > 4000)
                    serverOutput = serverOutput.slice(-4000);
            });
            this.process.stderr?.on('data', (data) => {
                const text = data.toString();
                serverOutput += text;
                if (serverOutput.length > 4000)
                    serverOutput = serverOutput.slice(-4000);
            });
            this.attachProcessHandlers();
            await this.waitForReady();
            electron_log_1.default.info('Backend server is ready on port %d (via WSL)', this.port);
            return { success: true, port: this.port };
        }
        catch (err) {
            electron_log_1.default.error('Failed to start backend via WSL:', err);
            if (serverOutput) {
                electron_log_1.default.error('Server output before crash:\n%s', serverOutput);
            }
            await this.stop();
            // Extract the actual error from server output
            const errorLines = serverOutput.split('\n').filter(l => l.includes('Error') || l.includes('error') || l.includes('Traceback') ||
                l.includes('ModuleNotFoundError') || l.includes('ImportError') ||
                l.includes('Address already in use') || l.includes('Permission denied'));
            const errorMsg = errorLines.length > 0
                ? errorLines.slice(-3).join('\n')
                : (err.message ?? 'Server failed to start. Check that Python 3.10+ and all dependencies are installed in WSL.');
            return { success: false, error: errorMsg };
        }
    }
    /**
     * Attach stdout/stderr logging and exit/error handlers to the spawned process.
     */
    attachProcessHandlers() {
        if (!this.process)
            return;
        this.process.stdout?.on('data', (data) => {
            electron_log_1.default.info('[backend]', data.toString().trimEnd());
        });
        this.process.stderr?.on('data', (data) => {
            electron_log_1.default.warn('[backend:err]', data.toString().trimEnd());
        });
        this.process.on('exit', (code, signal) => {
            electron_log_1.default.info('Backend process exited — code=%s signal=%s', code, signal);
            this.process = null;
            if (this.onServerExit)
                this.onServerExit();
        });
        this.process.on('error', (err) => {
            electron_log_1.default.error('Backend process error:', err);
            this.process = null;
        });
    }
    /**
     * Stop the backend server gracefully.
     * Sends SIGTERM, waits up to 3 s, then SIGKILL if still alive.
     * Also kills any lingering tmux sessions prefixed with 'ghostlink-'.
     */
    async stop() {
        if (!this.process) {
            electron_log_1.default.info('Server is not running — nothing to stop.');
            return;
        }
        const pid = this.process.pid;
        electron_log_1.default.info('Stopping backend server (pid %d)...', pid);
        return new Promise((resolve) => {
            const forceKillTimer = setTimeout(() => {
                if (this.process) {
                    electron_log_1.default.warn('Backend did not exit in 3 s — sending SIGKILL');
                    try {
                        this.process.kill('SIGKILL');
                    }
                    catch { /* already dead */ }
                    this.process = null;
                }
                this.killTmuxSessions();
                resolve();
            }, 3000);
            this.process.once('exit', () => {
                clearTimeout(forceKillTimer);
                this.process = null;
                this.killTmuxSessions();
                resolve();
            });
            try {
                // On Windows, tree-kill the process group
                if (process.platform === 'win32' && pid) {
                    (0, child_process_1.execSync)(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
                }
                else {
                    this.process.kill('SIGTERM');
                }
            }
            catch {
                // Process may already be dead
                clearTimeout(forceKillTimer);
                this.process = null;
                this.killTmuxSessions();
                resolve();
            }
        });
    }
    /**
     * Get the current server status.
     */
    getStatus() {
        return {
            running: this.process !== null && this.process.exitCode === null,
            port: this.port,
            pid: this.process?.pid,
        };
    }
    // ---------- private helpers ----------
    /**
     * True when running from a packaged (asar / resources) build.
     */
    isPackaged() {
        return electron_1.app.isPackaged;
    }
    /**
     * Resolve the absolute path to the backend directory (Windows path).
     * In dev mode it lives at ../backend relative to the desktop folder.
     * In a packaged build it is in process.resourcesPath/backend.
     */
    getBackendPath() {
        if (this.isPackaged()) {
            return path_1.default.join(process.resourcesPath, 'backend');
        }
        // Dev: desktop/ sits next to backend/
        return path_1.default.resolve(__dirname, '..', '..', 'backend');
    }
    /**
     * Locate a working Python interpreter (native — not WSL).
     * Priority:
     *   1. Virtual-env python inside the backend directory
     *   2. `python3` on PATH
     *   3. `python` on PATH
     */
    getPythonPath() {
        const backendPath = this.getBackendPath();
        // Check for a virtual environment — inside backend dir, one level up, or workspace root
        const searchDirs = [
            backendPath,
            path_1.default.resolve(backendPath, '..'),
            path_1.default.resolve(backendPath, '..', '..'),
        ];
        for (const dir of searchDirs) {
            const venvCandidates = process.platform === 'win32'
                ? [
                    path_1.default.join(dir, '.venv', 'Scripts', 'python.exe'),
                    path_1.default.join(dir, 'venv', 'Scripts', 'python.exe'),
                ]
                : [
                    path_1.default.join(dir, '.venv', 'bin', 'python'),
                    path_1.default.join(dir, '.venv', 'bin', 'python3'),
                    path_1.default.join(dir, 'venv', 'bin', 'python'),
                    path_1.default.join(dir, 'venv', 'bin', 'python3'),
                ];
            for (const venvPy of venvCandidates) {
                if (fs_1.default.existsSync(venvPy)) {
                    electron_log_1.default.info('Found venv Python at %s', venvPy);
                    return venvPy;
                }
            }
        }
        // Fall back to system Python
        const systemCandidates = process.platform === 'win32'
            ? ['python', 'python3']
            : ['python3', 'python'];
        for (const cmd of systemCandidates) {
            try {
                const result = (0, child_process_1.execSync)(`${cmd} --version`, { stdio: 'pipe', timeout: 5000 });
                electron_log_1.default.info('Found system Python: %s → %s', cmd, result.toString().trim());
                return cmd;
            }
            catch {
                // Not found — try next
            }
        }
        return null;
    }
    /**
     * Poll the backend health endpoint until it responds with HTTP 200,
     * or give up after ~30 seconds.
     */
    waitForReady() {
        const maxAttempts = 60; // 60 * 500 ms = 30 s
        const intervalMs = 500;
        let attempts = 0;
        // Wait 3 seconds before first poll — gives kill time to release ports
        // and prevents health check from hitting a stale server
        const initialDelay = 3000;
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                const timer = setInterval(() => {
                    attempts++;
                    // If the process exited before becoming ready, abort
                    if (!this.process || this.process.exitCode !== null) {
                        clearInterval(timer);
                        reject(new Error('Backend process exited before becoming ready'));
                        return;
                    }
                    const req = http_1.default.get(`http://127.0.0.1:${this.port}/api/status`, (res) => {
                        if (res.statusCode === 200) {
                            clearInterval(timer);
                            resolve();
                        }
                        res.resume();
                    });
                    req.on('error', () => {
                        // Server not ready yet — keep polling
                    });
                    req.setTimeout(400, () => req.destroy());
                    if (attempts >= maxAttempts) {
                        clearInterval(timer);
                        reject(new Error(`Backend did not become ready after ${(maxAttempts * intervalMs) / 1000}s`));
                    }
                }, intervalMs);
            }, initialDelay);
        });
    }
    /**
     * Kill any tmux sessions prefixed with 'ghostlink-' (agent sessions).
     * Fails silently if tmux is not installed.
     */
    killTmuxSessions() {
        try {
            const tmuxCmd = isWsl()
                ? "wsl bash -c \"tmux list-sessions -F '#{session_name}' 2>/dev/null | grep '^ghostlink-' | xargs -I{} tmux kill-session -t {}\""
                : "tmux list-sessions -F '#{session_name}' 2>/dev/null | grep '^ghostlink-' | xargs -I{} tmux kill-session -t {}";
            (0, child_process_1.execSync)(tmuxCmd, {
                stdio: 'ignore',
                timeout: 5000,
            });
        }
        catch {
            // tmux not installed or no matching sessions — that is fine
        }
    }
}
/** Singleton server manager instance */
exports.serverManager = new ServerManager();
//# sourceMappingURL=server.js.map