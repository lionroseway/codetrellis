/**
 * Phase 31 §7.6 — the conversion engine has no network.
 *
 * An Emscripten JS library linked into LibreOffice's WebAssembly build
 * (`--js-library`, after Emscripten's own, so these definitions replace
 * theirs). Every socket syscall and name lookup the linked code imports
 * resolves here, and fails: there is no socket layer (SOCKFS), no WebSocket
 * bridge, no DNS table behind them — `__deps: []` keeps those out of the
 * link entirely.
 *
 * `prove-network-free.mjs` checks the built engine against this: each
 * network-capable import must be one of these stubs, and the glue must carry
 * no socket or WebSocket code at all.
 */

addToLibrary({
  __syscall_socket__deps: [],
  __syscall_socket: () => -{{{ cDefs.EAFNOSUPPORT }}},
  __syscall_socketpair__deps: [],
  __syscall_socketpair: () => -{{{ cDefs.EAFNOSUPPORT }}},
  __syscall_connect__deps: [],
  __syscall_connect: () => -{{{ cDefs.ENETUNREACH }}},
  __syscall_bind__deps: [],
  __syscall_bind: () => -{{{ cDefs.ENOTSOCK }}},
  __syscall_listen__deps: [],
  __syscall_listen: () => -{{{ cDefs.ENOTSOCK }}},
  __syscall_accept4__deps: [],
  __syscall_accept4: () => -{{{ cDefs.ENOTSOCK }}},
  __syscall_getsockname__deps: [],
  __syscall_getsockname: () => -{{{ cDefs.ENOTSOCK }}},
  __syscall_getpeername__deps: [],
  __syscall_getpeername: () => -{{{ cDefs.ENOTSOCK }}},
  __syscall_getsockopt__deps: [],
  __syscall_getsockopt: () => -{{{ cDefs.ENOTSOCK }}},
  __syscall_setsockopt__deps: [],
  __syscall_setsockopt: () => -{{{ cDefs.ENOTSOCK }}},
  __syscall_sendto__deps: [],
  __syscall_sendto: () => -{{{ cDefs.ENOTSOCK }}},
  __syscall_recvfrom__deps: [],
  __syscall_recvfrom: () => -{{{ cDefs.ENOTSOCK }}},
  __syscall_sendmsg__deps: [],
  __syscall_sendmsg: () => -{{{ cDefs.ENOTSOCK }}},
  __syscall_recvmsg__deps: [],
  __syscall_recvmsg: () => -{{{ cDefs.ENOTSOCK }}},
  __syscall_shutdown__deps: [],
  __syscall_shutdown: () => -{{{ cDefs.ENOTSOCK }}},
  getaddrinfo__deps: [],
  getaddrinfo: () => {{{ cDefs.EAI_FAIL }}},
  getnameinfo__deps: [],
  getnameinfo: () => {{{ cDefs.EAI_FAIL }}},
  _emscripten_lookup_name__deps: [],
  _emscripten_lookup_name: () => 0,
});
