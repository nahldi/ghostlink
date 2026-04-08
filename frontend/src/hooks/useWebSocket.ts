import { useEffect, useRef } from 'react';
import { WebSocketClient } from '../lib/ws';
import { useChatStore } from '../stores/chatStore';
import { SoundManager } from '../lib/sounds';
import { api } from '../lib/api';
import { getRemoteAccessToken } from '../lib/remoteAccess';
import { toast } from '../components/Toast';
import type { WSEvent } from '../types';

function updateFaviconBadge(count: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Draw base icon
  ctx.fillStyle = '#7c3aed';
  ctx.beginPath();
  ctx.arc(16, 16, 16, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('\u2726', 16, 16); // star

  if (count > 0) {
    // Draw badge
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(24, 8, 8, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px Inter, sans-serif';
    ctx.fillText(count > 9 ? '9+' : String(count), 24, 9);
  }

  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = canvas.toDataURL('image/png');
}

export function useWebSocket() {
  const wsRef = useRef<WebSocketClient | null>(null);
  const {
    addMessage,
    incrementUnread,
    setAgents,
    setTyping,
    updateJob,
    upsertTask,
    updateTaskProgress,
    setRules,
    setChannels,
    setChannelContext,
    pinMessage,
    deleteMessages,
    reactMessage,
    addActivity,
    setThinkingStream,
    updateMessageMeta,
    appendToMessage,
    setWsState,
    setAgentPresence,
    setBrowserState,
    setTerminalStream,
    addWorkspaceChange,
    setWorkspaceChanges,
    addAgentReplayEvent,
    setAgentReplayEvents,
    setFileDiff,
    setCollaborators,
    setWorkspaceInvites,
    addMcpInvocation,
    markAgentDrift,
    setPendingAgentsMdDiff,
  } = useChatStore();
  const activeChannel = useChatStore((s) => s.activeChannel);
  const sidebarPanel = useChatStore((s) => s.sidebarPanel);
  const cockpitAgent = useChatStore((s) => s.cockpitAgent);
  const replyTo = useChatStore((s) => s.replyTo);
  const username = useChatStore((s) => s.settings.username);

  useEffect(() => {
    let client: WebSocketClient | null = null;
    let unsub: (() => void) | null = null;
    let unsubState: (() => void) | null = null;
    let unsubReconnect: (() => void) | null = null;
    let cancelled = false;

    async function initWs() {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      let wsUrl = `${proto}//${window.location.host}/ws`;

      // If accessed remotely (not localhost), try to get WS auth token
      const isRemote = !['localhost', '127.0.0.1', '[::1]'].some(h => window.location.hostname === h);
      if (isRemote) {
        const accessToken = getRemoteAccessToken();
        if (accessToken) {
          wsUrl += `?access_token=${encodeURIComponent(accessToken)}`;
        }
      }

      if (cancelled) return;
      client = new WebSocketClient(wsUrl);
      wsRef.current = client;

      const sendWorkspacePresence = () => {
        if (!client) return;
        const state = useChatStore.getState();
        const viewing = state.sidebarPanel === 'cockpit' && state.cockpitAgent
          ? `Cockpit: ${state.cockpitAgent}`
          : `Channel: ${state.activeChannel}`;
        client.send({
          type: 'workspace_presence',
          username: state.settings.username || 'You',
          viewing,
          status: 'active',
          cursor: { channel: state.activeChannel, ...(state.replyTo?.id ? { messageId: state.replyTo.id } : {}) },
        });
      };

      // Track connection state
      unsubState = client.onStateChange((s) => {
        setWsState(s);
        if (s === 'connected') {
          sendWorkspacePresence();
        }
      });

      // Fetch missed messages on reconnect — throttled to avoid request storms
      unsubReconnect = client.onReconnect(async () => {
        try {
          const state = useChatStore.getState();

          // 1. Agent status — single call, always needed
          const status = await api.getStatus().catch(() => ({ agents: state.agents }));
          if (status?.agents) {
            setAgents(status.agents);
          }

          // 2. Missed messages — active channel first, then others sequentially
          const lastMsg = state.messages[state.messages.length - 1];
          const sinceId = lastMsg?.id || 0;
          if (sinceId > 0) {
            // Active channel first (user sees this immediately)
            try {
              const resp = await api.getMessages(state.activeChannel, sinceId);
              for (const msg of resp.messages || []) state.addMessage(msg);
            } catch { /* channel may not exist */ }

            // Other channels sequentially (background, not blocking UI)
            const otherChannels = state.channels.map((c) => c.name).filter((n) => n !== state.activeChannel);
            for (const ch of otherChannels) {
              try {
                const resp = await api.getMessages(ch, sinceId);
                for (const msg of resp.messages || []) state.addMessage(msg);
              } catch { /* channel may not exist */ }
            }
          }

          // 3. Agent state — only online agents, 3 at a time max
          const onlineAgents = (status?.agents || state.agents || [])
            .filter((a) => a.state === 'active' || a.state === 'thinking' || a.state === 'idle')
            .map((a) => a.name);

          const CONCURRENCY = 3;
          for (let i = 0; i < onlineAgents.length; i += CONCURRENCY) {
            const batch = onlineAgents.slice(i, i + CONCURRENCY);
            await Promise.all(batch.map(async (agentName) => {
              const [presence, browser, terminal, workspace, replay] = await Promise.all([
                api.getAgentPresence(agentName).catch(() => null),
                api.getAgentBrowserState(agentName).catch(() => null),
                api.getAgentTerminalLive(agentName).catch(() => null),
                api.getAgentWorkspaceChanges(agentName).catch(() => null),
                api.getAgentReplay(agentName).catch(() => null),
              ]);
              if (presence) setAgentPresence(presence);
              if (browser) setBrowserState(browser);
              if (terminal) setTerminalStream(terminal);
              if (workspace?.changes) setWorkspaceChanges(agentName, workspace.changes);
              if (replay?.events) setAgentReplayEvents(agentName, replay.events);
            }));
          }

          // 4. Workspace collaborators — low priority, after agents
          const [collaborators, invites] = await Promise.all([
            fetch('/api/workspace/collaborators').then((r) => r.ok ? r.json() : { collaborators: [] }).catch(() => ({ collaborators: [] })),
            fetch('/api/workspace/invites').then((r) => r.ok ? r.json() : { invites: [] }).catch(() => ({ invites: [] })),
          ]);
          setCollaborators(collaborators.collaborators || []);
          setWorkspaceInvites(invites.invites || []);
        } catch (e) {
          console.warn('Failed to fetch missed messages on reconnect:', e instanceof Error ? e.message : String(e));
        }
      });

      unsub = client.subscribe((event) => {
        try {
          const parsed: WSEvent = JSON.parse(event.data);
          if (!parsed.type || !parsed.data) return;
        switch (parsed.type) {
          case 'message':
            addMessage(parsed.data);
            if (parsed.data.channel !== useChatStore.getState().activeChannel) {
              incrementUnread(parsed.data.channel);
            }
            // Notifications for agent messages when tab is blurred
            if (document.hidden && parsed.data.sender) {
              const settings = useChatStore.getState().settings;
              const isAgent = parsed.data.sender !== settings.username && parsed.data.sender !== 'You';

              // Check quiet hours
              const hour = new Date().getHours();
              const qStart = settings.quietHoursStart;
              const qEnd = settings.quietHoursEnd;
              const quiet = qStart < qEnd ? (hour >= qStart && hour < qEnd) : (hour >= qStart || hour < qEnd);

              if (isAgent && !quiet) {
                // Sound notification
                if (settings.notificationSounds) {
                  const agents = useChatStore.getState().agents;
                  const agent = agents.find(a => a.name === parsed.data.sender);
                  SoundManager.play(agent?.base || 'default');
                }
                // Desktop notification
                if (settings.desktopNotifications && 'Notification' in window && Notification.permission === 'granted') {
                  const agents = useChatStore.getState().agents;
                  const agent = agents.find(a => a.name === parsed.data.sender);
                  const title = agent?.label || parsed.data.sender;
                  const body = parsed.data.text.length > 100 ? parsed.data.text.slice(0, 100) + '...' : parsed.data.text;
                  new Notification(title, { body, icon: '/favicon.ico', tag: 'ghostlink-' + parsed.data.id });
                }
              }
            }
            break;
          case 'typing':
            setTyping(parsed.data.sender, parsed.data.channel);
            break;
          case 'status':
            setAgents(parsed.data.agents);
            break;
          case 'job_update':
            updateJob(parsed.data);
            break;
          case 'task_update':
            upsertTask(parsed.data);
            break;
          case 'task_progress':
            updateTaskProgress(parsed.data.task_id, parsed.data);
            break;
          case 'rule_update':
            setRules(parsed.data.rules);
            break;
          case 'channel_update':
            setChannels(parsed.data.channels);
            break;
          case 'channel_context':
            setChannelContext(parsed.data.channel, parsed.data.context);
            break;
          case 'pin':
            pinMessage(parsed.data.message_id, parsed.data.pinned);
            break;
          case 'delete':
            deleteMessages(parsed.data.message_ids);
            break;
          case 'reaction':
            reactMessage(parsed.data.message_id, parsed.data.reactions);
            break;
          case 'activity':
            addActivity(parsed.data);
            break;
          case 'thinking_stream':
            setThinkingStream(parsed.data.agent, parsed.data.text || '', parsed.data.active ?? false);
            break;
          case 'agent_presence':
            setAgentPresence(parsed.data);
            break;
          case 'browser_state':
            setBrowserState(parsed.data);
            break;
          case 'terminal_stream':
            setTerminalStream(parsed.data);
            break;
          case 'mcp_invocation':
            if (parsed.data?.agent && parsed.data?.entry) {
              addMcpInvocation(parsed.data.agent, parsed.data.entry);
            }
            break;
          case 'identity_drift':
            if (parsed.data?.agent) {
              markAgentDrift(parsed.data.agent, true);
              toast(`${parsed.data.agent} drift detected${parsed.data.reason ? `: ${parsed.data.reason}` : ''}`, 'warning');
            }
            break;
          case 'memory_conflict':
            if (parsed.data?.key) {
              const agents = Array.isArray(parsed.data.agents) && parsed.data.agents.length > 0 ? ` (${parsed.data.agents.join(', ')})` : '';
              toast(`Memory conflict: ${parsed.data.key}${agents}`, 'warning');
            }
            break;
          case 'cache_alert':
            if (parsed.data?.provider) {
              const streak = typeof parsed.data.consecutive_misses === 'number' ? ` | ${parsed.data.consecutive_misses} miss streak` : '';
              const rate = typeof parsed.data.cache_hit_rate === 'number' ? ` | ${Math.round(parsed.data.cache_hit_rate * 100)}% hit rate` : '';
              toast(`Cache alert: ${parsed.data.provider}${rate}${streak}`, 'warning');
            }
            break;
          case 'agents_md_changed':
            setPendingAgentsMdDiff(parsed.data);
            window.dispatchEvent(new CustomEvent('ghostlink:agents-md-changed'));
            toast('AGENTS.md changed. Review import before applying.', 'info');
            break;
          case 'workspace_change':
            addWorkspaceChange(parsed.data);
            break;
          case 'workspace_presence':
            setCollaborators(parsed.data.collaborators || []);
            break;
          case 'workspace_invites':
            setWorkspaceInvites(parsed.data.invites || []);
            break;
          case 'agent_replay':
            addAgentReplayEvent(parsed.data);
            break;
          case 'file_diff':
            setFileDiff({
              agent: parsed.data.agent,
              path: parsed.data.path,
              action: parsed.data.action,
              diff: parsed.data.diff,
              before: '',
              after: '',
              timestamp: parsed.data.timestamp,
            });
            break;
          case 'token_stream': {
            // v4.3.0: Real-time token streaming — append tokens to existing message
            const { message_id, token, done } = parsed.data;
            if (message_id && token) {
              appendToMessage(message_id, token);
            }
            if (done) {
              // Mark message as complete (stop streaming indicator)
              updateMessageMeta(message_id, { streaming: false });
            }
            break;
          }
          case 'approval_response':
            if (parsed.data.message_id) {
              updateMessageMeta(parsed.data.message_id, { responded: parsed.data.response });
            }
            break;
          case 'session_update':
            // Dispatch custom event for SessionBar to pick up
            window.dispatchEvent(new CustomEvent('ghostlink:session-update', { detail: parsed.data }));
            break;
          case 'system':
            // Handle server shutdown — stop reconnecting and notify user
            if (parsed.data?.event === 'server_shutdown') {
              client?.disconnect();
            }
            break;
        }

        // Update favicon badge with total unread count
        const state = useChatStore.getState();
        const totalUnread = state.channels.reduce((sum, ch) => sum + ch.unread, 0);
        updateFaviconBadge(totalUnread);
        } catch {
          // ignore parse errors or handler errors — never crash
        }
      });

      try {
        client.connect();
      } catch {
        // WebSocket connection failed — app still works via REST
      }
    }

    initWs();

    return () => {
      cancelled = true;
      try {
        unsub?.();
        unsubState?.();
        unsubReconnect?.();
        client?.disconnect();
      } catch { /* ignored */ }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- Safe: runs once on mount; store reads use getState() at handler time.

  useEffect(() => {
    const client = wsRef.current;
    if (!client || client.state !== 'connected') return;
    const viewing = sidebarPanel === 'cockpit' && cockpitAgent
      ? `Cockpit: ${cockpitAgent}`
      : `Channel: ${activeChannel}`;
    client.send({
      type: 'workspace_presence',
      username: username || 'You',
      viewing,
      status: document.hidden ? 'away' : 'active',
      cursor: { channel: activeChannel, ...(replyTo?.id ? { messageId: replyTo.id } : {}) },
    });
  }, [activeChannel, cockpitAgent, replyTo?.id, sidebarPanel, username]);

  useEffect(() => {
    const updateVisibility = () => {
      const client = wsRef.current;
      if (!client || client.state !== 'connected') return;
      const state = useChatStore.getState();
      const viewing = state.sidebarPanel === 'cockpit' && state.cockpitAgent
        ? `Cockpit: ${state.cockpitAgent}`
        : `Channel: ${state.activeChannel}`;
      client.send({
        type: 'workspace_presence',
        username: state.settings.username || 'You',
        viewing,
        status: document.hidden ? 'away' : 'active',
        cursor: { channel: state.activeChannel, ...(state.replyTo?.id ? { messageId: state.replyTo.id } : {}) },
      });
    };
    document.addEventListener('visibilitychange', updateVisibility);
    return () => document.removeEventListener('visibilitychange', updateVisibility);
  }, []);

  return wsRef;
}
