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
 * Each stub takes the parameters of the call it replaces. Emscripten keeps
 * its own `__sig` for these names, and where a signature carries pointers it
 * wraps the function to convert them — which needs a parameter for every
 * entry in the signature ("handleI64Signatures: signature too long"
 * otherwise, at the final link). The values are never read.
 *
 * `prove-network-free.mjs` checks the built engine against this: each
 * network-capable import must be one of these stubs, and the glue must carry
 * no socket or WebSocket code at all.
 */

addToLibrary({
  __syscall_socket__deps: [],
  __syscall_socket: (domain, type, protocol, d1, d2, d3) => -{{{ cDefs.EAFNOSUPPORT }}},
  __syscall_socketpair__deps: [],
  __syscall_socketpair: (domain, type, protocol, fds, d1, d2) => -{{{ cDefs.EAFNOSUPPORT }}},
  __syscall_connect__deps: [],
  __syscall_connect: (fd, addr, addrlen, d1, d2, d3) => -{{{ cDefs.ENETUNREACH }}},
  __syscall_bind__deps: [],
  __syscall_bind: (fd, addr, addrlen, d1, d2, d3) => -{{{ cDefs.ENOTSOCK }}},
  __syscall_listen__deps: [],
  __syscall_listen: (fd, backlog, d1, d2, d3, d4) => -{{{ cDefs.ENOTSOCK }}},
  __syscall_accept4__deps: [],
  __syscall_accept4: (fd, addr, addrlen, flags, d1, d2) => -{{{ cDefs.ENOTSOCK }}},
  __syscall_getsockname__deps: [],
  __syscall_getsockname: (fd, addr, addrlen, d1, d2, d3) => -{{{ cDefs.ENOTSOCK }}},
  __syscall_getpeername__deps: [],
  __syscall_getpeername: (fd, addr, addrlen, d1, d2, d3) => -{{{ cDefs.ENOTSOCK }}},
  __syscall_getsockopt__deps: [],
  __syscall_getsockopt: (fd, level, optname, optval, optlen, d1) => -{{{ cDefs.ENOTSOCK }}},
  __syscall_setsockopt__deps: [],
  __syscall_setsockopt: (fd, level, optname, optval, optlen, d1) => -{{{ cDefs.ENOTSOCK }}},
  __syscall_sendto__deps: [],
  __syscall_sendto: (fd, message, length, flags, addr, addrlen) => -{{{ cDefs.ENOTSOCK }}},
  __syscall_recvfrom__deps: [],
  __syscall_recvfrom: (fd, buf, len, flags, addr, addrlen) => -{{{ cDefs.ENOTSOCK }}},
  __syscall_sendmsg__deps: [],
  __syscall_sendmsg: (fd, message, flags, d1, d2, d3) => -{{{ cDefs.ENOTSOCK }}},
  __syscall_recvmsg__deps: [],
  __syscall_recvmsg: (fd, message, flags, d1, d2, d3) => -{{{ cDefs.ENOTSOCK }}},
  __syscall_shutdown__deps: [],
  __syscall_shutdown: (fd, how, d1, d2, d3, d4) => -{{{ cDefs.ENOTSOCK }}},
  getaddrinfo__deps: [],
  getaddrinfo: (node, service, hint, out) => {{{ cDefs.EAI_FAIL }}},
  getnameinfo__deps: [],
  getnameinfo: (sa, salen, node, nodelen, serv, servlen, flags) => {{{ cDefs.EAI_FAIL }}},
  _emscripten_lookup_name__deps: [],
  _emscripten_lookup_name: (name) => 0,
});
