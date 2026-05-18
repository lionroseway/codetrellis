/**
 * IPC shim for the Electron renderer.
 *
 * Replaces the older "fetch over a TCP backend port" path with a
 * pure-IPC bridge: any `fetch('/api/...')` call is intercepted and
 * forwarded through `window.codetrellisIpc.api()` to the main
 * process, which dispatches it through the Express app in-memory.
 * Same applies to `new WebSocket(...)` — the global `WebSocket`
 * class is replaced with one whose events are sourced from
 * `window.codetrellisIpc.onWsEvent()` (i.e. backend `broadcast()`
 * calls forwarded over IPC).
 *
 * The result: the desktop app **never opens a backend TCP port**.
 * Only the MCP server (port 19432) is bound, because external
 * agents need a stable URL. All other backend traffic stays
 * in-process.
 *
 * Web mode (`npm run dev`) doesn't load this module — the browser
 * keeps using native fetch + native WebSocket against the dev
 * backend on :3001. The shim is gated by `?ipc=1` (set by Electron
 * main on the renderer URL) so even if it's loaded under a regular
 * browser, it's a no-op.
 *
 * Idempotent: calling twice is a no-op.
 */

interface IpcRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | null;
}

interface IpcResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

interface BroadcastMessage {
  type: string;
  payload: unknown;
}

interface TerminalMessage {
  type: string;
  data?: string;
  code?: number;
}

interface CodetrellisIpcBridge {
  api: (req: IpcRequest) => Promise<IpcResponse>;
  onWsEvent: (cb: (msg: BroadcastMessage) => void) => () => void;
  terminalSend: (termId: string, data: { type: string; [key: string]: unknown }) => void;
  onTerminalData: (termId: string, cb: (msg: TerminalMessage) => void) => () => void;
}

declare global {
  interface Window {
    codetrellisIpc?: CodetrellisIpcBridge;
  }
}

const PATCHED_FLAG = '__codetrellisIpcShimInstalled';

export function installElectronIpcShim(): void {
  if (typeof window === 'undefined') return;

  // Activation gate: the renderer URL has `?ipc=1` only when
  // launched by Electron main. Without it, this module is a no-op
  // (web mode doesn't go anywhere near here).
  const params = new URLSearchParams(window.location.search);
  if (params.get('ipc') !== '1') return;

  // Idempotent
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any)[PATCHED_FLAG]) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any)[PATCHED_FLAG] = true;

  const bridge = window.codetrellisIpc;
  if (!bridge || typeof bridge.api !== 'function' || typeof bridge.onWsEvent !== 'function') {
    console.error(
      '[IpcShim] window.codetrellisIpc bridge missing — preload may have failed to load. ' +
        'Falling through to native fetch / WebSocket which will 404 on a file:// origin.',
    );
    return;
  }

  console.log('[IpcShim] Active — /api fetches and WebSockets routed through Electron IPC');

  installFetchShim(bridge);
  installWebSocketShim(bridge);

  surfaceBackendError(params);
}

// =============================================================
// fetch
// =============================================================

function installFetchShim(bridge: CodetrellisIpcBridge): void {
  const origFetch = window.fetch.bind(window);

  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = extractApiPath(input);
    if (path === null) {
      // Not a /api/... call — let native fetch handle it (assets,
      // external URLs, etc.).
      return origFetch(input, init);
    }
    return ipcFetch(bridge, path, init, input);
  }) as typeof window.fetch;
}

function extractApiPath(input: RequestInfo | URL): string | null {
  // Strings: bare path or full URL.
  if (typeof input === 'string') {
    if (input.startsWith('/api') || input.startsWith('/ws')) return input;
    if (input.startsWith('http://localhost') || input.startsWith('http://127.0.0.1')) {
      try {
        const u = new URL(input);
        if (u.pathname.startsWith('/api')) return u.pathname + u.search;
      } catch {
        /* malformed — fall through */
      }
    }
    return null;
  }
  if (input instanceof URL) {
    if (input.pathname.startsWith('/api')) return input.pathname + input.search;
    return null;
  }
  // Request object — read .url and recurse.
  if (typeof input === 'object' && 'url' in input && typeof input.url === 'string') {
    return extractApiPath(input.url);
  }
  return null;
}

async function ipcFetch(
  bridge: CodetrellisIpcBridge,
  path: string,
  init: RequestInit | undefined,
  originalInput: RequestInfo | URL,
): Promise<Response> {
  const method = (init?.method ?? (originalInput instanceof Request ? originalInput.method : 'GET'))
    .toString()
    .toUpperCase();

  const headers: Record<string, string> = {};
  const initHeaders = init?.headers;
  if (initHeaders) {
    if (initHeaders instanceof Headers) {
      initHeaders.forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
    } else if (Array.isArray(initHeaders)) {
      for (const [k, v] of initHeaders) headers[k.toLowerCase()] = v;
    } else {
      for (const [k, v] of Object.entries(initHeaders)) {
        if (typeof v === 'string') headers[k.toLowerCase()] = v;
      }
    }
  }

  // Body — coerce to string. The dispatcher accepts strings or
  // Uint8Arrays; we send strings because all our /api/* endpoints
  // are JSON / form-encoded. If a route ever takes raw bytes, we'd
  // base64 here.
  let body: string | null = null;
  const bodyInit = init?.body;
  if (bodyInit != null) {
    if (typeof bodyInit === 'string') {
      body = bodyInit;
    } else if (bodyInit instanceof URLSearchParams) {
      body = bodyInit.toString();
      if (!('content-type' in headers)) {
        headers['content-type'] = 'application/x-www-form-urlencoded';
      }
    } else if (bodyInit instanceof FormData) {
      // FormData isn't currently used by /api/* but defend against
      // it anyway. multipart parsing in our dispatcher would be a
      // bigger lift; treat as opaque for now.
      throw new Error('[IpcShim] FormData bodies are not supported by IPC fetch yet');
    } else if (typeof bodyInit === 'object' && 'byteLength' in bodyInit) {
      // Buffer / typed array — decode as utf-8 (works for JSON-like
      // payloads, which is everything our renderer sends).
      const bytes = bodyInit as ArrayBufferView;
      body = new TextDecoder().decode(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      );
    } else {
      body = String(bodyInit);
    }
  }

  let res: IpcResponse;
  try {
    res = await bridge.api({ method, url: path, headers, body });
  } catch (err) {
    // IPC channel itself failed (preload missing, main crashed, etc.)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    );
  }

  return new Response(res.body, {
    status: res.status,
    headers: res.headers,
  });
}

// =============================================================
// WebSocket
// =============================================================

/**
 * Drop-in WebSocket replacement that sources its `message` events
 * from `window.codetrellisIpc.onWsEvent`. Anything that does
 * `new WebSocket('ws://...')` ends up listening to backend
 * broadcasts via IPC.
 *
 * Most consumers (`useWebSocket` etc.) only use:
 *   - `addEventListener('message', cb)` / `onmessage = cb`
 *   - `addEventListener('open', cb)` / `onopen = cb`
 *   - `addEventListener('close', cb)` / `onclose = cb`
 *   - `addEventListener('error', cb)` / `onerror = cb`
 *   - `readyState`
 *   - `close()`
 *   - `send(...)` — we no-op this; the renderer doesn't need to
 *     push WS messages back (broadcasts are one-way).
 */
function installWebSocketShim(bridge: CodetrellisIpcBridge): void {
  /**
   * Extract terminal ID from a WebSocket URL like
   * `ws://localhost:3001/terminal-ws?id=term-1-abc123`.
   * Returns null if this isn't a terminal URL.
   */
  function extractTerminalId(url: string): string | null {
    try {
      // The URL might be ws:// or wss:// — parse it as http to
      // extract the pathname + query reliably.
      const u = new URL(url.replace(/^ws/, 'http'));
      if (u.pathname === '/terminal-ws') {
        return u.searchParams.get('id');
      }
    } catch { /* not a valid URL */ }
    return null;
  }

  /** Broadcast-only WebSocket (event channel /ws). */
  class IpcBroadcastWebSocket extends EventTarget implements WebSocket {
    readonly url: string;
    readonly protocol = '';
    readonly extensions = '';
    readonly bufferedAmount = 0;
    binaryType: BinaryType = 'blob';
    readyState: number = 0;
    onopen: ((this: WebSocket, ev: Event) => void) | null = null;
    onclose: ((this: WebSocket, ev: CloseEvent) => void) | null = null;
    onmessage: ((this: WebSocket, ev: MessageEvent) => void) | null = null;
    onerror: ((this: WebSocket, ev: Event) => void) | null = null;

    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSING = 2;
    readonly CLOSED = 3;

    private unsubscribe: (() => void) | null = null;

    constructor(url: string | URL, _protocols?: string | string[]) {
      super();
      this.url = typeof url === 'string' ? url : url.toString();
      queueMicrotask(() => {
        this.unsubscribe = bridge.onWsEvent((msg) => {
          const wireMessage = JSON.stringify(msg);
          const ev = new MessageEvent('message', { data: wireMessage });
          this.onmessage?.call(this as unknown as WebSocket, ev);
          this.dispatchEvent(ev);
        });
        this.readyState = this.OPEN;
        const openEv = new Event('open');
        this.onopen?.call(this as unknown as WebSocket, openEv);
        this.dispatchEvent(openEv);
      });
    }

    send(_data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
      // No-op — broadcast channel is one-way.
    }

    close(code = 1000, reason = ''): void {
      if (this.readyState === this.CLOSED) return;
      this.readyState = this.CLOSING;
      this.unsubscribe?.();
      this.unsubscribe = null;
      queueMicrotask(() => {
        this.readyState = this.CLOSED;
        const ev = new CloseEvent('close', { code, reason, wasClean: true });
        this.onclose?.call(this as unknown as WebSocket, ev);
        this.dispatchEvent(ev);
      });
    }
  }

  /** Bidirectional WebSocket for terminal PTY I/O. */
  class IpcTerminalWebSocket extends EventTarget implements WebSocket {
    readonly url: string;
    readonly protocol = '';
    readonly extensions = '';
    readonly bufferedAmount = 0;
    binaryType: BinaryType = 'blob';
    readyState: number = 0;
    onopen: ((this: WebSocket, ev: Event) => void) | null = null;
    onclose: ((this: WebSocket, ev: CloseEvent) => void) | null = null;
    onmessage: ((this: WebSocket, ev: MessageEvent) => void) | null = null;
    onerror: ((this: WebSocket, ev: Event) => void) | null = null;

    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSING = 2;
    readonly CLOSED = 3;

    private termId: string;
    private unsubscribe: (() => void) | null = null;

    constructor(url: string | URL, termId: string) {
      super();
      this.url = typeof url === 'string' ? url : url.toString();
      this.termId = termId;
      queueMicrotask(() => {
        this.unsubscribe = bridge.onTerminalData(this.termId, (msg) => {
          const wireMessage = JSON.stringify(msg);
          const ev = new MessageEvent('message', { data: wireMessage });
          this.onmessage?.call(this as unknown as WebSocket, ev);
          this.dispatchEvent(ev);
        });
        this.readyState = this.OPEN;
        const openEv = new Event('open');
        this.onopen?.call(this as unknown as WebSocket, openEv);
        this.dispatchEvent(openEv);
      });
    }

    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
      if (this.readyState !== this.OPEN) return;
      const str = typeof data === 'string' ? data : new TextDecoder().decode(data as ArrayBuffer);
      try {
        const parsed = JSON.parse(str);
        bridge.terminalSend(this.termId, parsed);
      } catch {
        // Raw text — treat as keyboard input
        bridge.terminalSend(this.termId, { type: 'input', data: str });
      }
    }

    close(code = 1000, reason = ''): void {
      if (this.readyState === this.CLOSED) return;
      this.readyState = this.CLOSING;
      this.unsubscribe?.();
      this.unsubscribe = null;
      queueMicrotask(() => {
        this.readyState = this.CLOSED;
        const ev = new CloseEvent('close', { code, reason, wasClean: true });
        this.onclose?.call(this as unknown as WebSocket, ev);
        this.dispatchEvent(ev);
      });
    }
  }

  // Replace the global WebSocket — route terminal URLs to the
  // bidirectional IPC class, everything else to broadcast-only.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).WebSocket = class IpcWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      const urlStr = typeof url === 'string' ? url : url.toString();
      const termId = extractTerminalId(urlStr);
      if (termId) {
        return new IpcTerminalWebSocket(url, termId) as unknown as IpcWebSocket;
      }
      return new IpcBroadcastWebSocket(url, protocols) as unknown as IpcWebSocket;
    }
    // Static constants required by the WebSocket spec
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
  };
}

// =============================================================
// Backend boot error surfacing
// =============================================================

function surfaceBackendError(params: URLSearchParams): void {
  const backendError = params.get('backendError');
  if (!backendError) return;
  // Defer until React mounts so the toast store exists.
  setTimeout(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toastStore = (window as any).__codetrellisToastStore;
    if (toastStore) {
      toastStore.getState().addToast({
        type: 'error',
        title: 'Backend failed to initialise',
        message: backendError,
        duration: 0,
      });
    } else {
      console.error('[IpcShim] Backend startup error:', backendError);
    }
  }, 1000);
}
