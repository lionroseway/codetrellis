/**
 * Backend entry point for standalone web mode.
 * Starts the Express + WebSocket server.
 */
import { startServer } from './server';

const PORT = parseInt(process.env.PORT || '3001', 10);

startServer(PORT).catch((err) => {
  console.error('[Backend] Failed to start:', err);
  process.exit(1);
});
