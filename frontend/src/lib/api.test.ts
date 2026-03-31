import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import after mock
import { api } from './api';

describe('api', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  it('getStatus returns agent list', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ agents: [{ name: 'claude', state: 'online' }], version: '4.5.0' }),
    });
    const result = await api.getStatus();
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].name).toBe('claude');
  });

  it('getMessages returns messages for channel', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages: [{ id: 1, text: 'hello', sender: 'user' }] }),
    });
    const result = await api.getMessages('general');
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].text).toBe('hello');
  });

  it('sendMessage posts to API', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 42, text: 'test' }),
    });
    const result = await api.sendMessage('test', 'general', 'user');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/send'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.id).toBe(42);
  });

  it('handles API errors gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'server error',
    });
    await expect(api.getStatus()).rejects.toThrow();
  });

  it('saveSettings sends POST with settings body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });
    await api.saveSettings({ theme: 'cyberpunk' });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/settings'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ theme: 'cyberpunk' }),
      }),
    );
  });

  it('createChannel sends POST with channel name', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ name: 'dev' }),
    });
    await api.createChannel('dev');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/channels'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'dev' }),
      }),
    );
  });

  it('deleteChannel sends DELETE', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });
    await api.deleteChannel('dev');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/channels/dev'),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('getMessages supports since_id parameter', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages: [] }),
    });
    await api.getMessages('general', 42);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('since_id=42'),
      expect.anything(),
    );
  });

  it('spawnAgent sends POST with agent config', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, pid: 1234, base: 'claude', message: 'spawned' }),
    });
    await api.spawnAgent('claude', 'Claude', '/project', ['--flag']);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/spawn-agent'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('handles network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    await expect(api.getStatus()).rejects.toThrow('Network error');
  });
});
