/**
 * A recurrence rule as the committed config gives it (Phase 32 C4.1): the
 * file is anyone's text, so a rule that does not read as one is refused
 * with why, and never guessed at.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRecurrenceRule } from './recurrence-rule';

const good = {
  id: 'weekly-security-review', playbook: 'security-review', title: 'Weekly security review',
  every: 'week', on: 1, at: '09:00', timeZone: 'Europe/London', carryOver: true,
  skills: [{ name: 'security-review', source: 'skill', required: false }],
  since: '2026-09-01T00:00:00Z', by: 'Sam Lee',
};

test('a good rule reads as itself', () => {
  const { rule, problems } = parseRecurrenceRule(good);
  assert.deepEqual(problems, []);
  assert.equal(rule!.id, 'weekly-security-review');
  assert.equal(rule!.carryOver, true);
  assert.equal(rule!.skills[0].name, 'security-review');
  assert.equal(rule!.since, '2026-09-01T00:00:00.000Z');
});

test('a daily rule needs no day; carry over is off unless said', () => {
  const { rule } = parseRecurrenceRule({ ...good, every: 'day', on: undefined, carryOver: 'yes' });
  assert.equal(rule!.on, 1);
  assert.equal(rule!.carryOver, false);
});

test('each bad field is named', () => {
  const { rule, problems } = parseRecurrenceRule({
    ...good, id: 'Weekly Review', playbook: '../etc', title: '', every: 'fortnight', at: '9am', timeZone: 'Mars/Olympus', since: 'soon',
  });
  assert.equal(rule, null);
  assert.deepEqual(problems, [
    'id must be lower-case letters, digits and dashes, at most 63',
    'playbook must name a playbook (a plan template id)',
    'title must be 1 to 120 characters',
    'every must be day, week or month',
    'at must be a time, HH:MM',
    'timeZone must be an IANA time zone, e.g. Europe/London',
    'since must be an ISO date',
  ]);
  assert.match(parseRecurrenceRule({ ...good, on: 8 }).problems[0], /weekday, 1 \(Monday\) to 7/);
  assert.match(parseRecurrenceRule({ ...good, every: 'month', on: 31 }).problems[0], /1 to 28/);
  assert.deepEqual(parseRecurrenceRule('weekly').problems, ['a rule must be an object']);
});
