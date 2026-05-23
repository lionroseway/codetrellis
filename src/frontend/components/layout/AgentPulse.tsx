/**
 * AgentPulse — subtle inward glow that fires whenever an MCP agent
 * drives a UI change (navigation, graph control, terminal focus, etc.).
 *
 * Gives the human a visual cue that "the agent just did that, not me"
 * without being distracting. The effect is a dispersed inward glow —
 * strongest at the outer edge, feathering toward the centre — that
 * blooms in quickly and dissipates slowly over ~2s.
 *
 * Listens for the custom DOM event `agent-ui-action` dispatched by
 * the WebSocket handler whenever it processes a `ui-*` broadcast.
 */

import { useEffect, useRef, useState } from 'react';

export function AgentPulse() {
  const [active, setActive] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handler = () => {
      // Clear any existing fade-out timer so rapid-fire actions
      // keep the pulse alive rather than flickering.
      if (timerRef.current) clearTimeout(timerRef.current);
      setActive(true);
      timerRef.current = setTimeout(() => setActive(false), 1100);
    };

    window.addEventListener('agent-ui-action', handler);
    return () => {
      window.removeEventListener('agent-ui-action', handler);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[9999]"
      style={{
        opacity: active ? 1 : 0,
        // Bloom in fast, dissipate slow.
        transition: active ? 'opacity 220ms ease-out' : 'opacity 850ms ease-in',
        // Strong, vivid indigo concentrated at the outer edge (spread 0 +
        // tight blur), feathering deep inward via progressively wider blurs.
        // Low per-layer alpha keeps it a glow, not an opaque wash.
        boxShadow: [
          'inset 0 0 90px 0 rgba(124, 110, 255, 0.13)',
          'inset 0 0 220px 0 rgba(108, 99, 246, 0.07)',
          'inset 0 0 380px 0 rgba(99, 102, 241, 0.035)',
        ].join(', '),
      }}
    />
  );
}
