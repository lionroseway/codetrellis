/**
 * MCP tools for Phase 9 + 10 — peer discovery, device management,
 * and multi-device collaboration.
 *
 * Phase 9 tools:
 *   - get_peer_status — overview of discovery, pairing, connections
 *   - list_discovered_peers — mDNS-discovered instances on the LAN
 *   - list_paired_devices — devices that have completed QR pairing
 *   - list_peer_connections — active WebRTC connections
 *   - unpair_device — remove a paired device
 *
 * Phase 10 tools:
 *   - get_remote_state — workspace state from a connected peer
 *   - list_remote_terminals — terminals on connected peers
 *   - write_remote_terminal — type into a remote terminal
 *   - get_remote_audio — audio status from connected peers
 *   - list_remote_input_requests — pending user-input prompts from remote agents
 *   - respond_remote_input — answer a remote agent's input request
 */

// [codemod] hoisted lazy requires → static namespace imports for bundling
import * as _lazy_______services_peer_connection_service from '../../services/peer-connection-service';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerPeerTools(server: McpServer): void {
  server.tool(
    'get_peer_status',
    'Get the status of the peer connection manager: discovery state, paired device count, connected peer count, whether pairing is active.',
    {},
    async () => {
      try {
        const peerService = _lazy_______services_peer_connection_service;
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
        const peerService = _lazy_______services_peer_connection_service;
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
        const peerService = _lazy_______services_peer_connection_service;
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
        const peerService = _lazy_______services_peer_connection_service;
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
        const peerService = _lazy_______services_peer_connection_service;
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

  // =========================================================================
  // Phase 10 — Multi-device collaboration tools
  // =========================================================================

  server.tool(
    'get_remote_state',
    'Get the workspace state snapshot from a connected peer. Shows their plans, agent sessions, channel events, and audio status. ' +
    'If no fingerprint is given, returns state from all connected peers.',
    {
      fingerprint: z.string().optional().describe('DTLS fingerprint of a specific peer. Omit for all peers.'),
    },
    async ({ fingerprint }) => {
      try {
        const peerService = _lazy_______services_peer_connection_service;

        if (fingerprint) {
          const state = peerService.getRemoteState(fingerprint);
          if (!state) {
            return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No state from this peer — not connected or no snapshot received yet.' }) }] };
          }
          return { content: [{ type: 'text' as const, text: JSON.stringify(state) }] };
        }

        const allStates = peerService.getAllRemoteStates();
        const result: Record<string, unknown> = {};
        for (const [fp, state] of allStates) {
          result[fp] = state;
        }
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ peerCount: allStates.size, states: result }),
          }],
        };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  );

  server.tool(
    'list_remote_terminals',
    'List terminals running on connected peers. Remote terminals can be viewed and controlled from this machine. ' +
    'Each terminal shows the peer it belongs to, the agent preset, title, and whether it is alive.',
    {
      fingerprint: z.string().optional().describe('Filter to a specific peer. Omit for all peers.'),
    },
    async ({ fingerprint }) => {
      try {
        const peerService = _lazy_______services_peer_connection_service;

        const terminals = fingerprint
          ? peerService.getRemoteTerminalsForPeer(fingerprint)
          : peerService.getRemoteTerminals();

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              count: terminals.length,
              terminals: terminals.map((t: { id: string; preset: string; title: string; cwd: string; alive: boolean; peerFingerprint: string }) => ({
                id: t.id,
                preset: t.preset,
                title: t.title,
                cwd: t.cwd,
                alive: t.alive,
                peerFingerprint: t.peerFingerprint,
              })),
            }),
          }],
        };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  );

  server.tool(
    'write_remote_terminal',
    'Send input to a terminal running on a connected peer. Use this to type commands into remote terminals. ' +
    'Append \\n to execute the command.',
    {
      fingerprint: z.string().describe('DTLS fingerprint of the peer that owns the terminal.'),
      terminal_id: z.string().describe('ID of the remote terminal.'),
      data: z.string().describe('The text to send to the terminal. Include \\n to press Enter.'),
    },
    async ({ fingerprint, terminal_id, data }) => {
      try {
        const peerService = _lazy_______services_peer_connection_service;
        const sent = peerService.writeRemoteTerminal(fingerprint, terminal_id, data);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              sent,
              message: sent ? `Sent ${data.length} chars to remote terminal ${terminal_id}` : 'Failed — terminal not found or peer not connected',
            }),
          }],
        };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  );

  server.tool(
    'get_remote_audio',
    'Get audio capture status from connected peers. Shows which peers are capturing audio and how much is buffered. ' +
    'When a peer is capturing with shareAudio enabled, their audio is automatically fed into this instance\'s audio buffer.',
    {},
    async () => {
      try {
        const peerService = _lazy_______services_peer_connection_service;
        const statuses = peerService.getRemoteAudioStatuses();
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              count: statuses.length,
              peers: statuses,
            }),
          }],
        };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  );

  server.tool(
    'list_remote_input_requests',
    'List pending user-input requests from agents running on connected peers. These are prompts that remote agents ' +
    'have sent via await_user_input — you can respond from this machine to unblock them.',
    {},
    async () => {
      try {
        const peerService = _lazy_______services_peer_connection_service;
        const requests = peerService.getPendingInputRequests();
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              count: requests.length,
              requests,
            }),
          }],
        };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  );

  server.tool(
    'respond_remote_input',
    'Respond to a pending user-input request from a remote agent. The response is sent to the peer where the agent is running, ' +
    'unblocking the agent. First response wins — if the local user already answered, this is a no-op.',
    {
      request_id: z.string().describe('ID of the input request to respond to.'),
      response: z.string().describe('The response text to send back to the remote agent.'),
    },
    async ({ request_id, response }) => {
      try {
        const peerService = _lazy_______services_peer_connection_service;
        const sent = peerService.respondToInputRequest(request_id, response);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              sent,
              message: sent ? 'Response sent to remote agent' : 'Request not found or already answered',
            }),
          }],
        };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }], isError: true };
      }
    },
  );
}
