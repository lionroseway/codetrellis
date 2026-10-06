import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksSecret } from './secret-paths';

test('names that hold secrets are withheld; their templates and ordinary code are not', () => {
  for (const p of ['.env', '.env.local', 'config/.env.production', '.npmrc', 'deploy/id_ed25519', 'certs/server.key', 'tls.pem', 'credentials.json', 'infra/prod.tfvars', 'secrets.yaml'])
    assert.equal(looksSecret(p), true, p);
  for (const p of ['id_ed25519.pub', '.env.example', '.env.sample', 'src/env.ts', 'src/keys.ts', 'docs/secrets.md', 'packages/web/src/api.ts'])
    assert.equal(looksSecret(p), false, p);
});
