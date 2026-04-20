import type { BridgeAPI } from './types';

const API_BASE = '/api';
const WS_URL = `ws://${window.location.host}/ws`;

type WSHandler = { type: string; callback: (payload: unknown) => void };

let ws: WebSocket | null = null;
const handlers: WSHandler[] = [];
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function ensureWebSocket(): void {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  if (ws && ws.readyState === WebSocket.CONNECTING) return;

  ws = new WebSocket(WS_URL);

  ws.onmessage = (event) => {
    try {
      const { type, payload } = JSON.parse(event.data);
      for (const h of handlers) {
        if (h.type === type) h.callback(payload);
      }
    } catch {
      // ignore malformed messages
    }
  };

  ws.onclose = () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => ensureWebSocket(), 3000);
  };

  ws.onerror = () => {
    ws?.close();
  };
}

/**
 * HTTP + WebSocket bridge for web mode.
 * REST calls for request/response, WebSocket for real-time events.
 */
export const httpBridge: BridgeAPI = {
  openProjectDialog: async () => {
    // In web mode, this is handled by the FolderPickerModal component
    // which dispatches a custom event. We return a promise that resolves
    // when the user picks a folder.
    return new Promise<string | null>((resolve) => {
      const handler = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        window.removeEventListener('folder-picked', handler);
        resolve(detail?.path || null);
      };
      window.addEventListener('folder-picked', handler);
      window.dispatchEvent(new CustomEvent('open-folder-picker'));
    });
  },

  scanProject: async (projectPath: string) => {
    const res = await fetch(`${API_BASE}/project/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath }),
    });
    return res.json();
  },

  searchSymbols: async (query: string) => {
    const res = await fetch(`${API_BASE}/symbols/search?q=${encodeURIComponent(query)}`);
    return res.json();
  },

  getMcpStatus: async () => {
    const res = await fetch(`${API_BASE}/mcp/status`);
    return res.json();
  },

  onScanProgress: (callback) => {
    ensureWebSocket();
    const handler = { type: 'scan-progress', callback };
    handlers.push(handler);
    return () => {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    };
  },

  onAgentEvent: (callback) => {
    ensureWebSocket();
    const handler = { type: 'agent-event', callback };
    handlers.push(handler);
    return () => {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    };
  },
};
