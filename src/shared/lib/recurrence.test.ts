/**
 * The maths of a recurring playbook (Phase 32 C4.1): which period a moment
 * is in, when its run is due, in the rule's own time zone, and the words.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  currentPeriod, dueAt, isoWeek, momentWords, nextPeriod, periodId, periodLabel, periodOf, previousPeriod,
  scheduleWords, seriesWords, sinceWords, zonedMoment,
} from './recurrence';

const weekly = { every: 'week' as const, on: 1, at: '09:00', timeZone: 'Europe/London' };

test('ISO weeks across a year end, and a year with week 53', () => {
  assert.deepEqual(isoWeek({ y: 2026, m: 10, d: 1 }), { year: 2026, week: 40 });
  // 1 Jan 2027 is a Friday: still week 53 of 2026.
  assert.deepEqual(isoWeek({ y: 2027, m: 1, d: 1 }), { year: 2026, week: 53 });
  assert.deepEqual(isoWeek({ y: 2027, m: 1, d: 4 }), { year: 2027, week: 1 });
  // 29 Dec 2025 is a Monday in week 1 of 2026.
  assert.deepEqual(isoWeek({ y: 2025, m: 12, d: 29 }), { year: 2026, week: 1 });
  const w53 = periodOf('week', { y: 2027, m: 1, d: 1 });
  assert.equal(periodId(w53), '2026-W53');
  assert.equal(periodId(nextPeriod(w53)), '2027-W01');
  assert.equal(periodId(previousPeriod(nextPeriod(w53))), '2026-W53');
});

test('periods by day and month, with their ids and labels', () => {
  const d = periodOf('day', { y: 2026, m: 12, d: 31 });
  assert.equal(periodId(d), '2026-12-31');
  assert.equal(periodId(nextPeriod(d)), '2027-01-01');
  assert.equal(periodLabel(d), '31 Dec');
  const m = periodOf('month', { y: 2026, m: 12, d: 17 });
  assert.equal(periodId(m), '2026-12');
  assert.equal(periodId(nextPeriod(m)), '2027-01');
  assert.equal(periodId(previousPeriod({ every: 'month', anchor: { y: 2027, m: 1, d: 1 } })), '2026-12');
  assert.equal(periodLabel(m), 'Dec 2026');
  assert.equal(periodLabel(periodOf('week', { y: 2026, m: 10, d: 1 })), 'W40');
});

test('a run is due at the rule\'s time in the rule\'s zone, summer time or not', () => {
  // W40 of 2026: Monday 28 Sep, 09:00 in London is 08:00 UTC (BST).
  const w40 = periodOf('week', { y: 2026, m: 10, d: 1 });
  assert.equal(new Date(dueAt(weekly, w40)).toISOString(), '2026-09-28T08:00:00.000Z');
  // W45: Monday 2 Nov, after the clocks went back, 09:00 is 09:00 UTC.
  const w45 = periodOf('week', { y: 2026, m: 11, d: 4 });
  assert.equal(new Date(dueAt(weekly, w45)).toISOString(), '2026-11-02T09:00:00.000Z');
  // The same rule in New York.
  assert.equal(new Date(dueAt({ ...weekly, timeZone: 'America/New_York' }, w40)).toISOString(), '2026-09-28T13:00:00.000Z');
  // A monthly rule on the 15th.
  const oct = periodOf('month', { y: 2026, m: 10, d: 1 });
  assert.equal(new Date(dueAt({ every: 'month', on: 15, at: '17:30', timeZone: 'UTC' }, oct)).toISOString(), '2026-10-15T17:30:00.000Z');
  assert.equal(zonedMoment('Asia/Kolkata', { y: 2026, m: 1, d: 1 }, 0, 0), Date.parse('2025-12-31T18:30:00Z'));
});

test('the current period runs from its due moment to the next one\'s', () => {
  // Thursday 1 Oct: W40's run (due Mon 28 Sep 09:00) is the current one.
  assert.equal(periodId(currentPeriod(weekly, Date.parse('2026-10-01T12:00:00Z'))), '2026-W40');
  // Monday 5 Oct 07:59 UTC is 08:59 in London: still W40.
  assert.equal(periodId(currentPeriod(weekly, Date.parse('2026-10-05T07:59:00Z'))), '2026-W40');
  // At 09:00 London, W41 becomes due.
  assert.equal(periodId(currentPeriod(weekly, Date.parse('2026-10-05T08:00:00Z'))), '2026-W41');
  // A daily rule before its time is yesterday's.
  assert.equal(periodId(currentPeriod({ every: 'day', on: 1, at: '18:00', timeZone: 'UTC' }, Date.parse('2026-10-01T10:00:00Z'))), '2026-09-30');
});

test('the words', () => {
  assert.equal(scheduleWords(weekly), 'every Mon 09:00');
  assert.equal(scheduleWords({ every: 'day', on: 1, at: '07:30' }), 'every day 07:30');
  assert.equal(scheduleWords({ every: 'month', on: 1, at: '09:00' }), 'every month on the 1st, 09:00');
  assert.equal(scheduleWords({ every: 'month', on: 22, at: '09:00' }), 'every month on the 22nd, 09:00');
  assert.equal(scheduleWords({ every: 'month', on: 11, at: '09:00' }), 'every month on the 11th, 09:00');
  assert.equal(seriesWords({ ...weekly, skills: [{ name: 'security-review', source: 'skill', required: false }] }), 'every Mon 09:00 · skill: security-review');
  assert.equal(seriesWords({ ...weekly, skills: [] }), 'every Mon 09:00');
  assert.equal(sinceWords(weekly, Date.parse('2026-09-28T08:00:00Z')), 'since Monday 09:00');
  assert.equal(sinceWords({ every: 'month', timeZone: 'UTC' }, Date.parse('2026-10-01T09:00:00Z')), 'since 1 Oct 09:00');
  assert.equal(momentWords('Europe/London', Date.parse('2026-10-05T08:00:00Z')), 'Mon 5 Oct 09:00');
});
