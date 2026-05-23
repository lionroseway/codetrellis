/**
 * AgentPulse — subtle inward glow that fires whenever an MCP agent
 * drives a UI change (navigation, graph control, terminal focus, etc.).
 *
 * Gives the human a visual cue that "the agent just did that, not me"
 * without being distracting. The effect is a soft inward box-shadow
 * that fades in and out over ~800ms.
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
      timerRef.current = setTimeout(() => setActive(false), 800);
    };

    window.addEventListener('agent-ui-action', handler);
    return () => {
      window.removeEventListener('agent-ui-action', handler);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[9999] transition-opacity duration-500"
      style={{
        opacity: active ? 1 : 0,
        boxShadow: 'inset 0 0 80px 20px rgba(99, 102, 241, 0.08), inset 0 0 20px 5px rgba(99, 102, 241, 0.05)',
      }}
    />
  );
}
