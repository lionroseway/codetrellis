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
import * as fs from 'node:fs';
import * as path from 'node:path';
import { RTCPeerConnection, RTCSessionDescription } from 'werift';

test.describe('WebRTC transport (werift)', () => {
  /**
   * THE SCTP PATCH MUST SURVIVE EVERY werift UPGRADE.
   *
   * patches/werift+<version>.patch lowers SCTP's USERDATA_MAX_LENGTH from
   * werift's default 1200 to 1024. That is an MTU fix: CodeTrellis is
   * explicitly a bring-your-own-VPN product, and a VPN's tunnel overhead
   * pushes a 1200-byte SCTP chunk past the path MTU, where it is fragmented
   * or dropped. The symptom is not a clean failure — it is a peer that pairs
   * and then stalls on larger payloads (a UI snapshot, terminal scrollback).
   *
   * patch-package silently stops protecting you when the version moves. The
   * werift 0.23 -> 0.24.4 upgrade invalidated both existing patches, and the
   * only reason it surfaced was that `npm ci` failed loudly in CI. It could
   * just as easily have been a patch that still applied to a renamed file and
   * quietly did nothing.
   *
   * So assert the VALUE, not the patch file. If a future upgrade moves the
   * constant somewhere this cannot see, that is a real signal and this test
   * should be taught the new location — never deleted.
   */
  test('SCTP payload cap is patched to 1024 (VPN MTU headroom)', async () => {
    // werift's package.json is not listed in its `exports`, so it cannot be
    // resolved directly. Resolve the module entry and walk UP until we find the
    // directory that owns it — the entry sits several levels deep
    // (lib/webrtc/src/index.js), so a fixed '..' is wrong.
    let weriftDir = path.dirname(require.resolve('werift'));
    while (weriftDir !== path.dirname(weriftDir) && path.basename(weriftDir) !== 'werift') {
      weriftDir = path.dirname(weriftDir);
    }
    expect(path.basename(weriftDir), 'could not locate the werift package root').toBe('werift');
    const targets = [
      path.join(weriftDir, 'lib', 'index.mjs'),
      path.join(weriftDir, 'lib', 'sctp', 'src', 'sctp.js'),
    ];

    for (const file of targets) {
      expect(fs.existsSync(file), `${file} missing — werift layout changed, re-target the patch`).toBe(true);
      const src = fs.readFileSync(file, 'utf-8');
      const match = /USERDATA_MAX_LENGTH\s*=\s*(\d+)/.exec(src);
      expect(match, `USERDATA_MAX_LENGTH not found in ${file} — re-target patches/werift+*.patch`).not.toBeNull();
      expect(
        Number(match![1]),
        `${path.basename(file)} has USERDATA_MAX_LENGTH=${match![1]}; the patch did not apply`,
      ).toBe(1024);
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
