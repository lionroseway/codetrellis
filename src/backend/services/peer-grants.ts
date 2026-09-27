/**
 * What a connected paired device may do, for the transports that are not
 * RPC (Phase 32 §0.4j/0.4k).
 *
 * RPC calls go through `assertPeerMayCall` and its method matrix. The raw
 * channels — the terminal relay, the audio relay — have no method to look up,
 * so they ask here instead: the grant, on a pairing confirmed on the desktop.
 * One rule for both, so a relay cannot drift from the matrix it stands beside.
 */

import { getPairedDevice } from './paired-device-service';
import { DEFAULT_GRANTS, type PeerCapability } from './peer-capabilities';

export function peerHolds(fingerprint: string, capability: PeerCapability): boolean {
  const device = getPairedDevice(fingerprint);
  if (!device?.confirmedAt) return false;
  return (device.capabilities ?? DEFAULT_GRANTS).includes(capability);
}
