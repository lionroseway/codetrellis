/**
 * A branch name suggested for a section of a plan (Phase 32 C5.2):
 * "Checkout v2" / "Billing" → `checkout-v2-billing`. Shared by the window,
 * which shows it to be edited, and the backend, which uses it when none is
 * given, so the two never disagree.
 */
export function slugPart(text: string, max = 40): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

export function suggestSectionBranch(planTitle: string, sectionTitle: string): string {
  const parts = [slugPart(planTitle, 30), slugPart(sectionTitle, 40)].filter(Boolean);
  return parts.join('-') || 'section';
}

/**
 * Where a section's new worktree goes (Phase 32 C5.2): beside the project,
 * named after it and the branch, `/work/acme` + `checkout-v2-billing` →
 * `/work/acme-checkout-v2-billing`. Never a folder from a request.
 */
export function worktreeDirFor(projectRoot: string, branch: string): string {
  const root = projectRoot.replace(/[\\/]+$/, '');
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  const i = Math.max(root.lastIndexOf('/'), root.lastIndexOf('\\'));
  const parent = i > 0 ? root.slice(0, i) : root;
  const name = i >= 0 ? root.slice(i + 1) : root;
  return `${parent}${sep}${name}-${branch.replace(/[/\\]+/g, '-')}`;
}

