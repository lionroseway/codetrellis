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

/**
 * Machinery that fails the proof wherever it appears. The last element is
 * the global that, when the engine's adapter takes it away before the glue
 * loads, leaves the code nothing to call — Emscripten keeps a `fetch()` and
 * an `XMLHttpRequest` for other environments that are dead under Node, and
 * those are accepted only then. A socket filesystem or a network module is
 * never accepted.
 */
const FORBIDDEN_IN_GLUE: Array<[string, RegExp, string | null]> = [
  ['SOCKFS', /\bSOCKFS\b/, null],
  ['WebSocket', /\bWebSocket\b/, 'WebSocket'],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  ['a network module', /require\(\s*["'](?:node:)?(?:net|tls|http|https|http2|dgram|dns|ws)["']\s*\)/, null],
  ['fetch()', /\bfetch\s*\(/, 'fetch'],
];

/**
 * The glue without the lists of library symbol NAMES that ASSERTIONS builds
 * carry for their error messages (`var unexportedSymbols = [ "run", …,
 * "SOCKFS" ];`). A name in such a list is a string, not code. A list is
 * removed only when it holds nothing but quoted names.
 */
export function withoutSymbolLists(glue: string): string {
  return glue.replace(/\bvar\s+(?:unexportedSymbols|missingLibrarySymbols)\s*=\s*\[(?:\s*"[\w$]+"\s*,?)*\s*\]\s*;?/g, '');
}

/** The globals the adapter takes away before loading the glue (runtime/adapter.cjs). */
export function removedGlobals(adapter: string | null | undefined): Set<string> {
  const list = adapter?.match(/const\s+NETWORK_GLOBALS\s*=\s*\[([^\]]*)\]/)?.[1];
  // Declared is not enough: the adapter must call the removal before loading.
  if (!list || !/async function load\([^)]*\)\s*\{\s*withoutNetworkGlobals\(\);/.test(adapter ?? '')) return new Set();
  return new Set(Array.from(list.matchAll(/['"]([A-Za-z]+)['"]/g), (m) => m[1]));
}

export interface NetworkProof {
  imports: number;
  networkImports: string[];
  /** Each network import and the constant its stub returns. */
  stubs: Record<string, number>;
  networkFree: boolean;
  failures: string[];
}

/**
 * The glue's definition of an import: `var ___name = () => -N;`, or the
 * function / minified form. Two prologues Emscripten writes may come before
 * the constant return, and nothing else:
 *  - with pthreads, a proxy that runs the same function on the main thread:
 *    `if (ENVIRONMENT_IS_PTHREAD) return proxyToMainThread(5, 0, 1, fd, addr, …);`
 *  - with memory past 2 GB, each pointer made unsigned: `addr >>>= 0;`.
 */
function stubValue(glue: string, importName: string): number | null {
  const js = `_${importName}`.replace(/\$/g, '\\$');
  const arrow = new RegExp(`(?:var|let|const)\\s+${js}\\s*=\\s*\\([^)]*\\)\\s*=>\\s*(-?\\d+)\\s*[;,\\n]`);
  const ident = '[A-Za-z_$][\\w$]*';
  const proxy = `if\\s*\\(\\s*ENVIRONMENT_IS_PTHREAD\\s*\\)\\s*return\\s+proxyToMainThread\\(\\s*\\d+\\s*,\\s*\\d+\\s*,\\s*[01]\\s*(?:,\\s*${ident}\\s*)*\\)\\s*;\\s*`;
  const unsigned = `(?:${ident}\\s*>>>=\\s*0\\s*;\\s*)*`;
  const fn = new RegExp(`function\\s+${js}\\s*\\([^)]*\\)\\s*\\{\\s*(?:${proxy})?${unsigned}return\\s+(-?\\d+)\\s*;?\\s*\\}`);
  const m = glue.match(arrow) ?? glue.match(fn);
  return m ? Number(m[1]) : null;
}

export function proveNetworkFree(wasm: Uint8Array, glue: string, adapter?: string | null): NetworkProof {
  const imports = WebAssembly.Module.imports(new WebAssembly.Module(wasm as Uint8Array<ArrayBuffer>)).filter((i) => i.kind === 'function');
  const networkImports = imports.filter((i) => NETWORK_IMPORT.test(i.name)).map((i) => i.name);
  const failures: string[] = [];
  const stubs: Record<string, number> = {};
  for (const name of networkImports) {
    const value = stubValue(glue, name);
    if (value === null) failures.push(`${name} is imported and is not a no-network stub`);
    else stubs[name] = value;
  }
  const removed = removedGlobals(adapter);
  const code = withoutSymbolLists(glue);
  for (const [what, re, global] of FORBIDDEN_IN_GLUE) {
    if (re.test(code) && !(global && removed.has(global))) failures.push(`the glue contains ${what}`);
  }
  return { imports: imports.length, networkImports, stubs, networkFree: failures.length === 0, failures };
}
