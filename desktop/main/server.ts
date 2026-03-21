/**
 * ServerManager — Manages the Python FastAPI backend process.
 *
 * Handles finding the correct Python interpreter, resolving the backend
 * directory for both dev and packaged environments, spawning the process,
 * health-checking until the server is ready, and graceful shutdown.
 */

import { ChildProcess, spawn, execSync } from 'child_process';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import http from 'http';
import log from 'electron-log';

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

class ServerManager {
  private process: ChildProcess | null = null;
  private port: number = 8300;

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

    const pythonPath = this.getPythonPath();
    if (!pythonPath) {
      const msg = 'Could not find a Python interpreter. Please install Python 3.10+.';
      log.error(msg);
      return { success: false, error: msg };
    }

    const backendPath = this.getBackendPath();
    if (!fs.existsSync(backendPath)) {
      const msg = `Backend directory not found: ${backendPath}`;
      log.error(msg);
      return { success: false, error: msg };
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
        // On Windows, detach so the child survives briefly during shutdown
        detached: process.platform !== 'win32',
      });

      // Pipe stdout / stderr to electron-log
      this.process.stdout?.on('data', (data: Buffer) => {
        log.info('[backend]', data.toString().trimEnd());
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        log.warn('[backend:err]', data.toString().trimEnd());
      });

      this.process.on('exit', (code, signal) => {
        log.info('Backend process exited — code=%s signal=%s', code, signal);
        this.process = null;
      });

      this.process.on('error', (err) => {
        log.error('Backend process error:', err);
        this.process = null;
      });

      // Wait for the health endpoint to respond
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
   * Stop the backend server gracefully.
   * Sends SIGTERM, waits up to 3 s, then SIGKILL if still alive.
   * Also kills any lingering tmux sessions prefixed with 'aichttr-'.
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
          execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
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
   * Resolve the absolute path to the backend directory.
   * In dev mode it lives at ../backend relative to the desktop folder.
   * In a packaged build it is in process.resourcesPath/backend.
   */
  private getBackendPath(): string {
    if (this.isPackaged()) {
      return path.join(process.resourcesPath, 'backend');
    }
    // Dev: desktop/ sits next to backend/
    return path.resolve(__dirname, '..', '..', 'backend');
  }

  /**
   * Locate a working Python interpreter.
   * Priority:
   *   1. Virtual-env python inside the backend directory
   *   2. `python3` on PATH
   *   3. `python` on PATH
   */
  private getPythonPath(): string | null {
    const backendPath = this.getBackendPath();

    // Check for a virtual environment inside the backend dir
    const venvCandidates = process.platform === 'win32'
      ? [
          path.join(backendPath, 'venv', 'Scripts', 'python.exe'),
          path.join(backendPath, '.venv', 'Scripts', 'python.exe'),
        ]
      : [
          path.join(backendPath, 'venv', 'bin', 'python'),
          path.join(backendPath, '.venv', 'bin', 'python'),
          path.join(backendPath, 'venv', 'bin', 'python3'),
          path.join(backendPath, '.venv', 'bin', 'python3'),
        ];

    for (const venvPy of venvCandidates) {
      if (fs.existsSync(venvPy)) {
        log.info('Found venv Python at %s', venvPy);
        return venvPy;
      }
    }

    // Fall back to system Python
    const systemCandidates = process.platform === 'win32'
      ? ['python', 'python3']
      : ['python3', 'python'];

    for (const cmd of systemCandidates) {
      try {
        const result = execSync(`${cmd} --version`, { stdio: 'pipe', timeout: 5000 });
        log.info('Found system Python: %s → %s', cmd, result.toString().trim());
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

    return new Promise((resolve, reject) => {
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
          // Consume response data to free up memory
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
    });
  }

  /**
   * Kill any tmux sessions prefixed with 'aichttr-' (agent sessions).
   * Fails silently if tmux is not installed.
   */
  private killTmuxSessions(): void {
    try {
      execSync("tmux list-sessions -F '#{session_name}' 2>/dev/null | grep '^aichttr-' | xargs -I{} tmux kill-session -t {}", {
        stdio: 'ignore',
        timeout: 5000,
      });
    } catch {
      // tmux not installed or no matching sessions — that is fine
    }
  }
}

/** Singleton server manager instance */
export const serverManager = new ServerManager();
