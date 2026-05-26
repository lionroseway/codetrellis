import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Smartphone, Monitor, Wifi, WifiOff, QrCode, X, Trash2 } from 'lucide-react';
import type { PairedDevice, PeerConnectionInfo, DiscoveredPeer } from '@shared/types';

/**
 * Phase 9.4 — Device indicator in the TopBar.
 *
 * Shows the number of connected peers. Click to open a popover with:
 *   - Connected peers (with connection state)
 *   - Paired devices (with last-seen)
 *   - Discovered peers on the LAN
 *   - "Pair new device" button
 *
 * Modelled after ConnectedAgents.
 */

interface PeerStatus {
  running: boolean;
  instanceId: string;
  discoveryActive: boolean;
  discoveredPeers: number;
  pairedDevices: number;
  connectedPeers: number;
  pairingActive: boolean;
}

function deviceIcon(deviceType: string) {
  return deviceType === 'mobile' ? Smartphone : Monitor;
}

function connectionBadge(state: string): { color: string; label: string } {
  switch (state) {
    case 'connected': return { color: 'bg-emerald-400', label: 'Connected' };
    case 'connecting': return { color: 'bg-amber-400 animate-pulse', label: 'Connecting' };
    case 'reconnecting': return { color: 'bg-amber-400 animate-pulse', label: 'Reconnecting' };
    case 'failed': return { color: 'bg-red-400', label: 'Failed' };
    default: return { color: 'bg-zinc-500', label: 'Disconnected' };
  }
}

export function DeviceIndicator() {
  const [status, setStatus] = useState<PeerStatus | null>(null);
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [connections, setConnections] = useState<PeerConnectionInfo[]>([]);
  const [discovered, setDiscovered] = useState<DiscoveredPeer[]>([]);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Poll status every 5 seconds
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const [statusRes, devicesRes, connectionsRes, discoveredRes] = await Promise.all([
          fetch('/api/peers/status'),
          fetch('/api/peers/devices'),
          fetch('/api/peers/connections'),
          fetch('/api/peers/discovered'),
        ]);
        setStatus(await statusRes.json());
        setDevices(await devicesRes.json());
        setConnections(await connectionsRes.json());
        setDiscovered(await discoveredRes.json());
      } catch { /* network error */ }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 5_000);
    return () => clearInterval(interval);
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node) &&
          btnRef.current && !btnRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const connectedCount = status?.connectedPeers ?? 0;
  const hasDevices = devices.length > 0 || discovered.length > 0;

  const handleToggle = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setOpen(!open);
  };

  const handleUnpair = async (fingerprint: string) => {
    try {
      await fetch(`/api/peers/devices/${encodeURIComponent(fingerprint)}`, { method: 'DELETE' });
      setDevices((prev) => prev.filter((d) => d.fingerprint !== fingerprint));
    } catch { /* ignore */ }
  };

  const handleInitiatePairing = async () => {
    try {
      await fetch('/api/pairing/initiate', { method: 'POST' });
      // TODO: open QR modal
    } catch { /* ignore */ }
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleToggle}
        className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
          connectedCount > 0
            ? 'bg-emerald-900/40 text-emerald-300 hover:bg-emerald-900/60'
            : hasDevices
              ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700'
        }`}
        title={`${connectedCount} device${connectedCount === 1 ? '' : 's'} connected`}
      >
        {connectedCount > 0 ? (
          <Wifi className="w-3.5 h-3.5" />
        ) : (
          <WifiOff className="w-3.5 h-3.5" />
        )}
        <span>{connectedCount > 0 ? connectedCount : 'Devices'}</span>
      </button>

      {open && createPortal(
        <div
          ref={wrapperRef}
          className="fixed z-50 w-80 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl overflow-hidden"
          style={{ top: pos.top, right: pos.right }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700">
            <span className="text-sm font-medium text-zinc-200">Devices</span>
            <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-300">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {/* Connected peers */}
            {connections.length > 0 && (
              <div className="px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Connected</div>
                {connections.map((conn) => {
                  const Icon = deviceIcon(conn.deviceType);
                  const badge = connectionBadge(conn.state);
                  return (
                    <div key={conn.fingerprint} className="flex items-center gap-2 py-1.5">
                      <Icon className="w-4 h-4 text-zinc-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-zinc-200 truncate">{conn.alias}</div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <div className={`w-1.5 h-1.5 rounded-full ${badge.color}`} />
                          <span className="text-[10px] text-zinc-500">{badge.label}</span>
                          {conn.latencyMs !== null && (
                            <span className="text-[10px] text-zinc-600 ml-1">{conn.latencyMs}ms</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Paired devices */}
            {devices.length > 0 && (
              <div className="px-3 py-2 border-t border-zinc-800">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Paired devices</div>
                {devices.map((device) => {
                  const Icon = deviceIcon(device.deviceType);
                  const isConnected = connections.some((c) => c.fingerprint === device.fingerprint);
                  return (
                    <div key={device.fingerprint} className="flex items-center gap-2 py-1.5 group">
                      <Icon className="w-4 h-4 text-zinc-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-zinc-200 truncate">{device.alias}</div>
                        <div className="text-[10px] text-zinc-500">
                          {isConnected ? 'Connected' : device.lastConnected
                            ? `Last seen ${new Date(device.lastConnected).toLocaleDateString()}`
                            : 'Never connected'}
                        </div>
                      </div>
                      <button
                        onClick={() => handleUnpair(device.fingerprint)}
                        className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-opacity"
                        title="Unpair device"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Discovered peers */}
            {discovered.length > 0 && (
              <div className="px-3 py-2 border-t border-zinc-800">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Nearby</div>
                {discovered.map((peer) => (
                  <div key={peer.instanceId} className="flex items-center gap-2 py-1.5">
                    <Monitor className="w-4 h-4 text-zinc-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-zinc-300 truncate">{peer.name}</div>
                      <div className="text-[10px] text-zinc-500">{peer.address} &middot; v{peer.version}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Empty state */}
            {devices.length === 0 && connections.length === 0 && discovered.length === 0 && (
              <div className="px-3 py-4 text-center">
                <WifiOff className="w-6 h-6 text-zinc-600 mx-auto mb-2" />
                <div className="text-xs text-zinc-500">No devices found</div>
                <div className="text-[10px] text-zinc-600 mt-1">
                  Pair a device to view your workspace remotely
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-3 py-2 border-t border-zinc-700">
            <button
              onClick={handleInitiatePairing}
              className="flex items-center gap-1.5 w-full px-2 py-1.5 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
            >
              <QrCode className="w-3.5 h-3.5" />
              Pair new device
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
