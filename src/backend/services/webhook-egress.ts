/**
 * Outbound webhooks: where they may go, and how they get there.
 *
 * Phase 19, finding 20.
 *
 * WHAT WAS WRONG
 *
 * `channel.routing[].notify.url` is read from
 * `<projectRoot>/.codetrellis/config.json` — a file that lives IN THE
 * REPOSITORY. Nothing validated it. So cloning a repository and opening it
 * caused this process to make outbound requests to a URL its author chose,
 * with headers its author chose, carrying plan and channel event data, from
 * inside whatever network the developer's machine is on.
 *
 * The valuable targets are the ones only that machine can reach: the cloud
 * metadata service on 169.254.169.254, an internal admin panel, a
 * `127.0.0.1` port belonging to another local tool.
 *
 * THE CONTROLS
 *
 *   1. HTTPS only. A webhook body carries the user's plan data, and `http:`
 *      puts it on the wire in the clear. Other schemes are not webhooks.
 *   2. The host must be approved BY THE USER, per host. A URL in a cloned
 *      repository has no standing on its own — that is the whole finding.
 *   3. Every address the host resolves to must be public. If ANY is private,
 *      the request is refused: a host resolving to a mix is straddling
 *      deliberately.
 *   4. The connection is PINNED to the address that was checked. Handing a
 *      hostname to the HTTP client would let it resolve again — the answer
 *      can differ from the one just validated, which is DNS rebinding and is
 *      the gap the review specifically named. TLS still verifies against the
 *      HOSTNAME, so pinning weakens nothing.
 *   5. No redirects. A redirect is a second destination the user never
 *      approved, and following one re-opens every check above.
 *
 * WHAT THIS DELIBERATELY IS NOT
 *
 * Not a general-purpose HTTP client. It posts JSON to an approved webhook and
 * reports what happened. Anything more would be a way around the checks.
 */

import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import type { LookupFunction } from 'node:net';

export class WebhookBlocked extends Error {
  readonly code = 'EWEBHOOK_BLOCKED';
  constructor(message: string) {
    super(message);
    this.name = 'WebhookBlocked';
  }
}

/** Largest response we will read. We only care about the status. */
const MAX_RESPONSE_BYTES = 64 * 1024;

/**
 * Headers a caller may not set.
 *
 * `host` would break the pinning by disagreeing with the TLS name; the rest
 * are hop-by-hop and belong to the transport, not to a webhook payload.
 */
const FORBIDDEN_HEADERS = new Set([
  'host', 'connection', 'content-length', 'transfer-encoding',
  'upgrade', 'keep-alive', 'proxy-authorization', 'te', 'trailer',
]);

// --- Address classification --------------------------------------------------

/**
 * Whether an address is one only this machine or this network can reach.
 *
 * Written out rather than pulled from a package because the list is the
 * security property: a dependency quietly dropping link-local, say, would be
 * invisible and would re-open the cloud-metadata case.
 */
export function isPrivateAddress(address: string): boolean {
  // IPv4-mapped IPv6 (::ffff:169.254.169.254) is an IPv4 address wearing a
  // hat. Classify what it actually is.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isPrivateAddress(mapped[1]);

  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    if (a === 0) return true;                         // "this network"
    if (a === 10) return true;                        // private
    if (a === 127) return true;                       // loopback
    if (a === 169 && b === 254) return true;          // link-local — CLOUD METADATA
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true;          // private
    if (a === 192 && b === 0) return true;            // IETF protocol assignments
    if (a === 100 && b >= 64 && b <= 127) return true;// CGNAT
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true;                        // multicast, reserved, broadcast
    return false;
  }

  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // unique-local fc00::/7
    if (/^fe[89ab][0-9a-f]:/.test(lower)) return true; // link-local fe80::/10
    if (/^ff[0-9a-f]{2}:/.test(lower)) return true;    // multicast
    return false;
  }

  // Not an address we can classify — refuse rather than guess.
  return true;
}

/** Loopback specifically — the narrowest thing the user can opt into. */
export function isLoopbackAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isLoopbackAddress(mapped[1]);
  if (net.isIPv4(address)) return Number(address.split('.')[0]) === 127;
  if (net.isIPv6(address)) return address.toLowerCase() === '::1';
  return false;
}

// --- URL validation ----------------------------------------------------------

export interface ApprovedTarget {
  url: URL;
  /** The single address this request will connect to. */
  address: string;
  family: 4 | 6;
}

/**
 * Check a webhook URL and resolve it to one pinned address, or throw.
 *
 * @param approvedHosts Hostnames the USER has approved. Matched exactly,
 *   case-insensitively. No wildcards: a wildcard is an approval for hosts the
 *   user has not seen.
 */
export async function resolveWebhookTarget(
  rawUrl: string,
  approvedHosts: readonly string[],
  opts: { allowLoopback?: boolean } = {},
): Promise<ApprovedTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new WebhookBlocked(`Webhook URL is not a URL: ${String(rawUrl).slice(0, 120)}`);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new WebhookBlocked(
      `Webhook URL must be https (got "${url.protocol}").`,
    );
  }

  if (url.username || url.password) {
    // Credentials in a URL from a repository file are somebody else's
    // credentials being sent somewhere, and they would end up in logs.
    throw new WebhookBlocked('Webhook URL must not contain credentials');
  }

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!approvedHosts.some((h) => h.trim().toLowerCase() === host)) {
    throw new WebhookBlocked(
      `Webhook host "${host}" has not been approved. ` +
      'This URL comes from the project\'s config file, which is part of the repository — ' +
      'approve the host in Settings → Channels before it is used.',
    );
  }

  /**
   * Whether this address may be used.
   *
   * `allowLoopback` is the ONE narrowing the user can make, and it is exactly
   * loopback — a local webhook receiver is a real case. It does not extend to
   * the LAN or to 169.254.169.254, which are the destinations that make this
   * finding worth anything to an attacker.
   */
  const permitted = (addr: string): boolean =>
    !isPrivateAddress(addr) || (opts.allowLoopback === true && isLoopbackAddress(addr));

  // A literal address still has to pass; approving a host does not approve
  // reaching into the local network.
  /**
   * `http:` is confidentiality-free, and the body carries the user's plan
   * data. The single exception is loopback, where there is no wire to listen
   * on — which is also the only case a self-signed local receiver can serve.
   */
  const assertSchemeOkFor = (addr: string): void => {
    if (url.protocol === 'https:') return;
    if (opts.allowLoopback === true && isLoopbackAddress(addr)) return;
    throw new WebhookBlocked(
      `Webhook URL must be https (got "${url.protocol}"). A webhook body carries plan data.`,
    );
  };

  if (net.isIP(host)) {
    if (!permitted(host)) {
      throw new WebhookBlocked(`Webhook address ${host} is not a public address`);
    }
    assertSchemeOkFor(host);
    return { url, address: host, family: net.isIPv6(host) ? 6 : 4 };
  }

  let records: { address: string; family: number }[];
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch (err) {
    throw new WebhookBlocked(`Webhook host "${host}" did not resolve: ${(err as Error).message}`);
  }
  if (records.length === 0) {
    throw new WebhookBlocked(`Webhook host "${host}" resolved to nothing`);
  }

  // EVERY address must be public, not just the one we pick. A host that
  // resolves to a public address and a private one is straddling on purpose,
  // and picking the public one would make the outcome a race.
  const priv = records.filter((r) => !permitted(r.address));
  if (priv.length > 0) {
    throw new WebhookBlocked(
      `Webhook host "${host}" resolves to a non-public address (${priv[0].address})`,
    );
  }

  const chosen = records[0];
  assertSchemeOkFor(chosen.address);
  return { url, address: chosen.address, family: chosen.family === 6 ? 6 : 4 };
}

// --- Sending -----------------------------------------------------------------

export interface WebhookResult {
  status: number;
  /** A 3xx, which is refused rather than followed. */
  redirected: boolean;
}

/**
 * POST a JSON body to an already-approved, already-pinned target.
 *
 * The caller passes the result of `resolveWebhookTarget`, so the checks cannot
 * be skipped by calling this directly with a string.
 */
export function postWebhookJson(
  target: ApprovedTarget,
  headers: Record<string, string>,
  body: string,
  timeoutMs = 5_000,
): Promise<WebhookResult> {
  return new Promise((resolve, reject) => {
    const safeHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      if (!FORBIDDEN_HEADERS.has(k.toLowerCase())) safeHeaders[k] = v;
    }

    // PIN THE ADDRESS (finding 20).
    //
    // Passing the hostname and letting the agent resolve it means resolving
    // AGAIN — and the second answer can differ from the one just validated.
    // That window is the rebinding gap the review named. `servername` keeps
    // TLS verifying against the hostname, so this narrows the attack without
    // weakening authentication.
    const pinnedLookup: LookupFunction = (_hostname, _options, callback) => {
      (callback as (err: null, address: string, family: number) => void)(
        null, target.address, target.family,
      );
    };

    const secure = target.url.protocol === 'https:';
    const transport = secure ? https : http;
    const req = transport.request(
      {
        protocol: target.url.protocol,
        hostname: target.url.hostname,
        port: target.url.port || (secure ? 443 : 80),
        path: `${target.url.pathname}${target.url.search}`,
        method: 'POST',
        headers: { ...safeHeaders, 'content-length': Buffer.byteLength(body) },
        // Only meaningful over TLS; harmless on the loopback-only http path.
        ...(secure ? { servername: target.url.hostname } : {}),
        lookup: pinnedLookup,
        timeout: timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        let read = 0;
        res.on('data', (chunk: Buffer) => {
          read += chunk.length;
          if (read > MAX_RESPONSE_BYTES) res.destroy();
        });
        res.on('end', () => resolve({ status, redirected: status >= 300 && status < 400 }));
        res.on('error', reject);
        // NO REDIRECT FOLLOWING. A redirect names a destination the user never
        // approved, and following it would re-open every check above.
        if (status >= 300 && status < 400) {
          res.destroy();
          resolve({ status, redirected: true });
        }
      },
    );

    req.on('timeout', () => { req.destroy(new Error('Webhook request timed out')); });
    req.on('error', reject);
    req.end(body);
  });
}
