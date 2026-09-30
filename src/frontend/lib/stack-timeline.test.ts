/**
 * Phase 32 B6.4b — which turns are a plan's work.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentTurn } from '../../shared/lib/agent-turns';
import type { AgentEvent } from '../../shared/types';
import { turnInPlan, type PlanScope } from './stack-timeline';

const call = (args: Record<string, unknown>) => ({ id: 'e', timestamp: 0, source: 'mcp', type: 'tool_call', payload: { tool: 't', args } }) as unknown as AgentEvent;
const turn = (sessionId: string | null, events: AgentEvent[]) => ({ id: 't', sessionId, events }) as unknown as AgentTurn;
const scope: PlanScope = { planUid: 'plan-b', taskUids: new Set(['task-1']), sessions: new Set(['s-billing']) };

test('the session on one of its tasks makes a turn the plan\'s work', () => {
  assert.equal(turnInPlan(turn('s-billing', []), scope), true);
  assert.equal(turnInPlan(turn('s-other', []), scope), false);
});

test('a call that names the plan or one of its tasks makes a turn the plan\'s work', () => {
  assert.equal(turnInPlan(turn('s-other', [call({ plan_uid: 'plan-b' })]), scope), true);
  assert.equal(turnInPlan(turn('s-other', [call({ uid: 'task-1', status: 'done' })]), scope), true);
  assert.equal(turnInPlan(turn(null, [call({ items: [{ uid: 'task-1' }] })]), scope), true, 'a bulk call, one level down');
  assert.equal(turnInPlan(turn('s-other', [call({ plan_uid: 'plan-x' }), call({ query: 'task' })]), scope), false);
});

test('arguments stored as a JSON string, even one cut short, still say which plan', () => {
  const stored = (args: string) => ({ id: 'e', timestamp: 0, source: 'mcp', type: 'tool_call', payload: { tool: 't', args } }) as unknown as AgentEvent;
  assert.equal(turnInPlan(turn(null, [stored('{"uid":"task-1","status":"in_p')]), scope), true);
  assert.equal(turnInPlan(turn(null, [stored('{"plan_uid":"plan-x"}')]), scope), false);
});
