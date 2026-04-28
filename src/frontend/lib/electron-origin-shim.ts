/**
 * Origin shim for the packaged Electron renderer.
 *
 * The renderer loads from `file://…/index.html`, so any code that
 * does `fetch('/api/foo')` or `new WebSocket('ws://' + location.host)`
 * would resolve to `file:///api/foo` / `ws://` — both fail. The dev
 * mode (Vite at :5173) doesn't have this problem because Vite's
 * dev server is the origin and proxies `/api` and `/ws`.
 *
 * Fix: when running under `file://`, monkey-patch `window.fetch` and
 * `window.WebSocket` so any URL starting with `/api` or
 * `ws://<empty-host>/...` gets rewritten to
 * `http://localhost:<port>/...` / `ws://localhost:<port>/...`.
 *
 * The bound backend port is passed in via a query string by Electron
 * main (see `src/electron/main.ts`); falls back to 3001 if missing.
 *
 * Idempotent — calling twice is a no-op.
 */

const PATCHED_FLAG = '__codetrellisOriginShimInstalled';

export function installElectronOriginShim(): void {
  if (typeof window === 'undefined') return;
  if (window.location.protocol !== 'file:') return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any)[PATCHED_FLAG]) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any)[PATCHED_FLAG] = true;

  const params = new URLSearchParams(window.location.search);
  const port = params.get('port') || '3001';
  const httpOrigin = `http://localhost:${port}`;
  const wsOrigin = `ws://localhost:${port}`;

  console.log(`[OriginShim] file:// detected — routing /api → ${httpOrigin}, /ws → ${wsOrigin}`);

  // --- fetch ---
  const origFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string') {
      if (input.startsWith('/')) {
        return origFetch(`${httpOrigin}${input}`, init);
      }
      return origFetch(input, init);
    }
    if (input instanceof URL) {
      if (input.protocol === 'file:' && input.pathname.startsWith('/')) {
        return origFetch(`${httpOrigin}${input.pathname}${input.search}`, init);
      }
      return origFetch(input, init);
    }
    // Request object — leave it alone (caller already absolute-ified)
    return origFetch(input, init);
  }) as typeof window.fetch;

  // --- WebSocket ---
  const OrigWebSocket = window.WebSocket;
  class ShimmedWebSocket extends OrigWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      let resolved = typeof url === 'string' ? url : url.toString();
      try {
        const u = new URL(resolved);
        // Empty host on a ws:// URL means it was constructed from
        // `ws://${window.location.host}/ws` where host was empty —
        // rewrite to the backend.
        if ((u.protocol === 'ws:' || u.protocol === 'wss:') && (!u.host || u.host === '')) {
          resolved = `${wsOrigin}${u.pathname}${u.search}`;
        }
      } catch {
        // Not a parseable URL → bare path? `/ws` style.
        if (resolved.startsWith('/')) {
          resolved = `${wsOrigin}${resolved}`;
        }
      }
      super(resolved, protocols as string | string[] | undefined);
    }
  }
  // Preserve readyState constants so `WebSocket.OPEN` still works.
  Object.defineProperties(ShimmedWebSocket, {
    CONNECTING: { value: OrigWebSocket.CONNECTING },
    OPEN: { value: OrigWebSocket.OPEN },
    CLOSING: { value: OrigWebSocket.CLOSING },
    CLOSED: { value: OrigWebSocket.CLOSED },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).WebSocket = ShimmedWebSocket;

  // --- Surface backend errors that main.ts passed via query string ---
  const backendError = params.get('backendError');
  if (backendError) {
    // Defer until React mounts so the toast store exists.
    setTimeout(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toastStore = (window as any).__codetrellisToastStore;
      if (toastStore) {
        toastStore.getState().addToast({
          type: 'error',
          title: 'Backend failed to start',
          message: backendError,
          duration: 0,
        });
      } else {
        console.error('[OriginShim] Backend startup error:', backendError);
      }
    }, 1000);
  }
}
