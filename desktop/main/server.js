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
const net_1 = __importDefault(require("net"));
const electron_log_1 = __importDefault(require("electron-log"));
const settings_1 = require("./settings");
const index_1 = require("./auth/index");
// ── Platform helpers ─────────────────────────────────────────────────────────
function getSettings() {
    try {
        const settingsPath = (0, settings_1.getSettingsPath)();
        if (!fs_1.default.existsSync(settingsPath))
            return null;
        return (0, settings_1.loadSettingsFile)(settingsPath);
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
function isPathInsideRoot(rootPath, targetPath) {
    const relative = path_1.default.relative(rootPath, targetPath);
    return (relative === '' || (!relative.startsWith('..') && !path_1.default.isAbsolute(relative)));
}
function joinWslPath(...segments) {
    return path_1.default.posix.join(...segments);
}
function existingPath(paths) {
    for (const candidate of paths) {
        if (fs_1.default.existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}
class ServerManager {
    process = null;
    port = 8300;
    onServerExit = null;
    exec(command, args, options = {}) {
        const result = (0, child_process_1.execFileSync)(command, args, {
            windowsHide: true,
            ...options,
        });
        return typeof result === 'string' ? result : result.toString('utf-8');
    }
    tryExec(command, args, options = {}) {
        try {
            return this.exec(command, args, options);
        }
        catch {
            return null;
        }
    }
    execWsl(args, options = {}) {
        return this.exec(index_1.WSL_EXE, args, options);
    }
    tryExecWsl(args, options = {}) {
        return this.tryExec(index_1.WSL_EXE, args, options);
    }
    isPortAvailable(port) {
        return new Promise((resolve) => {
            const server = net_1.default.createServer();
            server.once('error', () => {
                resolve(false);
            });
            server.once('listening', () => {
                server.close(() => resolve(true));
            });
            server.listen(port, '127.0.0.1');
        });
    }
    async waitForPortsToBeReleased(ports, timeoutMs = 8_000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const availability = await Promise.all(ports.map((port) => this.isPortAvailable(port)));
            const blocked = ports.filter((_port, index) => !availability[index]);
            if (blocked.length === 0) {
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
        const finalAvailability = await Promise.all(ports.map((port) => this.isPortAvailable(port)));
        const blocked = ports.filter((_port, index) => !finalAvailability[index]);
        throw new Error(`Startup blocked: ports still in use after cleanup: ${blocked.join(', ')}`);
    }
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
        const portsToClear = [this.port, 8200, 8201];
        // Kill ALL stale GhostLink processes and free ports
        try {
            if (isWsl()) {
                for (const port of portsToClear) {
                    this.tryExecWsl(['fuser', '-k', `${port}/tcp`], { stdio: 'ignore', timeout: 5_000 });
                }
                this.tryExecWsl(['pkill', '-9', '-f', 'python.*app\\.py'], { stdio: 'ignore', timeout: 5_000 });
                this.tryExecWsl(['pkill', '-9', '-f', 'uvicorn'], { stdio: 'ignore', timeout: 5_000 });
            }
            else if (process.platform !== 'win32') {
                for (const port of portsToClear) {
                    this.tryExec('fuser', ['-k', `${port}/tcp`], { stdio: 'ignore', timeout: 5_000 });
                }
                this.tryExec('pkill', ['-9', '-f', 'python.*app.py'], { stdio: 'ignore', timeout: 5_000 });
                this.tryExec('pkill', ['-9', '-f', 'uvicorn'], { stdio: 'ignore', timeout: 5_000 });
            }
        }
        catch { /* no stale processes — normal */ }
        try {
            await this.waitForPortsToBeReleased(portsToClear);
            electron_log_1.default.info('Startup port cleanup complete for %d, 8200, 8201', this.port);
        }
        catch (err) {
            const error = err?.message ?? String(err);
            electron_log_1.default.error(error);
            return { success: false, error };
        }
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
            this.exec(pythonPath, ['-c', 'import importlib.util, sys; sys.exit(0 if importlib.util.find_spec(sys.argv[1]) else 1)', 'fastapi'], { stdio: 'ignore', timeout: 5_000 });
        }
        catch {
            electron_log_1.default.info('Python deps not installed — running pip install...');
            const reqFile = path_1.default.join(backendPath, 'requirements.txt');
            if (fs_1.default.existsSync(reqFile)) {
                try {
                    this.exec(pythonPath, ['-m', 'pip', 'install', '-r', reqFile], { stdio: 'pipe', timeout: 120_000 });
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
     * Uses direct argument vectors instead of shell-interpolated paths.
     */
    async startViaWsl(backendPath) {
        let wslBackend = winToWsl(backendPath);
        const pipPackages = ['fastapi', 'uvicorn', 'aiosqlite', 'python-multipart', 'mcp', 'tomli', 'websockets', 'cryptography'];
        // Check Python is available in WSL
        try {
            this.execWsl(['python3', '--version'], { stdio: 'pipe', timeout: 10_000 });
        }
        catch {
            return { success: false, error: 'Python3 not found in WSL. Install Python 3.10+ in your WSL distro.' };
        }
        // Check frontend dist early so the copied backend config can point at it.
        let frontendSrc = path_1.default.resolve(backendPath, '..', 'frontend', 'dist');
        if (!fs_1.default.existsSync(frontendSrc) || !fs_1.default.existsSync(path_1.default.join(frontendSrc, 'index.html'))) {
            frontendSrc = path_1.default.resolve(backendPath, '..', 'frontend');
        }
        const frontendAvailable = fs_1.default.existsSync(frontendSrc) && fs_1.default.existsSync(path_1.default.join(frontendSrc, 'index.html'));
        if (!frontendAvailable) {
            const error = `Frontend assets not found at ${frontendSrc}. Build the frontend before starting the desktop app.`;
            electron_log_1.default.error(error);
            return { success: false, error };
        }
        // OneDrive / cloud paths often aren't fully accessible from WSL
        // Test by actually trying to read a file, not just checking if dir exists
        let pathAccessible = false;
        try {
            this.execWsl(['test', '-r', joinWslPath(wslBackend, 'app.py')], { stdio: 'ignore', timeout: 10_000 });
            pathAccessible = true;
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
                const tmpBackend = '/tmp/ghostlink-backend';
                const tmpFrontend = '/tmp/ghostlink-frontend';
                const backendRootReal = fs_1.default.realpathSync(backendPath);
                const writeFileToWsl = (destPath, content) => {
                    this.execWsl(['tee', destPath], {
                        input: content,
                        stdio: ['pipe', 'ignore', 'pipe'],
                        timeout: 10_000,
                    });
                };
                const copyTreeToWsl = (sourceRoot, currentDir, destDir, shouldCopy, transform) => {
                    const currentReal = fs_1.default.realpathSync(currentDir);
                    if (!isPathInsideRoot(sourceRoot, currentReal)) {
                        throw new Error(`Refusing to copy path outside source root: ${currentDir}`);
                    }
                    for (const entry of fs_1.default.readdirSync(currentDir, { withFileTypes: true })) {
                        const srcPath = path_1.default.join(currentDir, entry.name);
                        if (entry.isSymbolicLink()) {
                            throw new Error(`Refusing to copy symlink into WSL temp dir: ${srcPath}`);
                        }
                        const srcReal = fs_1.default.realpathSync(srcPath);
                        if (!isPathInsideRoot(sourceRoot, srcReal)) {
                            throw new Error(`Refusing to copy path outside source root: ${srcPath}`);
                        }
                        if (!shouldCopy(entry, srcPath)) {
                            continue;
                        }
                        const destPath = joinWslPath(destDir, entry.name);
                        if (entry.isDirectory()) {
                            this.execWsl(['mkdir', '-p', destPath], { stdio: 'pipe', timeout: 5_000 });
                            copyTreeToWsl(sourceRoot, srcPath, destPath, shouldCopy, transform);
                            continue;
                        }
                        const content = fs_1.default.readFileSync(srcPath);
                        writeFileToWsl(destPath, transform ? transform(srcPath, content) : content);
                    }
                };
                // Clean up stale temp files from previous runs before copying
                this.execWsl(['rm', '-rf', tmpBackend, tmpFrontend], { stdio: 'pipe', timeout: 5_000 });
                // Create dir and copy files using wsl
                this.execWsl(['mkdir', '-p', tmpBackend], { stdio: 'pipe', timeout: 5_000 });
                copyTreeToWsl(backendRootReal, backendRootReal, tmpBackend, (entry) => !(entry.name.startsWith('__pycache__') ||
                    entry.name === 'data' ||
                    entry.name === 'uploads' ||
                    entry.name === '.venv') && (entry.isDirectory() || /\.(py|txt|toml|json)$/.test(entry.name)), (srcPath, content) => {
                    if (!frontendAvailable || path_1.default.basename(srcPath) !== 'config.toml') {
                        return content;
                    }
                    let configText = content.toString('utf-8');
                    const staticDirLine = `static_dir = "${tmpFrontend}"`;
                    if (/^static_dir\s*=.*$/m.test(configText)) {
                        configText = configText.replace(/^static_dir\s*=.*$/m, staticDirLine);
                    }
                    else {
                        configText += `\n${staticDirLine}\n`;
                    }
                    return Buffer.from(configText, 'utf-8');
                });
                if (frontendAvailable) {
                    electron_log_1.default.info('Copying frontend from %s to %s/', frontendSrc, tmpFrontend);
                    const frontendRootReal = fs_1.default.realpathSync(frontendSrc);
                    this.execWsl(['mkdir', '-p', tmpFrontend], { stdio: 'pipe', timeout: 5_000 });
                    copyTreeToWsl(frontendRootReal, frontendRootReal, tmpFrontend, () => true);
                    electron_log_1.default.info('Frontend copied to %s/', tmpFrontend);
                }
                wslBackend = tmpBackend;
                electron_log_1.default.info('Backend copied to %s', wslBackend);
            }
            catch (copyErr) {
                electron_log_1.default.error('Failed to copy backend to WSL:', copyErr.message);
                return { success: false, error: 'Cannot access backend from WSL (OneDrive path). Try installing to a local folder instead.' };
            }
        }
        // Check if ALL required deps are installed
        const requiredModules = ['fastapi', 'uvicorn', 'aiosqlite', 'mcp', 'tomli', 'websockets', 'cryptography'];
        let depsOk = true;
        for (const mod of requiredModules) {
            try {
                this.execWsl([
                    'python3',
                    '-c',
                    'import importlib.util, sys; sys.exit(0 if importlib.util.find_spec(sys.argv[1]) else 1)',
                    mod,
                ], { stdio: 'pipe', timeout: 10_000 });
            }
            catch {
                depsOk = false;
                break;
            }
        }
        if (!depsOk) {
            electron_log_1.default.info('Python deps missing in WSL — creating venv and installing...');
            const venvPath = joinWslPath(wslBackend, '.venv');
            let createdVenv = false;
            const cleanupBrokenVenv = () => {
                if (!createdVenv)
                    return;
                this.tryExecWsl(['rm', '-rf', venvPath], { stdio: 'pipe', timeout: 10_000 });
                createdVenv = false;
            };
            try {
                // First, check if python3-venv is available. If not, try to install it.
                try {
                    this.execWsl(['python3', '-m', 'venv', '--help'], { stdio: 'pipe', timeout: 10_000 });
                }
                catch {
                    electron_log_1.default.info('python3-venv not available — attempting to install...');
                    try {
                        this.execWsl(['sudo', 'apt-get', 'update', '-qq'], { stdio: 'pipe', timeout: 60_000 });
                        this.execWsl(['sudo', 'apt-get', 'install', '-y', '-qq', 'python3-venv'], { stdio: 'pipe', timeout: 60_000 });
                        electron_log_1.default.info('python3-venv installed successfully');
                    }
                    catch (venvInstallErr) {
                        electron_log_1.default.warn('Could not auto-install python3-venv: %s', venvInstallErr.message);
                    }
                }
                // Create a venv at the backend location (avoids PEP 668 restrictions)
                this.execWsl(['python3', '-m', 'venv', venvPath], { stdio: 'pipe', timeout: 30_000 });
                createdVenv = true;
                electron_log_1.default.info('Created venv at %s/.venv', wslBackend);
                // Install deps into the venv
                this.execWsl([joinWslPath(venvPath, 'bin', 'pip'), 'install', ...pipPackages], { stdio: 'pipe', timeout: 120_000 });
                electron_log_1.default.info('WSL Python deps installed into venv');
            }
            catch (pipErr) {
                electron_log_1.default.error('pip install failed in WSL:', pipErr.message);
                cleanupBrokenVenv();
                // Try with --break-system-packages as last resort
                try {
                    this.execWsl(['pip3', 'install', '--break-system-packages', ...pipPackages], { stdio: 'pipe', timeout: 120_000 });
                    electron_log_1.default.info('WSL Python deps installed (system-wide with --break-system-packages)');
                }
                catch (fallbackErr) {
                    electron_log_1.default.error('All pip install methods failed:', fallbackErr.message);
                    cleanupBrokenVenv();
                    return { success: false, error: 'Failed to install Python deps. Open Ubuntu terminal and run:\nsudo apt update && sudo apt install -y python3-venv python3-pip\npython3 -m venv ~/.ghostlink-venv && source ~/.ghostlink-venv/bin/activate && pip install fastapi uvicorn aiosqlite python-multipart mcp tomli websockets' };
                }
            }
        }
        // Prefer a virtualenv Python at the backend path when available.
        const pythonCandidates = [
            joinWslPath(wslBackend, '.venv', 'bin', 'python3'),
            joinWslPath(wslBackend, '.venv', 'bin', 'python'),
            joinWslPath(wslBackend, '..', '.venv', 'bin', 'python3'),
            joinWslPath(wslBackend, '..', '.venv', 'bin', 'python'),
        ];
        let wslPython = 'python3';
        for (const candidate of pythonCandidates) {
            if (this.tryExecWsl(['test', '-x', candidate], { stdio: 'ignore', timeout: 5_000 }) !== null) {
                wslPython = candidate;
                break;
            }
        }
        electron_log_1.default.info('Starting backend via WSL — python=%s app=%s', wslPython, joinWslPath(wslBackend, 'app.py'));
        // Capture all output for crash diagnostics
        let serverOutput = '';
        try {
            this.process = (0, child_process_1.spawn)(index_1.WSL_EXE, ['env', `PORT=${this.port}`, 'PYTHONUNBUFFERED=1', wslPython, joinWslPath(wslBackend, 'app.py')], {
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
                    this.exec('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
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
     * In a packaged build it is usually in process.resourcesPath/backend,
     * with fallbacks for unpacked/asar-adjacent layouts.
     */
    getBackendPath() {
        if (this.isPackaged()) {
            return existingPath([
                path_1.default.join(process.resourcesPath, 'backend'),
                path_1.default.join(process.resourcesPath, 'app.asar.unpacked', 'backend'),
                path_1.default.join(process.resourcesPath, 'app', 'backend'),
            ]) ?? path_1.default.join(process.resourcesPath, 'backend');
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
                const result = this.exec(cmd, ['--version'], { stdio: 'pipe', timeout: 5_000 });
                electron_log_1.default.info('Found system Python: %s → %s', cmd, result.trim());
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
            const output = isWsl()
                ? this.tryExecWsl(['tmux', 'list-sessions', '-F', '#{session_name}'], { stdio: 'pipe', timeout: 5_000 })
                : this.tryExec('tmux', ['list-sessions', '-F', '#{session_name}'], { stdio: 'pipe', timeout: 5_000 });
            if (!output)
                return;
            for (const sessionName of output.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('ghostlink-'))) {
                if (isWsl()) {
                    this.tryExecWsl(['tmux', 'kill-session', '-t', sessionName], { stdio: 'ignore', timeout: 5_000 });
                }
                else {
                    this.tryExec('tmux', ['kill-session', '-t', sessionName], { stdio: 'ignore', timeout: 5_000 });
                }
            }
        }
        catch {
            // tmux not installed or no matching sessions — that is fine
        }
    }
}
/** Singleton server manager instance */
exports.serverManager = new ServerManager();
//# sourceMappingURL=server.js.map