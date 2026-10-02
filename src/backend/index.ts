/**
 * Backend entry point for standalone web mode.
 * Starts the Express + WebSocket server.
 */
import { startServer } from './server';
import { installProcessHandlers } from './lifecycle';

const PORT = parseInt(process.env.PORT || '3001', 10);

/* The safety net and graceful shutdown live in `lifecycle.ts`, shared with
 * the headless CLI. */
installProcessHandlers();

startServer(PORT).catch((err) => {
  console.error('[Backend] Failed to start:', err);
  process.exit(1);
});
