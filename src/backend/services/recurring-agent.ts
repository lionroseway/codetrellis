/**
 * Phase 32 C4.3b — start an agent on each run (shared-work doc C-4).
 *
 * Per rule and per device, and off by default: the person turns it on in
 * Settings → Recurring playbooks on this computer, and it is kept here, never
 * in the committed config, because it starts a process on this machine. When
 * a run is made here with it on, a terminal opens in the project with the
 * chosen agent on the run's prompt. A run found (started earlier, or arrived
 * from a teammate) starts nothing: its agent is whoever started it.
 *
 * It needs `terminal`. A run started by the person in the app window or by
 * the schedule may start one; from a phone, only one the person granted
 * `terminal`; from plain HTTP, never (loopback is not a person). Otherwise
 * the run is made and says why no agent was started.
 */
import type { Plan } from '../../shared/types';
import { getDb } from './database';
import { markDirty } from './persistence';
import { createTerminal, writeTerminal, type TerminalSessionInfo } from './terminal-service';

export type RunAgent = 'claude' | 'codex';
export const RUN_AGENTS: Record<RunAgent, string> = { claude: 'Claude Code', codex: 'Codex' };

export interface RunAgentSetting { agent: RunAgent; by: string; at: number }

/** What starting a run did about its agent, when the rule has one on this device. */
export interface RunAgentOutcome {
  agent: RunAgent;
  /** The terminal it runs in, or null when it was not started. */
  terminalId: string | null;
  /** "Claude Code started in a terminal on the computer", or why not. */
  words: string;
}

export function isRunAgent(v: unknown): v is RunAgent {
  return v === 'claude' || v === 'codex';
}

export function runAgentsFor(projectRoot: string): Record<string, RunAgentSetting> {
  const out: Record<string, RunAgentSetting> = {};
  const res = getDb().exec('SELECT rule_id, agent, by_name, at FROM recurring_agents WHERE project_root = ?', [projectRoot]);
  for (const row of res[0]?.values ?? []) {
    const [ruleId, agent, by, at] = row as [string, string, string, number];
    if (isRunAgent(agent)) out[ruleId] = { agent, by, at };
  }
  return out;
}

/** Turn it on (an agent) or off (null), on this device. */
export function setRunAgent(projectRoot: string, ruleId: string, agent: RunAgent | null, by: string, now = Date.now()): RunAgentSetting | null {
  if (agent === null) {
    getDb().run('DELETE FROM recurring_agents WHERE project_root = ? AND rule_id = ?', [projectRoot, ruleId]);
  } else {
    getDb().run('INSERT OR REPLACE INTO recurring_agents (project_root, rule_id, agent, by_name, at) VALUES (?, ?, ?, ?, ?)', [projectRoot, ruleId, agent, by, now]);
  }
  markDirty();
  return agent === null ? null : { agent, by, at: now };
}

/**
 * What the agent is asked. One line, so it is one shell argument; the plan's
 * own tasks, criteria and skills reach the agent through the MCP tools.
 */
export function runPrompt(plan: Plan): string {
  const title = plan.title.replace(/['"`$\\\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
  return `Work the CodeTrellis plan "${title}" (plan_uid ${plan.uid}): call get_next_item with that plan_uid, claim the task, read its brief with get_brief, do it, and repeat until no task is left.`;
}

/**
 * The command line typed into the terminal's shell. The program is the
 * agent's own CLI; `CODETRELLIS_RUN_AGENT_COMMAND` replaces it for the test
 * harness, which must never start a real agent.
 */
export function runCommand(agent: RunAgent, plan: Plan, program = process.env.CODETRELLIS_RUN_AGENT_COMMAND || agent): string {
  return `${program} '${runPrompt(plan)}'\n`;
}

/** Wait this long for the shell to start before typing (as agent presets do). */
const SHELL_SETTLE_MS = 500;

/**
 * After a run was made here: start its agent when the rule has one on this
 * device. `may` is true, or why this start may not open a terminal.
 */
export function startRunAgent(
  projectRoot: string,
  ruleId: string,
  plan: Plan,
  may: true | string,
  onCreated?: (session: TerminalSessionInfo) => void,
): RunAgentOutcome | null {
  const setting = runAgentsFor(projectRoot)[ruleId];
  if (!setting) return null;
  const name = RUN_AGENTS[setting.agent];
  if (may !== true) return { agent: setting.agent, terminalId: null, words: `${name} was not started: ${may}` };
  try {
    const session = createTerminal({ preset: 'shell', cwd: projectRoot, title: `${plan.title} · ${name}` });
    setTimeout(() => { writeTerminal(session.id, runCommand(setting.agent, plan)); }, SHELL_SETTLE_MS);
    onCreated?.(session);
    return { agent: setting.agent, terminalId: session.id, words: `${name} started in a terminal on the computer` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { agent: setting.agent, terminalId: null, words: `${name} was not started: ${message}` };
  }
}
