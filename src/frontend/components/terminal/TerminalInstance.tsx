/**
 * Phase 17.B / Terminal — Single terminal instance (xterm.js wrapper).
 *
 * Connects to the backend PTY via WebSocket on /ws/terminal?id=<id>.
 * Handles resize via the FitAddon. Reconnects if the WS drops.
 */

import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

export function TerminalInstance({
  sessionId,
  isVisible,
}: {
  sessionId: string;
  isVisible: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || mountedRef.current) return;
    mountedRef.current = true;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 13,
      fontFamily: 'ui-monospace, "SF Mono", "Cascadia Code", Menlo, monospace',
      lineHeight: 1.3,
      theme: {
        background: '#080916',
        foreground: '#c8cad8',
        cursor: '#7c8aff',
        selectionBackground: '#7c8aff40',
        black: '#1a1c2e',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#fbbf24',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#e2e4f0',
        brightBlack: '#4a4e6a',
        brightRed: '#fca5a5',
        brightGreen: '#86efac',
        brightYellow: '#fcd34d',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#f8fafc',
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitRef.current = fitAddon;

    // Connect WebSocket
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/terminal-ws?id=${sessionId}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      // Send initial size
      const dims = fitAddon.proposeDimensions();
      if (dims) {
        ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'output') {
          term.write(msg.data);
        } else if (msg.type === 'exit') {
          term.write(`\r\n\x1b[2m[Process exited with code ${msg.code}]\x1b[0m\r\n`);
        }
      } catch {
        // If not JSON, treat as raw output
        term.write(event.data);
      }
    };

    ws.onclose = () => {
      term.write('\r\n\x1b[2m[Connection closed]\x1b[0m\r\n');
    };

    // Forward keyboard input to backend
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      if (!isVisible) return;
      try {
        fitAddon.fit();
        const dims = fitAddon.proposeDimensions();
        if (dims && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
        }
      } catch { /* ignore resize errors during mount/unmount */ }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      ws.close();
      term.dispose();
      mountedRef.current = false;
    };
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refit when visibility changes
  useEffect(() => {
    if (isVisible && fitRef.current) {
      // Small delay to let the DOM layout settle
      const t = setTimeout(() => {
        try {
          fitRef.current?.fit();
        } catch { /* */ }
      }, 50);
      return () => clearTimeout(t);
    }
  }, [isVisible]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ padding: '4px 8px' }}
    />
  );
}
