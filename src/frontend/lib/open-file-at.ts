/**
 * Open a file in the code reader, at a line, from anywhere.
 *
 * ## Why this exists
 *
 * Three surfaces name a file and none of them could show it. The plan
 * diff listed `services/shared-go/money/money.go` as plain text. The
 * review panel reported an item as landed and gave no way to look at
 * what landed. The code reader itself could send you to a plan item and
 * had no way back.
 *
 * So the trace ran one way and stopped: code → item, and then nothing.
 * The only route back was the top bar's Code button, which is a mode
 * toggle — it does not know which file you were reading or which line you
 * were on, so "back" meant finding the file again by hand.
 *
 * ## Why it is one module rather than three call sites
 *
 * The sequence is small but not obvious: a node id is not a path (see
 * `selected-file`), selecting must happen before the mode switch or the
 * workspace mounts against a stale selection, and the return journey has
 * to be recorded before you leave or there is nothing to return to.
 * `open-plan-item` exists for exactly this reason on the other side of
 * the same door, and its docstring records what happened when the
 * sequence was written twice.
 */

/**
 * Where the reader was, so it can be put back.
 *
 * Deliberately a single slot rather than a stack. The journey this
 * serves is one hop deep — read code, look at the item that wants it,
 * come back — and a stack would invite a history UI nobody asked for
 * and a set of edge cases (what happens when you arrive from the graph?)
 * that a single slot simply does not have.
 */
export interface CodeReturn {
  filePath: string;
  line: number | null;
  /** Shown on the control, so the way back names where it goes. */
  label: string;
}

let pendingReturn: CodeReturn | null = null;

/** Remember where we are, before going somewhere else. */
export function rememberCodePosition(position: CodeReturn | null): void {
  pendingReturn = position;
}

/** Where we would go back to, or null if there is nowhere. */
export function peekCodeReturn(): CodeReturn | null {
  return pendingReturn;
}

/** Take the return journey and consume it. */
export function takeCodeReturn(): CodeReturn | null {
  const next = pendingReturn;
  pendingReturn = null;
  return next;
}

/**
 * Show this file, in code view, scrolled to this line.
 *
 * `line` is optional: the plan diff knows a file but not a line, while a
 * review row and the overlay both know both. Passing null is honest
 * about that rather than guessing line 1, which would scroll the reader
 * somewhere the caller never meant.
 */
export async function openFileAt(filePath: string, line?: number | null): Promise<void> {
  const { useUiStore } = await import('../stores/ui-store');
  const ui = useUiStore.getState();

  // Select before switching. `CodeWorkspace` resolves its file from the
  // selection on mount, so a mode switch that lands first renders the
  // previous file for a frame and fetches twice.
  ui.setSelectedNode(filePath, 'file', line != null ? { line } : {});
  ui.setWorkspaceMode('code');
}

/**
 * Go to the plan item that wants this file, and leave a way back.
 *
 * The plain `revealPlanItem` is still the right call from anywhere that
 * is not the code reader — the graph, a channel event, an MCP broadcast.
 * This is the variant for a reader who expects to return to their place.
 */
export async function openItemFromCode(
  planUid: string,
  itemUid: string,
  from: CodeReturn,
): Promise<void> {
  const { revealPlanItem } = await import('./open-plan-item');
  rememberCodePosition(from);
  await revealPlanItem(planUid, itemUid);
}

/**
 * Absolute path for a target a panel holds relative.
 *
 * Plans store project-relative paths on purpose — an absolute one never
 * matches a review, which is the bug `plan-by-hand.spec` guards. The
 * reader needs the absolute form, so the conversion happens here rather
 * than in each caller, where one of them would get the separator or the
 * double-slash wrong.
 */
export function absoluteFilePath(root: string | null, target: string): string {
  if (!root) return target;
  if (target.startsWith('/') || /^[A-Za-z]:[\\/]/.test(target)) return target;
  return `${root.replace(/[\\/]+$/, '')}/${target.replace(/^[\\/]+/, '')}`;
}

/** Return to the file and line recorded on the way out. */
export async function returnToCode(): Promise<boolean> {
  const back = takeCodeReturn();
  if (!back) return false;
  await openFileAt(back.filePath, back.line);
  return true;
}
