import type { SelectedNodeKind, SelectedNodeMeta } from '../stores/ui-store';

/**
 * What file, if any, a graph selection refers to.
 *
 * **A node id is not a path.** `selectedNodeId` carries whatever was
 * selected: a file path, but also `/abs/path/file.ts::function:foo` for a
 * symbol, and a directory path from the sidebar. The code surface read all
 * three as paths — so a symbol was fetched as a file that cannot exist and
 * came back 404 "File not found" over an empty pane, and a directory came
 * back 400 "Path is a directory". Both rendered as errors, blaming the
 * filesystem for the user's click.
 *
 * This lives in its own module, and is a function rather than an inline
 * ternary, because it is a ROUTING RULE with four cases and two of them
 * were wrong. The inspector has had the same rule since it was written;
 * having it in one named, tested place is how the two stop drifting.
 */
export interface SelectionTarget {
  /** The file to read, or null when the selection is not a file. */
  filePath: string | null;
  /**
   * What to tell the user instead of an error, when there is no file.
   * Null when a file was resolved, or when nothing is selected at all —
   * the empty state covers that and says something more useful.
   */
  explanation: string | null;
}

export function resolveSelectedFile(
  id: string | null,
  kind: SelectedNodeKind,
  meta: SelectedNodeMeta,
): SelectionTarget {
  if (!id) return { filePath: null, explanation: null };

  // A symbol belongs to a file, and that file is what the user meant by
  // clicking it. The id is not usable as a path; `parentFilePath` is.
  if (kind === 'symbol') {
    const parent = meta.parentFilePath ?? null;
    return parent
      ? { filePath: parent, explanation: null }
      // A symbol whose parent was not recorded. Refusing to guess by
      // splitting the id here: the id format is the graph's business, and
      // a wrong guess is another "File not found".
      : { filePath: null, explanation: 'That symbol is not linked to a file we can open.' };
  }

  if (kind === 'directory') {
    return { filePath: null, explanation: 'That is a directory. Pick a file inside it to read it.' };
  }

  if (kind === 'cluster') {
    return {
      filePath: null,
      explanation: 'That selection groups several files. Pick one of them to read it.',
    };
  }

  // 'file', 'ghost', or an untagged selection: the id IS the path.
  return { filePath: id, explanation: null };
}
