/**
 * The phone's WebRTC link in the preview (Phase 32 A4.5b): never connected.
 * The screens read the desktop through the rpc stub instead; a module that
 * imports `webrtc` only to send (push registration) finds nothing to send on.
 */

export const webrtc = {
  state: 'disconnected' as const,
  sendControl: (): boolean => false,
  send: (): boolean => false,
  disconnect: (): void => {},
};

export function isRepairRequired(): boolean { return false; }
