/**
 * Phase 31 §7.6 — the network proof: stubs pass, anything else fails.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { proveNetworkFree, removedGlobals } from './network-proof';

/** A WebAssembly module that imports the named functions from `env`. */
function moduleImporting(names: string[]): Uint8Array {
  const leb = (n: number) => { const out: number[] = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n); return out; };
  const str = (s: string) => [...leb(s.length), ...Buffer.from(s)];
  const section = (id: number, body: number[]) => [id, ...leb(body.length), ...body];
  const types = section(1, [1, 0x60, 0, 0]);
  const imports = section(2, [...leb(names.length), ...names.flatMap((n) => [...str('env'), ...str(n), 0x00, 0])]);
  return new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...types, ...imports]);
}

const STUBBED = `
var ___syscall_socket = () => -5;
var ___syscall_connect = () => -40;
function _getaddrinfo() { return -4; }
var _fd_write = (fd, iov) => { /* ordinary */ };
`;

test('every network import resolves to a stub, and the glue has no network machinery: network-free', () => {
  const proof = proveNetworkFree(moduleImporting(['__syscall_socket', '__syscall_connect', 'getaddrinfo', 'fd_write']), STUBBED);
  assert.equal(proof.networkFree, true, proof.failures.join('; '));
  assert.deepEqual(proof.stubs, { __syscall_socket: -5, __syscall_connect: -40, getaddrinfo: -4 });
});

test('a network import with a real implementation fails, and says which', () => {
  const glue = `${STUBBED}\nvar ___syscall_sendto = (fd, msg) => { var sock = getSocketFromFD(fd); return sock.sock_ops.sendmsg(sock, msg); };`;
  const proof = proveNetworkFree(moduleImporting(['__syscall_socket', '__syscall_sendto']), glue);
  assert.equal(proof.networkFree, false);
  assert.deepEqual(proof.failures, ['__syscall_sendto is imported and is not a no-network stub']);
});

test('a stub wrapped to make its pointers unsigned is still a stub; anything more in the wrapper is not', () => {
  // What Emscripten emits for a pointer-taking import when memory can pass 2 GB.
  const wrapped = `function ___syscall_recvfrom(fd, buf, len, flags, addr, addrlen) {
  buf >>>= 0;
  len >>>= 0;
  addr >>>= 0;
  addrlen >>>= 0;
  return -57;
}`;
  const ok = proveNetworkFree(moduleImporting(['__syscall_recvfrom']), wrapped);
  assert.equal(ok.networkFree, true, ok.failures.join('; '));
  assert.deepEqual(ok.stubs, { __syscall_recvfrom: -57 });

  const doing = wrapped.replace('addrlen >>>= 0;', 'addrlen >>>= 0;\n  readSocket(fd, buf);');
  const bad = proveNetworkFree(moduleImporting(['__syscall_recvfrom']), doing);
  assert.deepEqual(bad.failures, ['__syscall_recvfrom is imported and is not a no-network stub']);
});

test('network machinery anywhere in the glue fails, even with every import stubbed', () => {
  for (const extra of ['var SOCKFS = {};', 'new WebSocket(url)', 'var xhr = new XMLHttpRequest();', "require('net')", 'await fetch(url)']) {
    const proof = proveNetworkFree(moduleImporting(['__syscall_socket']), `${STUBBED}\n${extra}`);
    assert.equal(proof.networkFree, false, extra);
  }
});

test('Emscripten\'s dead fetch() and XMLHttpRequest pass only when the adapter takes those globals away first', () => {
  const glue = `${STUBBED}\nif (!ENVIRONMENT_IS_NODE && typeof fetch == "function") { var response = fetch(binaryFile, {}); }\nif (typeof XMLHttpRequest != "undefined") { var xhr = new XMLHttpRequest; }`;
  const wasm = moduleImporting(['__syscall_socket']);
  const adapter = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'tools', 'rendition-engine', 'runtime', 'adapter.cjs'), 'utf8');

  assert.deepEqual(proveNetworkFree(wasm, glue).failures, ['the glue contains XMLHttpRequest', 'the glue contains fetch()']);
  assert.equal(proveNetworkFree(wasm, glue, adapter).networkFree, true);
  // The real adapter removes exactly these, before it loads the glue.
  assert.deepEqual([...removedGlobals(adapter)].sort(), ['EventSource', 'WebSocket', 'XMLHttpRequest', 'fetch']);
  // Declaring the list without calling the removal first earns nothing.
  assert.equal(removedGlobals(adapter.replace('  withoutNetworkGlobals();\n', '')).size, 0);
  // A socket filesystem is never accepted, whatever the adapter does.
  assert.deepEqual(proveNetworkFree(wasm, `${glue}\nvar SOCKFS = {};`, adapter).failures, ['the glue contains SOCKFS']);
});
