/**
 * Plan-to-prompt serialisation helpers.
 *
 * Mirrors the frontend HandoffButton logic so `copy_plan_as_prompt`
 * can produce the same markdown an agent sees when the user clicks
 * "Copy as prompt" in the UI.
 */

export function buildPlanPrompt(
  plan: { title: string; description?: string | null; baseRef?: string | null; targetBranch?: string | null; autoCreateBranch?: boolean },
  items: Array<{ uid: string; kind: string; title: string; body?: string | null; status?: string | null; sortOrder: number; scopePath?: string | null; fileSpecs?: any[]; symbolSpecs?: any[]; constraints?: any }>,
  refs?: Array<{ title: string; url: string; kind: string }>,
): string {
  const lines: string[] = [`# ${plan.title}`];
  if (plan.description) lines.push('', plan.description);
  lines.push('');

  if (plan.baseRef || plan.targetBranch) {
    lines.push('## Git Context');
    if (plan.baseRef) lines.push(`- Base: \`${plan.baseRef}\``);
    if (plan.targetBranch) lines.push(`- Target branch: \`${plan.targetBranch}\``);
    if (plan.autoCreateBranch) lines.push(`- Auto-create branch: yes`);
    lines.push('');
  }

  const actions = items
    .filter((i) => i.kind === 'action' && (i.status === 'pending' || i.status === 'assigned'))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  if (actions.length > 0) {
    lines.push('## Tasks', '');
    for (const action of actions) {
      lines.push(`### ${action.title}`);
      if (action.body) lines.push('', action.body);
      if (action.scopePath) lines.push('', `Scope: \`${action.scopePath}\``);
      appendFileSpecs(lines, action.fileSpecs);
      appendSymbolSpecs(lines, action.symbolSpecs);
      appendConstraints(lines, action.constraints);
      lines.push('');
    }
  }

  if (refs && refs.length > 0) {
    lines.push('## External References', '');
    for (const ref of refs) lines.push(`- [${ref.title}](${ref.url})${ref.kind !== 'url' ? ` (${ref.kind.replace(/_/g, ' ')})` : ''}`);
    lines.push('');
  }

  return lines.join('\n');
}

export function buildItemPrompt(
  item: { title: string; body?: string | null; scopePath?: string | null; fileSpecs?: any[]; symbolSpecs?: any[]; constraints?: any },
  plan: { title: string; baseRef?: string | null; targetBranch?: string | null },
): string {
  const lines: string[] = [`# Task: ${item.title}`];
  if (item.body) lines.push('', item.body);
  lines.push('');
  if (item.scopePath) lines.push(`**Scope:** \`${item.scopePath}\``);
  appendFileSpecs(lines, item.fileSpecs);
  appendSymbolSpecs(lines, item.symbolSpecs);
  appendConstraints(lines, item.constraints);
  if (plan.baseRef || plan.targetBranch) {
    lines.push('', '## Git Context');
    if (plan.baseRef) lines.push(`- Base: \`${plan.baseRef}\``);
    if (plan.targetBranch) lines.push(`- Branch: \`${plan.targetBranch}\``);
  }
  return lines.join('\n');
}

function appendFileSpecs(lines: string[], fileSpecs?: any[]): void {
  if (!fileSpecs?.length) return;
  lines.push('', '**Files:**');
  for (const fs of fileSpecs) {
    const editsStr = (fs.edits ?? [])
      .filter((e: any) => e.instruction)
      .map((e: any) => e.symbol ? `  - ${e.symbol}: ${e.instruction}` : `  - ${e.instruction}`)
      .join('\n');
    lines.push(`- \`${fs.path}\` (${fs.action})${fs.description ? ` — ${fs.description}` : ''}`);
    if (editsStr) lines.push(editsStr);
  }
}

function appendSymbolSpecs(lines: string[], symbolSpecs?: any[]): void {
  if (!symbolSpecs?.length) return;
  lines.push('', '**Symbols:**');
  for (const ss of symbolSpecs) {
    lines.push(`- ${ss.action} \`${ss.name}\`${ss.filePath ? ` in \`${ss.filePath}\`` : ''}${ss.description ? ` — ${ss.description}` : ''}`);
  }
}

function appendConstraints(lines: string[], constraints?: any): void {
  if (!constraints) return;
  const c = constraints;
  lines.push('', '**Guardrails:**');
  if (c.excludePaths?.length) lines.push(`- Do NOT modify: ${c.excludePaths.map((p: string) => `\`${p}\``).join(', ')}`);
  if (c.lockInterfaces) lines.push('- Do NOT change function/method signatures');
  if (c.requireTests) lines.push('- Must include tests for all changes');
  if (c.requireLint) lines.push('- Must pass lint/format before completing');
  if (c.maxFilesTouched) lines.push(`- Max ${c.maxFilesTouched} files may be touched`);
  if (c.maxLinesChanged) lines.push(`- Max ${c.maxLinesChanged} lines changed`);
  if (c.customRules?.length) {
    for (const rule of c.customRules) lines.push(`- ${rule}`);
  }
}
