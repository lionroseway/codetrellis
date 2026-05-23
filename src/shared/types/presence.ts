/**
 * Agent Presence Pane — shared types.
 *
 * The presence pane is an ephemeral floating UI surface where MCP
 * agents can post narration cards, optionally spoken aloud via TTS.
 * Cards can request acknowledgement; users can reply. All in-memory,
 * no DB persistence.
 */

export type PresenceTone = 'neutral' | 'success' | 'warning' | 'question';

export interface PresenceCard {
  id: string;               // "pc-<timestamp>-<random>"
  text: string;             // markdown-lite body (bold, code, links)
  speak: boolean;           // trigger TTS on the frontend
  requireAck: boolean;      // show "Got it" button, block await_ack
  tone: PresenceTone;
  linkTo: string | null;    // node ID or item UID to visually anchor
  agentId: string | null;   // MCP session agent type
  createdAt: number;        // epoch ms
  acked: boolean;
  ackedAt: number | null;
  ackedVia: 'click' | 'speech-end' | 'timeout' | null;
}

export interface UserReply {
  id: string;               // "pr-<timestamp>-<random>"
  text: string;
  createdAt: number;
}
