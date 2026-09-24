/*
 * Phase 31 §7.6 — the network stubs link, and every call fails.
 *
 * build.sh links this against no-network.js with the flags that matter to
 * it (memory past 2 GB makes Emscripten wrap every pointer-taking import)
 * and runs it before the hours-long LibreOffice build, so a stub that does
 * not fit its call fails in minutes rather than at the final link.
 *
 * Exits non-zero if any socket call or name lookup succeeds.
 */
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <netdb.h>

static int failed = 0;
static void expect_fail(const char *what, long r) {
  printf("%-12s %ld\n", what, r);
  if (r >= 0) failed = 1;
}

int main(void) {
  struct sockaddr_in a;
  memset(&a, 0, sizeof a);
  a.sin_family = AF_INET;
  a.sin_port = htons(80);
  socklen_t l = sizeof a;
  char buf[8], host[64], serv[16];
  int sv[2], v = 1;
  struct msghdr m;
  memset(&m, 0, sizeof m);
  struct addrinfo *res = 0;

  expect_fail("socket", socket(AF_INET, SOCK_STREAM, 0));
  expect_fail("socketpair", socketpair(AF_UNIX, SOCK_STREAM, 0, sv));
  expect_fail("connect", connect(3, (struct sockaddr *)&a, sizeof a));
  expect_fail("bind", bind(3, (struct sockaddr *)&a, sizeof a));
  expect_fail("listen", listen(3, 1));
  expect_fail("accept4", accept4(3, (struct sockaddr *)&a, &l, 0));
  expect_fail("getsockname", getsockname(3, (struct sockaddr *)&a, &l));
  expect_fail("getpeername", getpeername(3, (struct sockaddr *)&a, &l));
  expect_fail("getsockopt", getsockopt(3, SOL_SOCKET, SO_ERROR, &v, &l));
  expect_fail("setsockopt", setsockopt(3, SOL_SOCKET, SO_REUSEADDR, &v, sizeof v));
  expect_fail("sendto", sendto(3, "x", 1, 0, (struct sockaddr *)&a, sizeof a));
  expect_fail("recvfrom", recvfrom(3, buf, sizeof buf, 0, (struct sockaddr *)&a, &l));
  expect_fail("sendmsg", sendmsg(3, &m, 0));
  expect_fail("recvmsg", recvmsg(3, &m, 0));
  expect_fail("shutdown", shutdown(3, SHUT_RDWR));
  expect_fail("getaddrinfo", getaddrinfo("example.com", "80", 0, &res) == 0 ? 0 : -1);
  expect_fail("getnameinfo", getnameinfo((struct sockaddr *)&a, sizeof a, host, sizeof host, serv, sizeof serv, 0) == 0 ? 0 : -1);
  /* Emscripten's C gethostbyname cannot report a failed lookup; the stub
     answers 0.0.0.0, which no socket above can reach. */
  struct hostent *h = gethostbyname("example.com");
  unsigned int addr = h && h->h_addr_list[0] ? *(unsigned int *)h->h_addr_list[0] : 0;
  printf("%-12s %u\n", "gethostbyname", addr);
  if (addr != 0) failed = 1;

  puts(failed ? "A NETWORK CALL SUCCEEDED" : "every network call failed");
  return failed;
}
