import { useEffect, useRef } from 'react';
import { WebSocketClient } from '../lib/ws';
import { useChatStore } from '../stores/chatStore';
import { SoundManager } from '../lib/sounds';
import type { WSEvent } from '../types';

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

    const unsub = client.subscribe((event) => {
      try {
        const parsed: WSEvent = JSON.parse(event.data);
        switch (parsed.type) {
          case 'message':
            addMessage(parsed.data);
            if (parsed.data.channel !== activeChannel) {
              incrementUnread(parsed.data.channel);
            }
            // Play notification sound for agent messages when tab is blurred
            if (document.hidden && parsed.data.sender) {
              const settings = useChatStore.getState().settings;
              if (settings.notificationSounds && parsed.data.sender !== settings.username && parsed.data.sender !== 'You') {
                const agents = useChatStore.getState().agents;
                const agent = agents.find(a => a.name === parsed.data.sender);
                SoundManager.play(agent?.base || 'default');
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
        }
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
        client.disconnect();
      } catch {}
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return wsRef;
}
