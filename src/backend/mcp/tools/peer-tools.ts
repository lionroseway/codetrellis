/**
 * MCP tools for Phase 9 — peer discovery and device management.
 *
 * Tools:
 *   - get_peer_status — overview of discovery, pairing, connections
 *   - list_discovered_peers — mDNS-discovered instances on the LAN
 *   - list_paired_devices — devices that have completed QR pairing
 *   - list_peer_connections — active WebRTC connections
 *   - unpair_device — remove a paired device
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerPeerTools(server: McpServer): void {
  server.tool(
    'get_peer_status',
    'Get the status of the peer connection manager: discovery state, paired device count, connected peer count, whether pairing is active.',
    {},
    async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const peerService = require('../../services/peer-connection-service');
        const status = peerService.getPeerManagerStatus();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(status) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'list_discovered_peers',
    'List CodeTrellis instances discovered on the local network via mDNS. These are nearby devices that could be paired.',
    {},
    async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const peerService = require('../../services/peer-connection-service');
        const peers = peerService.getDiscoveredDevices();
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              count: peers.length,
              peers,
            }),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'list_paired_devices',
    'List all devices that have completed the QR-code pairing handshake. Paired devices can auto-reconnect.',
    {},
    async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const peerService = require('../../services/peer-connection-service');
        const devices = peerService.getDevices();
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              count: devices.length,
              devices: devices.map((d: { fingerprint: string; alias: string; deviceType: string; pairedAt: string; lastConnected: string | null }) => ({
                fingerprint: d.fingerprint,
                alias: d.alias,
                deviceType: d.deviceType,
                pairedAt: d.pairedAt,
                lastConnected: d.lastConnected,
              })),
            }),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'list_peer_connections',
    'List active WebRTC connections to paired devices. Shows connection state, latency, and open data channels.',
    {},
    async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const peerService = require('../../services/peer-connection-service');
        const connections = peerService.getConnections();
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              count: connections.length,
              connections,
            }),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'unpair_device',
    'Remove a paired device. Disconnects the WebRTC connection and deletes the stored pairing. The device will need to re-pair via QR code to connect again.',
    {
      fingerprint: z.string().describe('DTLS fingerprint of the device to unpair'),
    },
    async ({ fingerprint }) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const peerService = require('../../services/peer-connection-service');
        const removed = await peerService.unpairDevice(fingerprint);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              removed,
              message: removed
                ? `Device ${fingerprint.slice(0, 12)}… unpaired`
                : `No device found with fingerprint ${fingerprint.slice(0, 12)}…`,
            }),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }],
          isError: true,
        };
      }
    },
  );
}
