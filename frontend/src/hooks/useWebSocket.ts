import { useEffect, useRef } from 'react';
import { WebSocketClient } from '../lib/ws';
import { useChatStore } from '../stores/chatStore';
import { SoundManager } from '../lib/sounds';
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
    activeChannel,
    setAgents,
    setTyping,
    updateJob,
    setRules,
    setChannels,
    pinMessage,
    deleteMessages,
    reactMessage,
    addActivity,
    setWsState,
  } = useChatStore();

  useEffect(() => {
    let client: WebSocketClient;
    try {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/ws`;
      client = new WebSocketClient(wsUrl);
      wsRef.current = client;
    } catch {
      return;
    }

    // Track connection state
    const unsubState = client.onStateChange((s) => setWsState(s));

    const unsub = client.subscribe((event) => {
      try {
        const parsed: WSEvent = JSON.parse(event.data);
        switch (parsed.type) {
          case 'message':
            addMessage(parsed.data);
            if (parsed.data.channel !== activeChannel) {
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
          case 'rule_update':
            setRules(parsed.data.rules);
            break;
          case 'channel_update':
            setChannels(parsed.data.channels);
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

    return () => {
      try {
        unsub();
        unsubState();
        client.disconnect();
      } catch {}
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return wsRef;
}
