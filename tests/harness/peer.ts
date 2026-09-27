/**
 * A phone, for the harness (Phase 32 §0.4j).
 *
 * The mobile surface is ~70 JSON-RPC methods on the WebRTC `control` channel,
 * plus the state snapshot and patches on `ui`. Until this existed nothing
 * drove them end to end: the approvals and budget methods had unit tests
 * against their handlers, and the other 47 had no test at all.
 *
 * This plays the phone the way `gate4-reconnect-identity` does — a werift
 * peer, the QR v5 ceremony, a confirmation code derived on this side and typed
 * into the desktop — and then speaks the phone's wire protocol:
 *
 *   control   { rpc: true, id, method, params } → { rpc: true, id, result | error }
 *             plus desktop-initiated messages: `{ mcp: true, cmd }` commands,
 *             `preview.chunk`, `pairing.secret`
 *   ui        `snapshot`, then RFC 6902 `patch`es, applied here as the phone does
 *
 * Nothing is stubbed on the desktop side: authorisation, the capability
 * matrix, the audit trail and the broadcasts all run as they do for a real
 * phone.
 */

import {
  RTCPeerConnection, RTCSessionDescription, CipherContext, SignatureAlgorithm, HashAlgorithm, NamedCurveAlgorithm,
} from 'werift';
import { applyPatch, type Operation } from 'fast-json-patch';
import { computeAnswerMac, deriveConfirmationCode } from '../../mobile/lib/peer-auth';
import { extractSingleFingerprint } from '../../mobile/lib/sdp-fingerprint';
import { reconstructOfferSdp, ensureColonFingerprint } from '../../mobile/lib/sdp-minimal';
import type { RestClient } from './client';
import { waitFor } from './wait';

export interface ControlMessage { [key: string]: unknown }

export interface Phone {
  /** The phone's DTLS fingerprint — its identity on the desktop. */
  fingerprint: string;
  alias: string;
  /** Call a method; resolves to its result, rejects with the desktop's error text. */
  rpc<T = any>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
  /** Call a method and return the error text it failed with (throws if it succeeded). */
  rpcError(method: string, params?: Record<string, unknown>): Promise<string>;
  /** Every non-RPC message the desktop sent on `control`, in order. */
  control: ControlMessage[];
  waitForControl(pred: (m: ControlMessage) => boolean, timeoutMs?: number): Promise<ControlMessage>;
  sendControl(msg: unknown): void;
  /** The desktop's state as this phone sees it: the snapshot with every patch applied. */
  state(): any;
  /** Every `ui` message received, in order. */
  ui: ControlMessage[];
  waitForState(pred: (state: any) => boolean, timeoutMs?: number): Promise<any>;
  sendUi(msg: unknown): void;
  /** Every raw message the desktop sent on `terminal` (binary relay frames), in order. */
  terminal: Buffer[];
  /** Send a raw frame on `terminal`, as the phone's terminal screen does. */
  sendTerminal(frame: Buffer): void;
  /** Set this device's capabilities, as the person does in Settings → Devices. */
  grant(capabilities: string[]): Promise<void>;
  close(): Promise<void>;
}

export interface PairOptions {
  alias?: string;
  /** Capabilities after pairing. Omitted: the defaults a new pairing gets. */
  capabilities?: string[];
}

/**
 * Pair a phone with the harness's backend and wait until `control` is open,
 * the reconnect secret has arrived, and the first snapshot is in.
 */
export async function pairPhone(client: RestClient, opts: PairOptions = {}): Promise<Phone> {
  const alias = opts.alias ?? 'Harness phone';
  // Its own certificate. werift otherwise makes one per PROCESS, so two phones
  // in one test would present the same fingerprint and be one device to the
  // desktop — each connection replacing the other.
  const keys = await CipherContext.createSelfSignedCertificateWithKey(
    { signature: SignatureAlgorithm.ecdsa_3, hash: HashAlgorithm.sha256_4 },
    NamedCurveAlgorithm.secp256r1_23,
  );
  const pc = new RTCPeerConnection({ dtls: { keys } });
  const channels = new Map<string, any>();
  const control: ControlMessage[] = [];
  const ui: ControlMessage[] = [];
  const terminal: Buffer[] = [];
  const pending = new Map<string, { resolve: (m: any) => void; timer: ReturnType<typeof setTimeout> }>();
  let state: any = null;
  let seq = 0;

  pc.onDataChannel.subscribe((ch: any) => {
    ch.stateChanged.subscribe((s: string) => { if (s === 'open') channels.set(ch.label, ch); });
    if (ch.readyState === 'open') channels.set(ch.label, ch);
    ch.onMessage.subscribe((data: string | Buffer) => {
      if (ch.label === 'terminal') {
        terminal.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
        return;
      }
      let msg: any;
      try { msg = JSON.parse(String(data)); } catch { return; }
      if (ch.label === 'control') {
        if (msg.rpc && msg.id && pending.has(msg.id)) {
          const p = pending.get(msg.id)!;
          clearTimeout(p.timer);
          pending.delete(msg.id);
          p.resolve(msg);
          return;
        }
        control.push(msg);
      } else if (ch.label === 'ui') {
        ui.push(msg);
        if (msg.type === 'snapshot' && msg.snapshot) state = msg.snapshot;
        else if (msg.type === 'patch' && Array.isArray(msg.patch) && state) {
          state = applyPatch(JSON.parse(JSON.stringify(state)), msg.patch as Operation[]).newDocument;
        }
      }
    });
  });

  // ── The ceremony, as the phone does it ──────────────────────────────
  const { qrPayload } = await client.raw('POST', '/api/pairing/initiate').then((r) => r.json());
  const offerSdp = reconstructOfferSdp({
    iu: qrPayload.iu,
    ip: qrPayload.ip,
    fp: ensureColonFingerprint(qrPayload.fp),
    candidateAddrs: qrPayload.hs,
    candidatePort: qrPayload.cp,
    maxMessageSize: qrPayload.mms,
  });
  const desktopFingerprint = extractSingleFingerprint(offerSdp);
  await pc.setRemoteDescription(new RTCSessionDescription(offerSdp, 'offer'));
  await pc.setLocalDescription(await pc.createAnswer());
  const answerSdp = pc.localDescription!.sdp;
  const fingerprint = extractSingleFingerprint(answerSdp);

  const posted = await fetch(`http://127.0.0.1:${qrPayload.p}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      answer: answerSdp,
      ice: [],
      fingerprint,
      nonce: qrPayload.n,
      mac: computeAnswerMac(qrPayload.c, qrPayload.n, fingerprint),
    }),
  });
  if (!posted.ok) throw new Error(`pairing answer refused: ${posted.status} ${await posted.text()}`);

  await waitFor(
    async () => (await client.raw('GET', '/api/pairing/status').then((r) => r.json())).codeReady === true,
    { timeoutMs: 20_000, description: 'the desktop to register the answer' },
  );
  const confirmed = await client.raw('POST', '/api/pairing/confirm', {
    code: deriveConfirmationCode(qrPayload.n, desktopFingerprint, fingerprint),
    alias,
    deviceType: 'mobile',
  });
  if (!confirmed.ok) throw new Error(`pairing confirm refused: ${confirmed.status} ${await confirmed.text()}`);

  await waitFor(() => channels.has('control') && channels.has('ui'), { timeoutMs: 25_000, description: 'control and ui to open' });
  await waitFor(() => control.some((m) => m.type === 'pairing.secret'), { timeoutMs: 15_000, description: 'the pairing secret' });
  await waitFor(() => state !== null, { timeoutMs: 15_000, description: 'the first snapshot' });

  const send = (label: string, msg: unknown) => {
    const ch = channels.get(label);
    if (!ch) throw new Error(`${label} channel is not open`);
    ch.send(JSON.stringify(msg));
  };

  const call = (method: string, params: Record<string, unknown> = {}, timeoutMs = 20_000) =>
    new Promise<{ result?: any; error?: string }>((resolve, reject) => {
      const id = `harness-${++seq}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method}: no reply in ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, { resolve, timer });
      send('control', { rpc: true, id, method, params });
    });

  const phone: Phone = {
    fingerprint,
    alias,
    async rpc(method, params, timeoutMs) {
      const reply = await call(method, params, timeoutMs);
      if (reply.error !== undefined) throw new Error(`${method}: ${reply.error}`);
      return reply.result;
    },
    async rpcError(method, params) {
      const reply = await call(method, params);
      if (reply.error === undefined) throw new Error(`${method} succeeded: ${JSON.stringify(reply.result)?.slice(0, 300)}`);
      return reply.error;
    },
    control,
    async waitForControl(pred, timeoutMs = 15_000) {
      let found: ControlMessage | undefined;
      await waitFor(() => (found = control.find(pred)) !== undefined, { timeoutMs, description: 'a control message' });
      return found!;
    },
    sendControl: (msg) => send('control', msg),
    state: () => state,
    ui,
    async waitForState(pred, timeoutMs = 15_000) {
      await waitFor(() => state !== null && pred(state), { timeoutMs, description: 'the phone\'s state' });
      return state;
    },
    sendUi: (msg) => send('ui', msg),
    terminal,
    sendTerminal: (frame) => {
      const ch = channels.get('terminal');
      if (!ch) throw new Error('terminal channel is not open');
      ch.send(frame);
    },
    async grant(capabilities) {
      const res = await client.raw('PATCH', `/api/peers/devices/${encodeURIComponent(fingerprint)}`, { capabilities });
      if (!res.ok) throw new Error(`grant refused: ${res.status} ${await res.text()}`);
    },
    async close() {
      for (const p of pending.values()) clearTimeout(p.timer);
      await pc.close().catch(() => {});
    },
  };

  if (opts.capabilities) await phone.grant(opts.capabilities);
  return phone;
}
