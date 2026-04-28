/**
 * Scripted agent for the harness — wraps an MCP client with
 * plan-walking helpers so loop tests can express scenarios like
 * "agent claims task, agent reports done, assert verification panel
 * sees it" without re-deriving the MCP plumbing each time.
 *
 * Why scripted, not real-LLM:
 *   - Determinism — same script, same outcome, every run.
 *   - Speed — no model latency.
 *   - No API keys in CI — fully offline.
 *
 * Trade-off: doesn't test the LLM's *reasoning*. Tests the
 * *plumbing* between agent and CodeTrellis. That's the bug surface
 * that has actually been regressing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createMcpClient, ScriptedMcp, McpClientOptions, McpToolResult } from './mcp-client';

export interface ScriptedAgentOptions extends McpClientOptions {
  /** The agent's identity reported via `register_session`. */
  agentType?: string;
  /** Optional model name (e.g. `claude-opus-4`, `harness/1.0`). */
  model?: string;
  /** Project root the agent's `writeFile()` helpers are relative to. */
  projectPath?: string;
}

export interface ScriptedAgent {
  readonly mcp: ScriptedMcp;
  readonly agentType: string;
  readonly model: string | undefined;

  /** Connect + register_session in one call. */
  connect(): Promise<void>;

  /** Disconnect + best-effort cleanup. */
  disconnect(): Promise<void>;

  /** Pass-through to MCP `callTool`. */
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;

  /** Convenience: claim a specific task. */
  claimTask(planUid: string, taskUid: string): Promise<McpToolResult>;

  /** Convenience: update a task status. */
  updateTaskStatus(
    planUid: string,
    taskUid: string,
    status: 'pending' | 'assigned' | 'in_progress' | 'done' | 'blocked' | 'skipped',
  ): Promise<McpToolResult>;

  /** Convenience: ask MCP for the next available task on a plan. */
  getNextTask(planUid: string, phaseUid?: string): Promise<McpToolResult>;

  /**
   * Write content to a file relative to the project path. If the
   * agent was constructed with no `projectPath`, this throws — pass
   * an absolute path or set it via the constructor.
   */
  writeFile(relativePath: string, content: string): Promise<void>;
}

export function createScriptedAgent(opts: ScriptedAgentOptions): ScriptedAgent {
  const agentType = opts.agentType ?? 'harness-agent';
  const model = opts.model ?? 'harness/1.0';
  const mcp = createMcpClient(opts);

  const writeFile = async (relativePath: string, content: string): Promise<void> => {
    if (!opts.projectPath) {
      throw new Error('writeFile() requires the agent to be created with a projectPath');
    }
    const abs = path.isAbsolute(relativePath)
      ? relativePath
      : path.join(opts.projectPath, relativePath);
    await fs.promises.writeFile(abs, content, 'utf-8');
  };

  return {
    mcp,
    agentType,
    model,

    async connect() {
      await mcp.connect();
      // Upgrade the auto-registered session so the agent shows up
      // with a real type/model in the Connected Agents widget +
      // every broadcast tool call carries the right attribution.
      await mcp.callTool('register_session', {
        agent_type: agentType,
        model,
      });
    },

    async disconnect() {
      await mcp.disconnect();
    },

    async callTool(name, args) {
      return mcp.callTool(name, args);
    },

    async claimTask(planUid, taskUid) {
      return mcp.callTool('claim_task', {
        plan_uid: planUid,
        task_uid: taskUid,
        agent_type: agentType,
        model,
      });
    },

    async updateTaskStatus(planUid, taskUid, status) {
      return mcp.callTool('update_task', {
        plan_uid: planUid,
        task_uid: taskUid,
        status,
      });
    },

    async getNextTask(planUid, phaseUid) {
      const args: Record<string, unknown> = { plan_uid: planUid };
      if (phaseUid !== undefined) args.phase_uid = phaseUid;
      return mcp.callTool('get_next_task', args);
    },

    writeFile,
  };
}
