type WSCallback = (event: MessageEvent) => void;

export type WSState = 'connected' | 'connecting' | 'disconnected';

export class WebSocketClient {
  private url: string;
  private ws: WebSocket | null = null;
  private listeners: Set<WSCallback> = new Set();
  private stateListeners: Set<(s: WSState) => void> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxDelay = 30000;
  private shouldReconnect = true;
  private _state: WSState = 'disconnected';

  constructor(url: string) {
    this.url = url;
  }

  get state(): WSState {
    return this._state;
  }

  private setState(s: WSState) {
    this._state = s;
    this.stateListeners.forEach((cb) => {
      try { cb(s); } catch {}
    });
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    this.setState('connecting');
    try {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => {
        this.reconnectDelay = 1000;
        this.setState('connected');
      };
      this.ws.onmessage = (event) => {
        this.listeners.forEach((cb) => {
          try { cb(event); } catch {}
        });
      };
      this.ws.onclose = () => {
        this.setState('disconnected');
        if (this.shouldReconnect) this.scheduleReconnect();
      };
      this.ws.onerror = () => {
        try { this.ws?.close(); } catch {}
      };
    } catch {
      this.setState('disconnected');
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxDelay);
      this.connect();
    }, this.reconnectDelay);
  }

  send(data: unknown) {
    try {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(data));
      }
    } catch {}
  }

  subscribe(cb: WSCallback) {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  onStateChange(cb: (s: WSState) => void) {
    this.stateListeners.add(cb);
    return () => { this.stateListeners.delete(cb); };
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    try { this.ws?.close(); } catch {}
    this.setState('disconnected');
  }
}
