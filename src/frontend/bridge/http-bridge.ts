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
    // In Electron, use the native open-folder dialog via preload IPC
    // (better UX, OS-native picker). In web mode, fall through to
    // the in-app FolderPickerModal that dispatches a custom event.
    const electronAPI = (window as unknown as { electronAPI?: { openProjectDialog?: () => Promise<string | null> } }).electronAPI;
    if (electronAPI?.openProjectDialog) {
      return electronAPI.openProjectDialog();
    }
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
    // The handlers array has the unknown-payload shape; the bridge
    // narrows on dispatch (`payload as { phase, progress }`).
    const handler: WSHandler = { type: 'scan-progress', callback: callback as WSHandler['callback'] };
    handlers.push(handler);
    return () => {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    };
  },

  onAgentEvent: (callback) => {
    ensureWebSocket();
    const handler: WSHandler = { type: 'agent-event', callback: callback as WSHandler['callback'] };
    handlers.push(handler);
    return () => {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    };
  },
};
