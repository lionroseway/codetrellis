/**
 * Backend entry point for standalone web mode.
 * Starts the Express + WebSocket server.
 */
import { startServer, server as httpServer } from './server';
import { stopWatching } from './services/file-watcher';
import { stopMcpServer } from './mcp/server';
import { killAllTerminals } from './services/terminal-service';
import { saveNow } from './services/persistence';
import { exportDatabase } from './services/database';
import { stopAutoSave } from './services/persistence';
import { stopClaudeCodeWatcher } from './agent/claude-code-watcher';
import { stopPeerManager } from './services/peer-connection-service';

const PORT = parseInt(process.env.PORT || '3001', 10);

/* ── Process-level safety net ────────────────────────────────────
 * Keep the server alive through stray rejections and uncaught throws
 * that slip past route-level try/catch.  Desktop-app uptime matters
 * more than crash-and-restart purity — log loudly, stay running.
 */
process.on('uncaughtException', (err) => {
  console.error('[Backend] Uncaught exception (kept alive):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Backend] Unhandled rejection (kept alive):', reason);
});

/* ── Graceful shutdown ───────────────────────────────────────────
 * `tsx watch` sends SIGTERM when restarting on file changes;
 * `concurrently -k` sends SIGTERM when either process dies;
 * Ctrl-C sends SIGINT. In all cases we must:
 *   1. Flush the sql.js database to disk (unsaved plan mutations)
 *   2. Kill PTY terminal sessions (orphaned shells leak PIDs)
 *   3. Close file watchers (chokidar holds open inotify/FSEvents)
 *   4. Stop the MCP SSE server (agents get clean disconnect)
 *   5. Close the HTTP server (release the port for restart)
 *
 * A 4s budget keeps us inside `tsx watch`'s default SIGTERM window.
 * If anything hangs we force-exit so the port is freed.
 */
let shuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return; // idempotent — SIGTERM + SIGINT can fire together
  shuttingDown = true;
  console.log(`[Backend] ${signal} received — shutting down gracefully…`);

  const deadline = setTimeout(() => {
    console.error('[Backend] Shutdown deadline exceeded — forcing exit');
    process.exit(1);
  }, 4000);
  // Don't let the timer itself keep the process alive
  deadline.unref();

  try {
    // 1. Persist database before anything else
    try {
      stopAutoSave();
      saveNow(() => exportDatabase());
      console.log('[Backend] Database flushed');
    } catch (err) {
      console.error('[Backend] Database flush failed:', err);
    }

    // 2. Kill terminal PTY sessions
    try {
      killAllTerminals();
      console.log('[Backend] Terminals killed');
    } catch (err) {
      console.error('[Backend] Terminal cleanup failed:', err);
    }

    // 3. Stop file watchers
    try {
      stopClaudeCodeWatcher();
      await stopWatching();
      console.log('[Backend] File watchers stopped');
    } catch (err) {
      console.error('[Backend] File watcher cleanup failed:', err);
    }

    // 4. Stop peer connections and mDNS
    try {
      await stopPeerManager();
      console.log('[Backend] Peer manager stopped');
    } catch (err) {
      console.error('[Backend] Peer manager cleanup failed:', err);
    }

    // 5. Stop MCP server
    try {
      await stopMcpServer();
      console.log('[Backend] MCP server stopped');
    } catch (err) {
      console.error('[Backend] MCP cleanup failed:', err);
    }

    // 6. Close HTTP server
    httpServer.close();
    console.log('[Backend] HTTP server closed');
  } catch (err) {
    console.error('[Backend] Shutdown error:', err);
  }

  clearTimeout(deadline);
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer(PORT).catch((err) => {
  console.error('[Backend] Failed to start:', err);
  process.exit(1);
});
