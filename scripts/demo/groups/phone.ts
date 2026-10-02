/**
 * The phone (Phase 32 A4, B4.4): what the desktop says about paired phones,
 * and an agent reaching one. With no phone connected, the answers are
 * answers (none paired, none connected, the card shown on the desktop only)
 * and driving a phone is refused in words; with a person's phone connected
 * (watch mode), the card and the plans list appear on it. The real phone
 * journey needs two devices and stays manual: `docs/DEMO-JOURNEYS.md` B11.
 * Mirrors the harness tests `phone-peer-tools` and `phone-sync-and-tools`
 * (which pair a scripted phone), at the MCP surface only and with whatever
 * phone is really there. Catalogued in `docs/DEMO-JOURNEYS.md`, section
 * `phone`.
 */
import type { Ctx, Group } from '../types';
import { showSettings } from '../lib/settings';

interface PeerStatus {
  running: boolean; discoveryActive: boolean; pairedDevices: number; connectedPeers: number;
  pairingActive: boolean; mobileApi: boolean;
}

async function peerStatus(c: Ctx): Promise<PeerStatus | null> {
  const s = await c.json('get_peer_status', {});
  return s && typeof s.pairedDevices === 'number' ? s as PeerStatus : null;
}

export const phoneGroup: Group = {
  id: 'phone',
  title: 'The phone',
  scenes: [
    {
      id: 'devices',
      title: 'What the desktop knows about phones',
      watch: 'paired and connected counts that agree with each other; discovery and the phone API as separate switches',
      async run(c) {
        await c.say('The phone companion', 'A phone pairs with this desktop by QR code and talks to it peer to peer. Nothing is exposed until you turn it on in Settings → Devices.');
        const s = await peerStatus(c);
        if (!s) { c.flag('get_peer_status should answer with the paired and connected counts'); return; }
        console.log(`    discovery ${s.discoveryActive ? 'on' : 'off'}, phone API ${s.mobileApi ? 'on' : 'off'}, ${s.pairedDevices} paired, ${s.connectedPeers} connected`);
        const paired = await c.json('list_paired_devices', {});
        if (!paired || typeof paired.count !== 'number') { c.flag(`list_paired_devices should answer with a count; it said ${JSON.stringify(paired).slice(0, 120)}`); return; }
        if (paired.count !== s.pairedDevices) c.flag(`get_peer_status says ${s.pairedDevices} paired, list_paired_devices lists ${paired.count}`);
        if (s.connectedPeers > s.pairedDevices) c.flag(`${s.connectedPeers} phones connected but only ${s.pairedDevices} paired: a connection with no pairing`);
        for (const d of (paired.devices ?? []) as Array<{ alias: string; deviceType: string; lastConnected: string | null }>) {
          console.log(`    paired: ${d.alias} (${d.deviceType}), last connected ${d.lastConnected ?? 'never'}`);
        }
        await c.say(
          s.pairedDevices ? `${s.pairedDevices} phone${s.pairedDevices === 1 ? '' : 's'} paired` : 'No phone paired',
          s.connectedPeers ? 'One is connected now: the next scene shows something on it.' : 'Nothing is connected, so an agent cannot reach a phone. The next scene shows what it is told.',
        );
        await showSettings(c, 'devices', 'ph0-devices', 'Settings → Devices', 'Discovery and the phone API are separate switches, both off until you turn them on. An agent can show you this; only you can change it.');
      },
    },
    {
      id: 'reach',
      title: 'An agent reaches the phone, or is told why not',
      watch: 'with a phone: a card and the plans list on it; without one: the card on the desktop only and "No mobile device is connected"',
      async run(c) {
        const s = await peerStatus(c);
        const connected = (s?.connectedPeers ?? 0) > 0;
        const card = await c.json('mobile_present', { text: 'Hello from **CodeTrellis**: this card is on every connected surface.', tone: 'neutral' });
        if (!card?.card_id) c.flag(`mobile_present should post a card with no phone too; it said ${JSON.stringify(card).slice(0, 120)}`);
        else if (card.mobile !== connected) c.flag(`mobile_present says mobile: ${card.mobile}, but ${s?.connectedPeers ?? 0} phones are connected`);

        if (connected) {
          const r = await c.call('mobile_navigate', { view: 'plans' });
          if (r.ok && !/^Navigated [1-9]\d* phone/.test(r.answer)) c.flag(`mobile_navigate should say how many phones it reached; it said "${r.answer}"`);
          await c.say('On your phone', 'The card is there, and the phone has opened its plans list.', 'success');
        } else {
          const r = await c.refuse('mobile_navigate', { view: 'plans' });
          if (r.ok) c.flag('mobile_navigate with no phone connected should be refused');
          else if (!r.text.includes('No mobile device is connected')) c.flag(`the refusal should say no phone is connected; it says "${r.text.slice(0, 160)}"`);
          await c.say('No phone to reach', 'The card shows here only, and driving a phone is refused in words. The walk on a real phone stays manual: DEMO-JOURNEYS B11.', 'warning');
        }
        // A phone that is not there cannot be sent to a plan that is not there either; with one, that is refused before it is sent.
        const missing = await c.refuse('mobile_navigate', { plan_uid: 'no-such-plan' });
        if (missing.ok) c.flag('mobile_navigate to a plan that does not exist should be refused');
        await c.shot('ph1-reach');
        if (c.mode === 'check') await c.call('dismiss_presence', {});
      },
    },
  ],
};
