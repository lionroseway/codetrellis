/**
 * Phase 31 §7.1 — where an attachment's bytes come from.
 *
 * In Electron the renderer is (in a packaged build) a `file://` document:
 * `/api/...` in an `<img>` or `<video>` becomes `file:///api/...`, and the
 * fetch shim decodes bodies as UTF-8. The `ct-artefact:` scheme, handled in
 * main by the same resolver as the REST route, is the one transport that
 * carries bytes there. In dev / web, the REST route does, behind the token.
 */
export function artefactSrcUrl(uid: string): string {
  const inElectron = typeof window !== 'undefined' && !!(window as unknown as { codetrellisIpc?: unknown }).codetrellisIpc;
  return inElectron
    ? `ct-artefact://${encodeURIComponent(uid)}`
    : `/api/artefacts/${encodeURIComponent(uid)}/content`;
}
