/**
 * RemotePeersPanel — Phase 10 of the CDev target architecture.
 *
 * Shows the workspace state of connected peers: their plans, agent
 * sessions, terminals, and audio status. Appears in the sidebar when
 * at least one peer is connected.
 *
 * Polls REST endpoints:
 *   - GET /api/peers/remote-state    → plan/agent/channel summaries
 *   - GET /api/peers/remote-terminals → terminal list
 *   - GET /api/peers/remote-audio    → audio forwarding status
 *   - GET /api/peers/remote-input-requests → pending prompts
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  Monitor,
  Terminal,
  Mic,
  MicOff,
  MessageCircle,
  ChevronDown,
  ChevronRight,
  Circle,
  Wifi,
} from 'lucide-react';

// --- Types (mirroring backend shapes) ----------------------------------------

interface PlanSummary {
  uid: string;
  name: string;
  status: string;
  itemCount: number;
  doneCount: number;
  inProgressCount: number;
}

interface AgentSummary {
  sessionId: string;
  agentType: string;
  model: string;
  activePlan: string | null;
}

interface RemoteState {
  plans: PlanSummary[];
  agents: AgentSummary[];
  audio: { capturing: boolean; bufferedSeconds: number };
}

interface RemoteTerminal {
  id: string;
  preset: string;
  title: string;
  cwd: string;
  alive: boolean;
  peerFingerprint: string;
}

interface RemoteAudioStatus {
  peerFingerprint: string;
  capturing: boolean;
  bufferedSeconds: number;
}

interface RemoteInputRequest {
  requestId: string;
  peerFingerprint: string;
  prompt: string;
  options?: string[];
  receivedAt: number;
  answered: boolean;
}

interface PeerData {
  fingerprint: string;
  state?: RemoteState;
  terminals: RemoteTerminal[];
  audio?: RemoteAudioStatus;
  inputRequests: RemoteInputRequest[];
}

// --- Component ---------------------------------------------------------------

const POLL_INTERVAL = 5_000;

export const RemotePeersPanel: React.FC = () => {
  const [peers, setPeers] = useState<Map<string, PeerData>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const [responseText, setResponseText] = useState('');

  const fetchPeerData = useCallback(async () => {
    try {
      const [stateRes, termRes, audioRes, inputRes] = await Promise.all([
        fetch('/api/peers/remote-state'),
        fetch('/api/peers/remote-terminals'),
        fetch('/api/peers/remote-audio'),
        fetch('/api/peers/remote-input-requests'),
      ]);

      const stateData = await stateRes.json();
      const termData = await termRes.json();
      const audioData = await audioRes.json();
      const inputData = await inputRes.json();

      const newPeers = new Map<string, PeerData>();

      // Build peer map from remote state
      if (stateData.states) {
        for (const [fp, state] of Object.entries(stateData.states)) {
          newPeers.set(fp, {
            fingerprint: fp,
            state: state as RemoteState,
            terminals: [],
            inputRequests: [],
          });
        }
      }

      // Add terminals
      for (const t of termData.terminals ?? []) {
        let peer = newPeers.get(t.peerFingerprint);
        if (!peer) {
          peer = { fingerprint: t.peerFingerprint, terminals: [], inputRequests: [] };
          newPeers.set(t.peerFingerprint, peer);
        }
        peer.terminals.push(t);
      }

      // Add audio
      for (const a of audioData.peers ?? []) {
        const peer = newPeers.get(a.peerFingerprint);
        if (peer) peer.audio = a;
      }

      // Add input requests
      for (const r of inputData.requests ?? []) {
        const peer = newPeers.get(r.peerFingerprint);
        if (peer) peer.inputRequests.push(r);
      }

      setPeers(newPeers);
    } catch {
      // Network error — ignore, will retry
    }
  }, []);

  useEffect(() => {
    fetchPeerData();
    const timer = setInterval(fetchPeerData, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [fetchPeerData]);

  const toggleExpanded = (fp: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(fp)) next.delete(fp);
      else next.add(fp);
      return next;
    });
  };

  const handleRespond = async (requestId: string) => {
    if (!responseText.trim()) return;
    try {
      await fetch(`/api/peers/remote-input-requests/${requestId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: responseText }),
      });
      setRespondingTo(null);
      setResponseText('');
      fetchPeerData();
    } catch {
      // ignore
    }
  };

  if (peers.size === 0) return null;

  return (
    <div className="border-t border-zinc-700/50 pt-2 mt-2">
      <div className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-zinc-400 uppercase tracking-wide">
        <Wifi className="w-3.5 h-3.5" />
        Connected Peers ({peers.size})
      </div>

      {Array.from(peers.values()).map((peer) => (
        <PeerRow
          key={peer.fingerprint}
          peer={peer}
          isExpanded={expanded.has(peer.fingerprint)}
          onToggle={() => toggleExpanded(peer.fingerprint)}
          respondingTo={respondingTo}
          responseText={responseText}
          onStartRespond={setRespondingTo}
          onResponseTextChange={setResponseText}
          onSubmitResponse={handleRespond}
        />
      ))}
    </div>
  );
};

// --- PeerRow -----------------------------------------------------------------

const PeerRow: React.FC<{
  peer: PeerData;
  isExpanded: boolean;
  onToggle: () => void;
  respondingTo: string | null;
  responseText: string;
  onStartRespond: (id: string | null) => void;
  onResponseTextChange: (text: string) => void;
  onSubmitResponse: (requestId: string) => void;
}> = ({ peer, isExpanded, onToggle, respondingTo, responseText, onStartRespond, onResponseTextChange, onSubmitResponse }) => {
  const fp = peer.fingerprint;
  const shortFp = fp.slice(0, 12) + '…';
  const planCount = peer.state?.plans.length ?? 0;
  const agentCount = peer.state?.agents.length ?? 0;

  return (
    <div className="mx-1 my-0.5 rounded bg-zinc-800/40">
      {/* Header */}
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 w-full px-2 py-1.5 text-left text-xs hover:bg-zinc-700/30 rounded transition-colors"
      >
        {isExpanded ? <ChevronDown className="w-3 h-3 text-zinc-500" /> : <ChevronRight className="w-3 h-3 text-zinc-500" />}
        <Monitor className="w-3.5 h-3.5 text-blue-400" />
        <span className="text-zinc-300 font-medium truncate flex-1">
          {shortFp}
        </span>

        {/* Status badges */}
        <span className="flex items-center gap-1">
          {agentCount > 0 && (
            <span className="text-[10px] bg-green-500/20 text-green-400 px-1 rounded">
              {agentCount} agent{agentCount > 1 ? 's' : ''}
            </span>
          )}
          {peer.terminals.length > 0 && (
            <Terminal className="w-3 h-3 text-zinc-500" />
          )}
          {peer.audio?.capturing && (
            <Mic className="w-3 h-3 text-red-400" />
          )}
          {peer.inputRequests.length > 0 && (
            <span className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
          )}
        </span>
      </button>

      {/* Expanded details */}
      {isExpanded && (
        <div className="px-3 pb-2 space-y-1.5 text-[11px] text-zinc-400">
          {/* Plans */}
          {planCount > 0 && (
            <div>
              <span className="text-zinc-500 font-medium">Plans:</span>
              {peer.state?.plans.map((p) => (
                <div key={p.uid} className="flex items-center gap-1 ml-2">
                  <Circle className={`w-2 h-2 ${p.status === 'active' ? 'text-green-400 fill-green-400' : 'text-zinc-500'}`} />
                  <span className="truncate">{p.name}</span>
                  <span className="text-zinc-600 ml-auto">{p.doneCount}/{p.itemCount}</span>
                </div>
              ))}
            </div>
          )}

          {/* Agents */}
          {agentCount > 0 && (
            <div>
              <span className="text-zinc-500 font-medium">Agents:</span>
              {peer.state?.agents.map((a) => (
                <div key={a.sessionId} className="flex items-center gap-1 ml-2">
                  <span className="w-1.5 h-1.5 bg-green-400 rounded-full" />
                  <span>{a.agentType}</span>
                  {a.model && <span className="text-zinc-600">({a.model})</span>}
                </div>
              ))}
            </div>
          )}

          {/* Terminals */}
          {peer.terminals.length > 0 && (
            <div>
              <span className="text-zinc-500 font-medium">Terminals:</span>
              {peer.terminals.map((t) => (
                <div key={t.id} className="flex items-center gap-1 ml-2">
                  <Terminal className="w-2.5 h-2.5" />
                  <span className="truncate">{t.title || t.preset}</span>
                  {!t.alive && <span className="text-red-400">(exited)</span>}
                </div>
              ))}
            </div>
          )}

          {/* Audio */}
          {peer.audio && (
            <div className="flex items-center gap-1">
              {peer.audio.capturing ? (
                <>
                  <Mic className="w-3 h-3 text-red-400" />
                  <span>Capturing ({peer.audio.bufferedSeconds}s buffered)</span>
                </>
              ) : (
                <>
                  <MicOff className="w-3 h-3 text-zinc-600" />
                  <span>Not capturing</span>
                </>
              )}
            </div>
          )}

          {/* Input requests */}
          {peer.inputRequests.length > 0 && (
            <div className="space-y-1">
              <span className="text-amber-400 font-medium flex items-center gap-1">
                <MessageCircle className="w-3 h-3" />
                Agent needs input:
              </span>
              {peer.inputRequests.map((r) => (
                <div key={r.requestId} className="ml-2 p-1.5 bg-amber-500/10 rounded border border-amber-500/20">
                  <p className="text-zinc-300">{r.prompt}</p>
                  {r.options && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {r.options.map((opt, i) => (
                        <button
                          key={i}
                          className="px-1.5 py-0.5 bg-zinc-700 rounded text-zinc-300 hover:bg-zinc-600"
                          onClick={() => {
                            onResponseTextChange(opt);
                            onStartRespond(r.requestId);
                          }}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  )}
                  {respondingTo === r.requestId ? (
                    <div className="flex gap-1 mt-1">
                      <input
                        type="text"
                        value={responseText}
                        onChange={(e) => onResponseTextChange(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') onSubmitResponse(r.requestId); }}
                        className="flex-1 bg-zinc-700 rounded px-1.5 py-0.5 text-zinc-200 text-[11px] outline-none border border-zinc-600 focus:border-blue-500"
                        placeholder="Type response…"
                        autoFocus
                      />
                      <button
                        onClick={() => onSubmitResponse(r.requestId)}
                        className="px-2 py-0.5 bg-blue-600 rounded text-white hover:bg-blue-500"
                      >
                        Send
                      </button>
                    </div>
                  ) : (
                    <button
                      className="mt-1 text-blue-400 hover:text-blue-300"
                      onClick={() => onStartRespond(r.requestId)}
                    >
                      Respond…
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
