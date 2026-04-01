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

import { ChildProcess, execFileSync, spawn } from 'child_process';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import http from 'http';
import net from 'net';
import log from 'electron-log';
import { getSettingsPath, loadSettingsFile } from './settings';
import { WSL_EXE } from './auth/index';

interface ServerStatus {
  running: boolean;
  port: number;
  pid?: number;
}

interface StartResult {
  success: boolean;
  port?: number;
  error?: string;
}

// ── Platform helpers ─────────────────────────────────────────────────────────

function getSettings(): Record<string, any> | null {
  try {
    const settingsPath = getSettingsPath();
    if (!fs.existsSync(settingsPath)) return null;
    return loadSettingsFile(settingsPath) as Record<string, any> | null;
  } catch {
    return null;
  }
}

function isWsl(): boolean {
  const settings = getSettings();
  return settings?.platform === 'wsl';
}

/**
 * Convert a Windows path like C:\Users\foo\bar to WSL path /mnt/c/Users/foo/bar.
 */
function winToWsl(windowsPath: string): string {
  let p = windowsPath.replace(/\\/g, '/');
  const driveMatch = p.match(/^([A-Za-z]):\//);
  if (driveMatch) {
    p = `/mnt/${driveMatch[1].toLowerCase()}/${p.slice(3)}`;
  }
  return p;
}

function isPathInsideRoot(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)));
}

function joinWslPath(...segments: string[]): string {
  return path.posix.join(...segments);
}

function existingPath(paths: string[]): string | null {
  for (const candidate of paths) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

class ServerManager {
  private process: ChildProcess | null = null;
  private port: number = 8300;
  onServerExit: (() => void) | null = null;

  private exec(command: string, args: string[], options: Record<string, any> = {}): string {
    const result = execFileSync(command, args, {
      windowsHide: true,
      ...options,
    });
    return typeof result === 'string' ? result : result.toString('utf-8');
  }

  private tryExec(command: string, args: string[], options: Record<string, any> = {}): string | null {
    try {
      return this.exec(command, args, options);
    } catch {
      return null;
    }
  }

  private execWsl(args: string[], options: Record<string, any> = {}): string {
    return this.exec(WSL_EXE, args, options);
  }

  private tryExecWsl(args: string[], options: Record<string, any> = {}): string | null {
    return this.tryExec(WSL_EXE, args, options);
  }

  private isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();

      server.once('error', () => {
        resolve(false);
      });

      server.once('listening', () => {
        server.close(() => resolve(true));
      });

      server.listen(port, '127.0.0.1');
    });
  }

  private async waitForPortsToBeReleased(ports: number[], timeoutMs = 8_000): Promise<void> {
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
  async start(): Promise<StartResult> {
    if (this.process) {
      log.info('Server already running (pid %d)', this.process.pid);
      return { success: true, port: this.port };
    }

    // Read user-configured port from settings (default 8300)
    try {
      const settings = getSettings();
      const cfgPort = Number(settings?.port);
      if (cfgPort && Number.isInteger(cfgPort) && cfgPort >= 1024 && cfgPort <= 65535) {
        this.port = cfgPort;
      }
    } catch { /* use default port */ }

    const portsToClear = [this.port, 8200, 8201];

    // Kill ALL stale GhostLink processes and free ports
    try {
      if (isWsl()) {
        for (const port of portsToClear) {
          this.tryExecWsl(['fuser', '-k', `${port}/tcp`], { stdio: 'ignore', timeout: 5_000 });
        }
        this.tryExecWsl(['pkill', '-9', '-f', 'python.*app\\.py'], { stdio: 'ignore', timeout: 5_000 });
        this.tryExecWsl(['pkill', '-9', '-f', 'uvicorn'], { stdio: 'ignore', timeout: 5_000 });
      } else if (process.platform !== 'win32') {
        for (const port of portsToClear) {
          this.tryExec('fuser', ['-k', `${port}/tcp`], { stdio: 'ignore', timeout: 5_000 });
        }
        this.tryExec('pkill', ['-9', '-f', 'python.*app.py'], { stdio: 'ignore', timeout: 5_000 });
        this.tryExec('pkill', ['-9', '-f', 'uvicorn'], { stdio: 'ignore', timeout: 5_000 });
      }
    } catch { /* no stale processes — normal */ }

    try {
      await this.waitForPortsToBeReleased(portsToClear);
      log.info('Startup port cleanup complete for %d, 8200, 8201', this.port);
    } catch (err: any) {
      const error = err?.message ?? String(err);
      log.error(error);
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
      log.error(msg);
      return { success: false, error: msg };
    }

    if (!fs.existsSync(backendPath)) {
      const msg = `Backend directory not found: ${backendPath}`;
      log.error(msg);
      return { success: false, error: msg };
    }

    // Ensure Python deps are installed (first-run auto-install)
    try {
      this.exec(
        pythonPath,
        ['-c', 'import importlib.util, sys; sys.exit(0 if importlib.util.find_spec(sys.argv[1]) else 1)', 'fastapi'],
        { stdio: 'ignore', timeout: 5_000 }
      );
    } catch {
      log.info('Python deps not installed — running pip install...');
      const reqFile = path.join(backendPath, 'requirements.txt');
      if (fs.existsSync(reqFile)) {
        try {
          this.exec(pythonPath, ['-m', 'pip', 'install', '-r', reqFile], { stdio: 'pipe', timeout: 120_000 });
          log.info('Python deps installed successfully');
        } catch (pipErr: any) {
          log.error('pip install failed:', pipErr.message);
          return { success: false, error: 'Failed to install Python dependencies. Run: pip install -r requirements.txt' };
        }
      }
    }

    log.info('Starting backend — python=%s  cwd=%s  port=%d', pythonPath, backendPath, this.port);

    try {
      this.process = spawn(pythonPath, ['app.py'], {
        cwd: backendPath,
        env: {
          ...process.env,
          PORT: String(this.port),
          PYTHONUNBUFFERED: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.attachProcessHandlers();
      await this.waitForReady();
      log.info('Backend server is ready on port %d', this.port);
      return { success: true, port: this.port };
    } catch (err: any) {
      log.error('Failed to start backend:', err);
      await this.stop();
      return { success: false, error: err.message ?? String(err) };
    }
  }

  /**
   * Start the backend through WSL.
   * Uses direct argument vectors instead of shell-interpolated paths.
   */
  private async startViaWsl(backendPath: string): Promise<StartResult> {
    let wslBackend = winToWsl(backendPath);
    const pipPackages = ['fastapi', 'uvicorn', 'aiosqlite', 'python-multipart', 'mcp', 'tomli', 'websockets', 'cryptography'];

    // Check Python is available in WSL
    try {
      this.execWsl(['python3', '--version'], { stdio: 'pipe', timeout: 10_000 });
    } catch {
      return { success: false, error: 'Python3 not found in WSL. Install Python 3.10+ in your WSL distro.' };
    }

    // Check frontend dist early so the copied backend config can point at it.
    let frontendSrc = path.resolve(backendPath, '..', 'frontend', 'dist');
    if (!fs.existsSync(frontendSrc) || !fs.existsSync(path.join(frontendSrc, 'index.html'))) {
      frontendSrc = path.resolve(backendPath, '..', 'frontend');
    }
    const frontendAvailable = fs.existsSync(frontendSrc) && fs.existsSync(path.join(frontendSrc, 'index.html'));
    if (!frontendAvailable) {
      const error = `Frontend assets not found at ${frontendSrc}. Build the frontend before starting the desktop app.`;
      log.error(error);
      return { success: false, error };
    }

    // OneDrive / cloud paths often aren't fully accessible from WSL
    // Test by actually trying to read a file, not just checking if dir exists
    let pathAccessible = false;
    try {
      this.execWsl(['test', '-r', joinWslPath(wslBackend, 'app.py')], { stdio: 'ignore', timeout: 10_000 });
      pathAccessible = true;
    } catch {}

    // Also check if the path contains OneDrive — these are always problematic
    if (wslBackend.toLowerCase().includes('onedrive')) {
      log.info('OneDrive path detected — will copy to /tmp/ for WSL compatibility');
      pathAccessible = false;
    }

    if (!pathAccessible) {
      log.info('Backend path not accessible from WSL (%s) — copying to /tmp/ghostlink-backend/', wslBackend);
      try {
        const tmpBackend = '/tmp/ghostlink-backend';
        const tmpFrontend = '/tmp/ghostlink-frontend';
        const backendRootReal = fs.realpathSync(backendPath);

        const writeFileToWsl = (destPath: string, content: Buffer | string) => {
          this.execWsl(['tee', destPath], {
            input: content,
            stdio: ['pipe', 'ignore', 'pipe'],
            timeout: 10_000,
          });
        };

        const copyTreeToWsl = (
          sourceRoot: string,
          currentDir: string,
          destDir: string,
          shouldCopy: (entry: fs.Dirent, srcPath: string) => boolean,
          transform?: (srcPath: string, content: Buffer) => Buffer,
        ) => {
          const currentReal = fs.realpathSync(currentDir);
          if (!isPathInsideRoot(sourceRoot, currentReal)) {
            throw new Error(`Refusing to copy path outside source root: ${currentDir}`);
          }

          for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
            const srcPath = path.join(currentDir, entry.name);

            if (entry.isSymbolicLink()) {
              throw new Error(`Refusing to copy symlink into WSL temp dir: ${srcPath}`);
            }

            const srcReal = fs.realpathSync(srcPath);
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

            const content = fs.readFileSync(srcPath);
            writeFileToWsl(destPath, transform ? transform(srcPath, content) : content);
          }
        };

        // Clean up stale temp files from previous runs before copying
        this.execWsl(['rm', '-rf', tmpBackend, tmpFrontend], { stdio: 'pipe', timeout: 5_000 });

        // Create dir and copy files using wsl
        this.execWsl(['mkdir', '-p', tmpBackend], { stdio: 'pipe', timeout: 5_000 });

        copyTreeToWsl(
          backendRootReal,
          backendRootReal,
          tmpBackend,
          (entry) => !(
            entry.name.startsWith('__pycache__') ||
            entry.name === 'data' ||
            entry.name === 'uploads' ||
            entry.name === '.venv'
          ) && (entry.isDirectory() || /\.(py|txt|toml|json)$/.test(entry.name)),
          (srcPath, content) => {
            if (!frontendAvailable || path.basename(srcPath) !== 'config.toml') {
              return content;
            }

            let configText = content.toString('utf-8');
            const staticDirLine = `static_dir = "${tmpFrontend}"`;
            if (/^static_dir\s*=.*$/m.test(configText)) {
              configText = configText.replace(/^static_dir\s*=.*$/m, staticDirLine);
            } else {
              configText += `\n${staticDirLine}\n`;
            }
            return Buffer.from(configText, 'utf-8');
          },
        );

        if (frontendAvailable) {
          log.info('Copying frontend from %s to %s/', frontendSrc, tmpFrontend);
          const frontendRootReal = fs.realpathSync(frontendSrc);
          this.execWsl(['mkdir', '-p', tmpFrontend], { stdio: 'pipe', timeout: 5_000 });
          copyTreeToWsl(frontendRootReal, frontendRootReal, tmpFrontend, () => true);
          log.info('Frontend copied to %s/', tmpFrontend);
        }

        wslBackend = tmpBackend;
        log.info('Backend copied to %s', wslBackend);
      } catch (copyErr: any) {
        log.error('Failed to copy backend to WSL:', copyErr.message);
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
      } catch {
        depsOk = false;
        break;
      }
    }

    if (!depsOk) {
      log.info('Python deps missing in WSL — creating venv and installing...');
      const venvPath = joinWslPath(wslBackend, '.venv');
      let createdVenv = false;
      const cleanupBrokenVenv = () => {
        if (!createdVenv) return;
        this.tryExecWsl(['rm', '-rf', venvPath], { stdio: 'pipe', timeout: 10_000 });
        createdVenv = false;
      };
      try {
        // First, check if python3-venv is available. If not, try to install it.
        try {
          this.execWsl(['python3', '-m', 'venv', '--help'], { stdio: 'pipe', timeout: 10_000 });
        } catch {
          log.info('python3-venv not available — attempting to install...');
          try {
            this.execWsl(['sudo', 'apt-get', 'update', '-qq'], { stdio: 'pipe', timeout: 60_000 });
            this.execWsl(['sudo', 'apt-get', 'install', '-y', '-qq', 'python3-venv'], { stdio: 'pipe', timeout: 60_000 });
            log.info('python3-venv installed successfully');
          } catch (venvInstallErr: any) {
            log.warn('Could not auto-install python3-venv: %s', venvInstallErr.message);
          }
        }

        // Create a venv at the backend location (avoids PEP 668 restrictions)
        this.execWsl(['python3', '-m', 'venv', venvPath], { stdio: 'pipe', timeout: 30_000 });
        createdVenv = true;
        log.info('Created venv at %s/.venv', wslBackend);

        // Install deps into the venv
        this.execWsl([joinWslPath(venvPath, 'bin', 'pip'), 'install', ...pipPackages], { stdio: 'pipe', timeout: 120_000 });
        log.info('WSL Python deps installed into venv');
      } catch (pipErr: any) {
        log.error('pip install failed in WSL:', pipErr.message);
        cleanupBrokenVenv();
        // Try with --break-system-packages as last resort
        try {
          this.execWsl(['pip3', 'install', '--break-system-packages', ...pipPackages], { stdio: 'pipe', timeout: 120_000 });
          log.info('WSL Python deps installed (system-wide with --break-system-packages)');
        } catch (fallbackErr: any) {
          log.error('All pip install methods failed:', fallbackErr.message);
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

    log.info('Starting backend via WSL — python=%s app=%s', wslPython, joinWslPath(wslBackend, 'app.py'));

    // Capture all output for crash diagnostics
    let serverOutput = '';

    try {
      this.process = spawn(WSL_EXE, ['env', `PORT=${this.port}`, 'PYTHONUNBUFFERED=1', wslPython, joinWslPath(wslBackend, 'app.py')], {
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Capture stdout/stderr for diagnostics
      this.process.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        serverOutput += text;
        if (serverOutput.length > 4000) serverOutput = serverOutput.slice(-4000);
      });
      this.process.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        serverOutput += text;
        if (serverOutput.length > 4000) serverOutput = serverOutput.slice(-4000);
      });

      this.attachProcessHandlers();
      await this.waitForReady();
      log.info('Backend server is ready on port %d (via WSL)', this.port);
      return { success: true, port: this.port };
    } catch (err: any) {
      log.error('Failed to start backend via WSL:', err);
      if (serverOutput) {
        log.error('Server output before crash:\n%s', serverOutput);
      }
      await this.stop();
      // Extract the actual error from server output
      const errorLines = serverOutput.split('\n').filter(l =>
        l.includes('Error') || l.includes('error') || l.includes('Traceback') ||
        l.includes('ModuleNotFoundError') || l.includes('ImportError') ||
        l.includes('Address already in use') || l.includes('Permission denied')
      );
      const errorMsg = errorLines.length > 0
        ? errorLines.slice(-3).join('\n')
        : (err.message ?? 'Server failed to start. Check that Python 3.10+ and all dependencies are installed in WSL.');
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Attach stdout/stderr logging and exit/error handlers to the spawned process.
   */
  private attachProcessHandlers(): void {
    if (!this.process) return;

    this.process.stdout?.on('data', (data: Buffer) => {
      log.info('[backend]', data.toString().trimEnd());
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      log.warn('[backend:err]', data.toString().trimEnd());
    });

    this.process.on('exit', (code, signal) => {
      log.info('Backend process exited — code=%s signal=%s', code, signal);
      this.process = null;
      if (this.onServerExit) this.onServerExit();
    });

    this.process.on('error', (err) => {
      log.error('Backend process error:', err);
      this.process = null;
    });
  }

  /**
   * Stop the backend server gracefully.
   * Sends SIGTERM, waits up to 3 s, then SIGKILL if still alive.
   * Also kills any lingering tmux sessions prefixed with 'ghostlink-'.
   */
  async stop(): Promise<void> {
    if (!this.process) {
      log.info('Server is not running — nothing to stop.');
      return;
    }

    const pid = this.process.pid;
    log.info('Stopping backend server (pid %d)...', pid);

    return new Promise<void>((resolve) => {
      const forceKillTimer = setTimeout(() => {
        if (this.process) {
          log.warn('Backend did not exit in 3 s — sending SIGKILL');
          try {
            this.process.kill('SIGKILL');
          } catch { /* already dead */ }
          this.process = null;
        }
        this.killTmuxSessions();
        resolve();
      }, 3000);

      this.process!.once('exit', () => {
        clearTimeout(forceKillTimer);
        this.process = null;
        this.killTmuxSessions();
        resolve();
      });

      try {
        // On Windows, tree-kill the process group
        if (process.platform === 'win32' && pid) {
          this.exec('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
        } else {
          this.process!.kill('SIGTERM');
        }
      } catch {
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
  getStatus(): ServerStatus {
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
  private isPackaged(): boolean {
    return app.isPackaged;
  }

  /**
   * Resolve the absolute path to the backend directory (Windows path).
   * In dev mode it lives at ../backend relative to the desktop folder.
   * In a packaged build it is usually in process.resourcesPath/backend,
   * with fallbacks for unpacked/asar-adjacent layouts.
   */
  private getBackendPath(): string {
    if (this.isPackaged()) {
      return existingPath([
        path.join(process.resourcesPath, 'backend'),
        path.join(process.resourcesPath, 'app.asar.unpacked', 'backend'),
        path.join(process.resourcesPath, 'app', 'backend'),
      ]) ?? path.join(process.resourcesPath, 'backend');
    }
    // Dev: desktop/ sits next to backend/
    return path.resolve(__dirname, '..', '..', 'backend');
  }

  /**
   * Locate a working Python interpreter (native — not WSL).
   * Priority:
   *   1. Virtual-env python inside the backend directory
   *   2. `python3` on PATH
   *   3. `python` on PATH
   */
  private getPythonPath(): string | null {
    const backendPath = this.getBackendPath();

    // Check for a virtual environment — inside backend dir, one level up, or workspace root
    const searchDirs = [
      backendPath,
      path.resolve(backendPath, '..'),
      path.resolve(backendPath, '..', '..'),
    ];

    for (const dir of searchDirs) {
      const venvCandidates = process.platform === 'win32'
        ? [
            path.join(dir, '.venv', 'Scripts', 'python.exe'),
            path.join(dir, 'venv', 'Scripts', 'python.exe'),
          ]
        : [
            path.join(dir, '.venv', 'bin', 'python'),
            path.join(dir, '.venv', 'bin', 'python3'),
            path.join(dir, 'venv', 'bin', 'python'),
            path.join(dir, 'venv', 'bin', 'python3'),
          ];

      for (const venvPy of venvCandidates) {
        if (fs.existsSync(venvPy)) {
          log.info('Found venv Python at %s', venvPy);
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
        log.info('Found system Python: %s → %s', cmd, result.trim());
        return cmd;
      } catch {
        // Not found — try next
      }
    }

    return null;
  }

  /**
   * Poll the backend health endpoint until it responds with HTTP 200,
   * or give up after ~30 seconds.
   */
  private waitForReady(): Promise<void> {
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

          const req = http.get(`http://127.0.0.1:${this.port}/api/status`, (res) => {
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
  private killTmuxSessions(): void {
    try {
      const output = isWsl()
        ? this.tryExecWsl(['tmux', 'list-sessions', '-F', '#{session_name}'], { stdio: 'pipe', timeout: 5_000 })
        : this.tryExec('tmux', ['list-sessions', '-F', '#{session_name}'], { stdio: 'pipe', timeout: 5_000 });

      if (!output) return;

      for (const sessionName of output.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('ghostlink-'))) {
        if (isWsl()) {
          this.tryExecWsl(['tmux', 'kill-session', '-t', sessionName], { stdio: 'ignore', timeout: 5_000 });
        } else {
          this.tryExec('tmux', ['kill-session', '-t', sessionName], { stdio: 'ignore', timeout: 5_000 });
        }
      }
    } catch {
      // tmux not installed or no matching sessions — that is fine
    }
  }
}

/** Singleton server manager instance */
export const serverManager = new ServerManager();
