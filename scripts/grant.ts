/**
 * Grant MCP capabilities on a test backend (the harnesses, the video
 * captures), the way a person would in Settings → MCP Server:
 *
 *   npx tsx scripts/grant.ts terminal [capture …] [--data-dir=…] [--api-port=3001]
 *
 * A real install refuses it and says where to turn it on; see
 * scripts/demo/grant.ts for why that is the backend's call, not this script's.
 */
import { grantCli } from './demo/grant';

grantCli(process.argv.slice(2)).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
