/**
 * Backend entry point for standalone web mode.
 * Starts the Express + WebSocket server.
 */
import { startServer } from './server';

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

startServer(PORT).catch((err) => {
  console.error('[Backend] Failed to start:', err);
  process.exit(1);
});
