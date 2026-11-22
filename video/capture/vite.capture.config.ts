// The web build a capture records: vite.web.config.ts, with its port and the
// backend it proxies to taken from the environment (capture/demo.sh), so a
// capture can run beside a CodeTrellis that already holds :3001 and :5173.
import { mergeConfig } from 'vite';
import base from '../../vite.web.config';

const api = process.env.CAPTURE_API_PORT ?? '3001';
const web = Number(process.env.CAPTURE_WEB_PORT ?? 5173);

export default mergeConfig(base, {
  server: {
    port: web,
    strictPort: true,
    cors: { origin: [new RegExp(`^http://localhost:${web}$`), new RegExp(`^http://127\\.0\\.0\\.1:${web}$`)] },
    proxy: {
      '/api': { target: `http://localhost:${api}` },
      '/terminal-ws': { target: `ws://localhost:${api}` },
      '/ws': { target: `ws://localhost:${api}` },
    },
  },
});
