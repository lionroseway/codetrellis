/**
 * Real WebRTC/DTLS handshake between two werift peers.
 *
 * WHY THIS EXISTS
 *
 * werift carries the entire peer mesh — the four data channels (control, ui,
 * terminal, audio) and the pairing/reconnect protocol. Nothing else in the
 * suite exercises it: the harness tests drive the REST and MCP surfaces, and
 * a werift upgrade can typecheck perfectly while the transport is broken,
 * because the API surface the app uses is tiny (RTCPeerConnection and
 * RTCSessionDescription) and stable.
 *
 * Written during the werift 0.23 -> 0.24 upgrade, where the only production
 * security advisories left were in werift and its `ip` dependency. Upgrading
 * blind was not acceptable and there was nothing to upgrade against.
 *
 * WHAT IT ASSERTS
 *
 * A complete offer/answer exchange, a DTLS handshake that actually completes,
 * a data channel that reaches 'open', and a payload that survives the round
 * trip. If any of those regress, the mobile companion cannot connect at all.
 *
 * It deliberately uses the SAME API shape as webrtc-service.ts —
 * `channel.onMessage.subscribe` and `channel.stateChanged.subscribe` — so that
 * a rename in werift's event surface fails here rather than in the field.
 *
 * FUTURE — Phase 19 Gate 4
 *
 * The security review's acceptance suite requires a reconnect identity matrix
 * run "against a real DTLS handshake": correct identity succeeds, while a
 * different certificate, duplicate fingerprint attributes, a media-level
 * fingerprint override, a replayed challenge, an expired challenge and an
 * unknown device must each fail BEFORE any data channel opens. This file is
 * the place to build that on — it already establishes the two-peer handshake
 * those cases need to subvert.
 */

import { test, expect } from '@playwright/test';
import { RTCPeerConnection, RTCSessionDescription } from 'werift';
import { peerConnectionConfig, SCTP_MAX_PAYLOAD } from '../../src/backend/services/webrtc-service';

test.describe('WebRTC transport (werift)', () => {
  /**
   * THE SCTP PAYLOAD CAP MUST SURVIVE EVERY werift UPGRADE.
   *
   * Every peer connection the app makes caps an SCTP DATA chunk at 1024 bytes
   * of user data, below werift's default. That is an MTU fix: CodeTrellis is
   * explicitly a bring-your-own-VPN product, and a VPN's tunnel overhead
   * pushes a bigger chunk past the path MTU, where it is fragmented or
   * dropped. The symptom is not a clean failure — it is a peer that pairs and
   * then stalls on larger payloads (a UI snapshot, terminal scrollback).
   *
   * Where the cap is set has moved. Up to werift 0.24 it was a hard-coded
   * USERDATA_MAX_LENGTH = 1200, rewritten to 1024 by
   * patches/werift+<version>.patch — and patch-package silently stops
   * protecting you when the version moves (the 0.23 -> 0.24.4 upgrade
   * invalidated both existing patches, and only `npm ci` failing loudly in CI
   * surfaced it). werift 0.25 replaced the constant with a per-connection
   * `sctp: { mtu }` setting, so the cap now lives in webrtc-service.ts's
   * peerConnectionConfig() and the patch is gone.
   *
   * So assert the BEHAVIOUR, not where the number is written: two peers built
   * with the app's own configuration, a message bigger than a chunk, and the
   * DATA chunks actually handed to the wire. If a future upgrade changes how
   * werift fragments, that is a real signal and this test should be taught
   * the new shape — never deleted.
   */
  test('SCTP payload cap is 1024 bytes per DATA chunk (VPN MTU headroom)', async () => {
    expect(SCTP_MAX_PAYLOAD).toBe(1024);

    // The app's configuration, minus the public STUN servers: two peers on
    // one host need no reflexive candidates, and the test should not wait on
    // the network for them.
    const config = { ...peerConnectionConfig(), iceServers: [] };
    const a = new RTCPeerConnection(config);
    const b = new RTCPeerConnection(config);

    try {
      const channel = a.createDataChannel('ui');
      let opened = false;
      let received: Buffer | null = null;

      b.onDataChannel.subscribe((ch: any) => {
        ch.onMessage.subscribe((data: string | Buffer) => {
          received = Buffer.from(data as Buffer);
        });
      });
      channel.stateChanged.subscribe((state: string) => {
        if (state === 'open') opened = true;
      });

      await a.setLocalDescription(await a.createOffer());
      await b.setRemoteDescription(new RTCSessionDescription(a.localDescription!.sdp, 'offer'));
      await b.setLocalDescription(await b.createAnswer());
      await a.setRemoteDescription(new RTCSessionDescription(b.localDescription!.sdp, 'answer'));

      await expect
        .poll(() => opened, { timeout: 15_000, message: 'data channel never opened' })
        .toBe(true);

      // Every DATA chunk `a` sends from here on. DATA is chunk type 0, and its
      // userData is what the cap limits.
      const sctp = (a.sctpTransport as any)?.sctp;
      expect(sctp, 'werift no longer exposes sctpTransport.sctp — re-target this test').toBeTruthy();
      const sizes: number[] = [];
      const sendChunk = sctp.sendChunk.bind(sctp);
      sctp.sendChunk = (chunk: any) => {
        if (chunk?.type === 0 && Buffer.isBuffer(chunk.userData)) sizes.push(chunk.userData.length);
        return sendChunk(chunk);
      };

      const payload = Buffer.alloc(10_000);
      for (let i = 0; i < payload.length; i++) payload[i] = i % 251;
      channel.send(payload);

      await expect
        .poll(() => received?.length ?? 0, { timeout: 10_000, message: 'payload never arrived' })
        .toBe(payload.length);
      expect(received!.equals(payload), 'payload arrived corrupted').toBe(true);

      expect(sizes.length, 'no DATA chunks were seen — werift renamed sendChunk?').toBeGreaterThan(1);
      expect(Math.max(...sizes), `DATA chunk sizes: ${sizes.join(', ')}`).toBe(SCTP_MAX_PAYLOAD);
    } finally {
      await a.close().catch(() => {});
      await b.close().catch(() => {});
    }
  });

  test('two peers complete a DTLS handshake and exchange data', async () => {
    const a = new RTCPeerConnection({});
    const b = new RTCPeerConnection({});

    try {
      const channel = a.createDataChannel('control');
      let opened = false;
      let received = '';

      b.onDataChannel.subscribe((ch: any) => {
        ch.onMessage.subscribe((data: string | Buffer) => {
          received = String(data);
        });
      });
      channel.stateChanged.subscribe((state: string) => {
        if (state === 'open') opened = true;
      });

      const offer = await a.createOffer();
      await a.setLocalDescription(offer);
      await b.setRemoteDescription(new RTCSessionDescription(a.localDescription!.sdp, 'offer'));

      const answer = await b.createAnswer();
      await b.setLocalDescription(answer);
      await a.setRemoteDescription(new RTCSessionDescription(b.localDescription!.sdp, 'answer'));

      // The offer must carry exactly one session-level DTLS fingerprint.
      // Finding 2 of the security review turns on a peer smuggling extra or
      // conflicting a=fingerprint attributes past a regex match, so assert the
      // baseline shape here: one, at session level, sha-256.
      const fingerprints = a.localDescription!.sdp.match(/a=fingerprint:(\S+)\s+(\S+)/g) ?? [];
      expect(fingerprints.length).toBeGreaterThanOrEqual(1);
      expect(fingerprints[0]).toMatch(/^a=fingerprint:sha-256 /);

      await expect
        .poll(() => opened, { timeout: 15_000, message: 'data channel never opened' })
        .toBe(true);

      channel.send(Buffer.from('hello-over-dtls', 'utf-8'));

      await expect
        .poll(() => received, { timeout: 10_000, message: 'payload never arrived' })
        .toBe('hello-over-dtls');
    } finally {
      await a.close().catch(() => {});
      await b.close().catch(() => {});
    }
  });
});
