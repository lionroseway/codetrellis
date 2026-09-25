/**
 * Phase 31 §7.1 — how an artefact's bytes reach the packaged renderer.
 *
 * The packaged renderer is a `file://` page. Two ways in, one answer:
 *
 *   - `ct-artefact://<uid>` as a scheme, for `<img>` and `<video>`, which
 *     load it without CORS;
 *   - `codetrellis:artefact` over IPC, for `fetch()` — the PDF, sheet, Word
 *     and deck views and Office renditions. Chromium refuses a fetch from
 *     the `file://` page to the scheme as cross-origin. Making the scheme
 *     CORS-enabled would mean answering origin `null` with an allow header,
 *     and origin `null` is refused, not trusted. So the renderer's fetch
 *     shim sends these URLs here instead, and gets the body as bytes.
 *
 * Both call the same `respond`, so the two cannot drift apart.
 */
import { ipcMain, protocol, type WebContents } from 'electron';

export const ARTEFACT_SCHEME = {
  scheme: 'ct-artefact',
  privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true },
} as const;

export type ArtefactResponder = (url: string, range: string | null) => Promise<Response>;

export interface IpcArtefactResponse { status: number; headers: Record<string, string>; body: ArrayBuffer }

export function installArtefactTransport(respond: ArtefactResponder, isAppWindow: (sender: WebContents) => boolean): void {
  protocol.handle(ARTEFACT_SCHEME.scheme, (request) => respond(request.url, request.headers.get('range')));

  // Only the app's own window may ask, and only for a ct-artefact: URL.
  ipcMain.handle('codetrellis:artefact', async (event, url: unknown): Promise<IpcArtefactResponse> => {
    if (!isAppWindow(event.sender)) return { status: 403, headers: {}, body: new ArrayBuffer(0) };
    if (typeof url !== 'string' || !url.startsWith(`${ARTEFACT_SCHEME.scheme}://`)) {
      return { status: 400, headers: {}, body: new ArrayBuffer(0) };
    }
    const res = await respond(url, null);
    return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body: await res.arrayBuffer() };
  });
}
