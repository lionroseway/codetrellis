/**
 * Phase 17.I — Plan Import from External Sources.
 *
 * Parses external content (GitHub issues, pasted text, git diffs,
 * Claude Code session JSONLs) into a structured plan shape that can
 * be passed to `planService.createPlan()` + `planItemService.createItem()`.
 *
 * Each importer returns a `PlanImportResult` — title, description, and
 * a list of items to create. The caller (API endpoint) does the actual
 * DB writes so this module stays pure/testable.
 */

import type { FileSpec, PlanItemKind } from '../../shared/types';

export interface ImportedItem {
  kind: PlanItemKind;
  title: string;
  body?: string;
  fileSpecs?: FileSpec[];
  scopePath?: string;
}

export interface PlanImportResult {
  title: string;
  description: string;
  items: ImportedItem[];
  source: string;
  metadata?: Record<string, unknown>;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GitHub Issue
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Parse a GitHub issue URL or raw markdown body into a plan.
 * If a URL is given, we extract repo/issue info from the path.
 * The body is treated as the plan description; checklists become actions.
 */
export function importFromGitHubIssue(input: {
  url?: string;
  title: string;
  body: string;
  labels?: string[];
}): PlanImportResult {
  const items: ImportedItem[] = [];

  // Extract checklist items as actions
  const checklistPattern = /^[-*]\s+\[[ x]\]\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = checklistPattern.exec(input.body)) !== null) {
    items.push({
      kind: 'action',
      title: match[1].trim(),
    });
  }

  // Extract code blocks as context objects
  const codeBlockPattern = /```(\w+)?\n([\s\S]*?)```/g;
  const codeBlocks: string[] = [];
  while ((match = codeBlockPattern.exec(input.body)) !== null) {
    codeBlocks.push(match[0]);
  }

  // If there are code blocks but no checklist items, create a single
  // investigation action
  if (items.length === 0 && codeBlocks.length > 0) {
    items.push({
      kind: 'action',
      title: 'Investigate and fix',
      body: 'Investigate the issue described above and implement a fix.',
    });
  }

  // If there are file paths mentioned (backtick-wrapped), extract as context
  const fileRefPattern = /`([a-zA-Z0-9_/.\\-]+\.[a-zA-Z]{1,10})`/g;
  const referencedFiles = new Set<string>();
  while ((match = fileRefPattern.exec(input.body)) !== null) {
    const f = match[1];
    // Skip things that look like commands or versions
    if (!f.includes(' ') && f.includes('/') && !f.startsWith('v')) {
      referencedFiles.add(f);
    }
  }

  // If we found referenced files, create an object with them listed
  if (referencedFiles.size > 0 && items.length > 0) {
    // Add file specs to the first action
    items[0].fileSpecs = Array.from(referencedFiles).slice(0, 20).map((path) => ({
      path,
      action: 'modify' as const,
    }));
  }

  // Strip checklist from the body for the description (leave prose)
  const description = input.body
    .replace(/^[-*]\s+\[[ x]\]\s+.+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    title: input.title,
    description: description || input.body,
    items,
    source: 'github_issue',
    metadata: {
      url: input.url,
      labels: input.labels,
    },
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Pasted Conversation / Transcript
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Parse a pasted conversation (any agent, raw markdown/text) into a plan.
 * Heuristics:
 *   - Lines starting with "##" or numbered lists → action titles
 *   - File paths mentioned → fileSpecs
 *   - The whole body becomes the plan description
 */
export function importFromConversation(input: {
  text: string;
  title?: string;
}): PlanImportResult {
  const lines = input.text.split('\n');
  const items: ImportedItem[] = [];
  const fileRefs = new Set<string>();

  // Extract action-like patterns
  for (const line of lines) {
    const trimmed = line.trim();

    // Numbered steps: "1. Do this", "2. Do that"
    const numbered = trimmed.match(/^\d+\.\s+(.+)/);
    if (numbered && numbered[1].length > 5 && numbered[1].length < 200) {
      items.push({ kind: 'action', title: numbered[1] });
      continue;
    }

    // Markdown H2/H3 headers that look like task names
    const header = trimmed.match(/^#{2,3}\s+(.+)/);
    if (header && header[1].length > 3 && header[1].length < 150) {
      // Skip headers that are too generic
      const generic = /^(context|background|summary|notes|references|links|introduction)/i;
      if (!generic.test(header[1])) {
        items.push({ kind: 'action', title: header[1] });
        continue;
      }
    }

    // Checklist items
    const checklist = trimmed.match(/^[-*]\s+\[[ x]\]\s+(.+)/);
    if (checklist) {
      items.push({ kind: 'action', title: checklist[1] });
      continue;
    }

    // File path detection
    const fileMatch = trimmed.match(/`([a-zA-Z0-9_/.\\-]+\.[a-zA-Z]{1,10})`/g);
    if (fileMatch) {
      for (const m of fileMatch) {
        const f = m.slice(1, -1);
        if (f.includes('/') && !f.startsWith('v') && !f.includes(' ')) {
          fileRefs.add(f);
        }
      }
    }
  }

  // If actions have file refs, attach to first action
  if (fileRefs.size > 0 && items.length > 0) {
    items[0].fileSpecs = Array.from(fileRefs).slice(0, 20).map((path) => ({
      path,
      action: 'modify' as const,
    }));
  }

  // Derive a title from the first H1 or first meaningful line
  let title = input.title ?? '';
  if (!title) {
    const h1 = lines.find((l) => l.startsWith('# '));
    if (h1) {
      title = h1.replace(/^#\s+/, '').trim();
    } else {
      const firstMeaningful = lines.find((l) => l.trim().length > 10);
      title = firstMeaningful?.trim().slice(0, 80) ?? 'Imported plan';
    }
  }

  return {
    title,
    description: input.text,
    items: items.slice(0, 50), // cap at 50 items
    source: 'conversation',
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Git Diff
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Parse a git diff (unified format) into a plan. Creates one action
 * per modified file, with fileSpecs indicating what changed.
 */
export function importFromGitDiff(input: {
  diff: string;
  title?: string;
  baseBranch?: string;
}): PlanImportResult {
  const items: ImportedItem[] = [];
  const diffFilePattern = /^diff --git a\/(.+?) b\/(.+?)$/gm;
  const files: Array<{ path: string; action: 'create' | 'modify' | 'delete' }> = [];

  let match: RegExpExecArray | null;
  while ((match = diffFilePattern.exec(input.diff)) !== null) {
    const filePath = match[2];
    // Determine if create/delete/modify
    const afterDiff = input.diff.slice(match.index, match.index + 500);
    const isNew = afterDiff.includes('new file mode');
    const isDeleted = afterDiff.includes('deleted file mode');
    files.push({
      path: filePath,
      action: isNew ? 'create' : isDeleted ? 'delete' : 'modify',
    });
  }

  // Group by directory for better task structure
  const dirGroups = new Map<string, typeof files>();
  for (const f of files) {
    const dir = f.path.includes('/') ? f.path.split('/').slice(0, -1).join('/') : '(root)';
    if (!dirGroups.has(dir)) dirGroups.set(dir, []);
    dirGroups.get(dir)!.push(f);
  }

  if (dirGroups.size <= 5) {
    // Few directories — one task per directory
    for (const [dir, dirFiles] of dirGroups) {
      const actionLabel = dirFiles.length === 1
        ? `${dirFiles[0].action} ${dirFiles[0].path.split('/').pop()}`
        : `Changes in ${dir}/ (${dirFiles.length} files)`;

      items.push({
        kind: 'action',
        title: actionLabel,
        scopePath: dir === '(root)' ? undefined : dir,
        fileSpecs: dirFiles.map((f) => ({
          path: f.path,
          action: f.action,
        })),
      });
    }
  } else {
    // Many directories — one task per file (capped)
    for (const f of files.slice(0, 30)) {
      items.push({
        kind: 'action',
        title: `${f.action} ${f.path}`,
        fileSpecs: [{ path: f.path, action: f.action }],
      });
    }
  }

  // Stats for description
  const created = files.filter((f) => f.action === 'create').length;
  const modified = files.filter((f) => f.action === 'modify').length;
  const deleted = files.filter((f) => f.action === 'delete').length;
  const stats = [
    created ? `${created} new` : '',
    modified ? `${modified} modified` : '',
    deleted ? `${deleted} deleted` : '',
  ].filter(Boolean).join(', ');

  return {
    title: input.title ?? `Changes from diff (${stats})`,
    description: `Imported from git diff: ${files.length} files (${stats}).${input.baseBranch ? `\n\nBase: \`${input.baseBranch}\`` : ''}`,
    items,
    source: 'git_diff',
    metadata: {
      fileCount: files.length,
      baseBranch: input.baseBranch,
    },
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Claude Code Session JSONL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Parse a Claude Code session JSONL file into a plan. Each tool_call
 * that modifies files becomes an action; the conversation summary
 * becomes the plan description.
 */
export function importFromClaudeSession(input: {
  jsonl: string;
  title?: string;
}): PlanImportResult {
  const lines = input.jsonl.split('\n').filter((l) => l.trim());
  const items: ImportedItem[] = [];
  const touchedFiles = new Set<string>();
  let firstMessage = '';
  let lastSummary = '';

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);

      // Extract the initial user message as context
      if (entry.type === 'human' && !firstMessage) {
        firstMessage = typeof entry.message === 'string'
          ? entry.message
          : entry.message?.content?.[0]?.text ?? '';
      }

      // Summary messages
      if (entry.type === 'summary' || entry.subtype === 'summary') {
        lastSummary = entry.summary ?? entry.message ?? '';
      }

      // Tool calls that modify files
      if (entry.type === 'tool_use' || entry.type === 'tool_call') {
        const tool = entry.name ?? entry.tool ?? '';
        const input_data = entry.input ?? entry.params ?? {};

        if (tool === 'Write' || tool === 'Edit') {
          const filePath = input_data.file_path ?? input_data.path ?? '';
          if (filePath && !touchedFiles.has(filePath)) {
            touchedFiles.add(filePath);
            items.push({
              kind: 'action',
              title: `${tool === 'Write' ? 'Create' : 'Modify'} ${filePath.split('/').pop()}`,
              fileSpecs: [{
                path: filePath,
                action: tool === 'Write' ? 'create' : 'modify',
              }],
            });
          }
        }

        if (tool === 'Bash' || tool === 'bash') {
          const cmd = input_data.command ?? '';
          // Look for file-creating commands
          const mkdirMatch = cmd.match(/mkdir\s+-?p?\s+(.+)/);
          if (mkdirMatch) {
            items.push({
              kind: 'action',
              title: `Create directory ${mkdirMatch[1].trim()}`,
            });
          }
        }
      }
    } catch {
      // Skip unparseable lines
    }
  }

  // Build title from first message or fallback
  const title = input.title
    ?? firstMessage.slice(0, 100).split('\n')[0]
    ?? 'Imported from Claude Code session';

  // Description from summary or first message
  const description = lastSummary || firstMessage || 'Imported from a Claude Code session.';

  return {
    title,
    description,
    items: items.slice(0, 50),
    source: 'claude_session',
    metadata: {
      totalLines: lines.length,
      filesModified: touchedFiles.size,
    },
  };
}
