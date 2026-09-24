/**
 * Phase 31 §7.6 — the proof that a conversion engine has no network.
 *
 * The engine is LibreOffice compiled to WebAssembly. Everything it can do to
 * the outside world goes through functions it imports from its JavaScript
 * glue. So:
 *
 *  1. Every import that could reach a network — the socket syscalls, name
 *     lookup, Emscripten's fetch and WebSocket APIs — must resolve in the
 *     glue to a stub from tools/rendition-engine/no-network.js: a function
 *     that returns a constant error and does nothing else.
 *  2. The glue must carry none of the machinery those would need: no socket
 *     filesystem (SOCKFS), no WebSocket, no XMLHttpRequest, no network module
 *     required, no fetch.
 *
 * CI runs this on every engine it builds (tools/rendition-engine/prove-
 * network-free.ts); an engine that fails is not published, and only a
 * published engine is pinned into the app with `networkFree: true`. That
 * attestation is what lets the engine run where the runtime itself cannot
 * deny it the network (Electron's Node 24 has no --allow-net).
 */

const NETWORK_IMPORT = /^(__syscall_(socket|socketpair|connect|bind|listen|accept4?|getsockname|getpeername|getsockopt|setsockopt|sendto|recvfrom|sendmsg|recvmsg|shutdown)|getaddrinfo|getnameinfo|gethostbyname2?|gethostbyaddr|_emscripten_lookup_name)$|fetch|websocket|xhr/i;

const FORBIDDEN_IN_GLUE: Array<[string, RegExp]> = [
  ['SOCKFS', /\bSOCKFS\b/],
  ['WebSocket', /\bWebSocket\b/],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/],
  ['a network module', /require\(\s*["'](?:node:)?(?:net|tls|http|https|http2|dgram|dns|ws)["']\s*\)/],
  ['fetch()', /\bfetch\s*\(/],
];

export interface NetworkProof {
  imports: number;
  networkImports: string[];
  /** Each network import and the constant its stub returns. */
  stubs: Record<string, number>;
  networkFree: boolean;
  failures: string[];
}

/** The glue's definition of an import: `var ___name = () => -N;`, or the function / minified form. */
function stubValue(glue: string, importName: string): number | null {
  const js = `_${importName}`.replace(/\$/g, '\\$');
  const arrow = new RegExp(`(?:var|let|const)\\s+${js}\\s*=\\s*\\([^)]*\\)\\s*=>\\s*(-?\\d+)\\s*[;,\\n]`);
  const fn = new RegExp(`function\\s+${js}\\s*\\([^)]*\\)\\s*\\{\\s*return\\s+(-?\\d+)\\s*;?\\s*\\}`);
  const m = glue.match(arrow) ?? glue.match(fn);
  return m ? Number(m[1]) : null;
}

export function proveNetworkFree(wasm: Uint8Array, glue: string): NetworkProof {
  const imports = WebAssembly.Module.imports(new WebAssembly.Module(wasm as Uint8Array<ArrayBuffer>)).filter((i) => i.kind === 'function');
  const networkImports = imports.filter((i) => NETWORK_IMPORT.test(i.name)).map((i) => i.name);
  const failures: string[] = [];
  const stubs: Record<string, number> = {};
  for (const name of networkImports) {
    const value = stubValue(glue, name);
    if (value === null) failures.push(`${name} is imported and is not a no-network stub`);
    else stubs[name] = value;
  }
  for (const [what, re] of FORBIDDEN_IN_GLUE) {
    if (re.test(glue)) failures.push(`the glue contains ${what}`);
  }
  return { imports: imports.length, networkImports, stubs, networkFree: failures.length === 0, failures };
}
