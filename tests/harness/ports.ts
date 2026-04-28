/**
 * Free-port allocator. Asks the kernel for an unused TCP port by
 * binding to `:0` and immediately closing — the returned port is
 * what we just held. Race conditions are theoretically possible
 * between the close and the test's reuse, but in practice the
 * window is microseconds and the tests run on loopback only.
 *
 * Avoids pulling in the `get-port` npm package (one less moving part
 * in CI).
 */

import net from 'node:net';

export async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (typeof addr !== 'object' || !addr) {
        server.close();
        reject(new Error('failed to read server address'));
        return;
      }
      const port = addr.port;
      server.close(() => resolve(port));
    });
  });
}

/** Allocate N free ports in parallel. */
export async function findFreePorts(count: number): Promise<number[]> {
  return Promise.all(Array.from({ length: count }, () => findFreePort()));
}
