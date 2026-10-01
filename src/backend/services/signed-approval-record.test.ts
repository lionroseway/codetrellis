import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalStatement, parseRecord, recordYaml, sha256, type ApprovalStatement } from './signed-approval-record';

const SIG = '-----BEGIN SSH SIGNATURE-----\nU1NIU0lHAAAAAQ==\n-----END SSH SIGNATURE-----\n';
const statement: ApprovalStatement = {
  uid: '7f3c2a10-1111-2222-3333-444455556666',
  planUid: 'a1b2c3d4-1111-2222-3333-444455556666',
  itemUid: 'b1b2c3d4-1111-2222-3333-444455556666',
  criterionUid: 'c1b2c3d4-1111-2222-3333-444455556666',
  criterionSha256: sha256('Figures reconcile to the ledger'),
  decision: 'approved',
  evidence: { 'd1b2c3d4-1111-2222-3333-444455556666': sha256('sales') },
  signer: 'dana@acme.test',
  at: '2026-09-26T14:02:00.000Z',
};

test('the signed bytes are canonical: keys sorted, so any machine rebuilds the same text', () => {
  const shuffled = Object.fromEntries(Object.entries(statement).reverse()) as unknown as ApprovalStatement;
  assert.equal(canonicalStatement(shuffled), canonicalStatement(statement));
  assert.ok(canonicalStatement(statement).startsWith('{"at":'));
});

test('a record round-trips: the statement exactly as signed, and the signature', () => {
  const parsed = parseRecord(recordYaml(statement, SIG));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.statement, statement);
  assert.equal(parsed.text, canonicalStatement(statement));
  assert.equal(parsed.signature, SIG);
});

test('a record is anyone\'s text: each wrong shape is refused, with why', () => {
  const doc = (over: Record<string, unknown>) => recordYaml({ ...statement, ...over } as ApprovalStatement, SIG);
  const reason = (content: string) => { const p = parseRecord(content); return p.ok ? 'ok' : p.reason; };
  assert.equal(reason(doc({ decision: 'sent_back' })), 'the statement is missing a field or has one it should not');
  assert.equal(reason(doc({ signer: 'not an email' })), 'the statement is missing a field or has one it should not');
  assert.equal(reason(doc({ evidence: { '../../etc': 'x' } })), 'the statement is missing a field or has one it should not');
  assert.equal(reason(doc({ criterionSha256: 'abc' })), 'the statement is missing a field or has one it should not');
  assert.equal(reason(recordYaml(statement, 'not a signature')), 'the signature is not an SSH signature');
  assert.equal(reason('kind: something-else\nversion: 1\n'), 'not an approval record this version reads');
  assert.equal(reason(': : :'), 'the record is not readable YAML');
  assert.equal(reason('x'.repeat(20_000)), 'the record is too large');
  // The same claim spelled differently is not the text that was signed.
  const spaced = `kind: codetrellis-approval\nversion: 1\nstatement: '${JSON.stringify(statement, null, 1).replace(/\n/g, ' ')}'\nsignature: |\n  ${SIG.trim().split('\n').join('\n  ')}\n`;
  assert.equal(reason(spaced), 'the statement is not in its signed form');
});
