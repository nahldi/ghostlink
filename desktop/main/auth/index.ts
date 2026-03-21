/**
 * AuthManager — coordinates authentication checks across all AI providers.
 * Exposes a singleton that the main process uses to check status & trigger logins.
 */

import { checkAnthropic, loginAnthropic } from './anthropic';
import { checkOpenAI, loginOpenAI } from './openai';
import { checkGoogle, loginGoogle } from './google';
import { checkGitHub, loginGitHub } from './github';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AuthStatus {
  provider: string;        // Internal key (anthropic, openai, google, github)
  name: string;            // Display name shown in UI
  authenticated: boolean;
  user?: string;           // Username / email if authenticated
  error?: string;          // Human-readable error when auth fails
  icon: string;            // Provider icon identifier for the renderer
  color: string;           // Brand color hex
  command: string;         // CLI command name
}

// ── Provider registry ────────────────────────────────────────────────────────

interface ProviderEntry {
  check: () => Promise<AuthStatus>;
  login: () => Promise<void>;
}

const providers: Record<string, ProviderEntry> = {
  anthropic: { check: checkAnthropic, login: loginAnthropic },
  openai:    { check: checkOpenAI,    login: loginOpenAI },
  google:    { check: checkGoogle,    login: loginGoogle },
  github:    { check: checkGitHub,    login: loginGitHub },
};

// ── AuthManager class ────────────────────────────────────────────────────────

class AuthManager {
  /**
   * Check authentication status for every registered provider.
   * Runs all checks in parallel for speed.
   */
  async checkAll(): Promise<AuthStatus[]> {
    const keys = Object.keys(providers);
    const results = await Promise.allSettled(
      keys.map((k) => providers[k].check()),
    );

    return results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      // If the promise itself rejects, build a safe fallback status
      return {
        provider: keys[i],
        name: keys[i],
        authenticated: false,
        error: r.reason?.message ?? 'Unknown error',
        icon: keys[i],
        color: '#888888',
        command: keys[i],
      } as AuthStatus;
    });
  }

  /**
   * Check a single provider by key.
   */
  async check(provider: string): Promise<AuthStatus> {
    const entry = providers[provider];
    if (!entry) {
      return {
        provider,
        name: provider,
        authenticated: false,
        error: `Unknown provider: ${provider}`,
        icon: provider,
        color: '#888888',
        command: provider,
      };
    }
    try {
      return await entry.check();
    } catch (err: any) {
      return {
        provider,
        name: provider,
        authenticated: false,
        error: err.message ?? 'Check failed',
        icon: provider,
        color: '#888888',
        command: provider,
      };
    }
  }

  /**
   * Open a terminal window so the user can complete interactive login.
   */
  async login(provider: string): Promise<void> {
    const entry = providers[provider];
    if (!entry) throw new Error(`Unknown provider: ${provider}`);
    await entry.login();
  }
}

// ── Singleton export ─────────────────────────────────────────────────────────

const authManager = new AuthManager();
export default authManager;
