/**
 * Open a plan and show it (Phase 33 G6). The owner's report: opening a plan
 * that was minimised to its chip left it minimised, because the workspace
 * flips to the plan only when the active plan CHANGES (App.tsx), so opening
 * the plan already active did nothing visible from eight places. Every
 * person's "open this plan" goes through here: it sets the plan, then brings
 * the plan workspace to the front, from a chip too. The Brief is the one
 * exception, as in App.tsx: there, opening a plan is part of reading it.
 */
export async function showPlan(planUid: string, opts: { item?: string } = {}): Promise<void> {
  const { usePlanStore } = await import('../stores/plan-store');
  const { useUiStore } = await import('../stores/ui-store');
  // With an item, the plan is opened and the item selected in the order F9 fixed.
  if (opts.item) await openPlanItem(planUid, opts.item);
  else if (usePlanStore.getState().activePlanUid !== planUid) await usePlanStore.getState().setActivePlan(planUid);
  if (useUiStore.getState().workspaceMode !== 'brief') useUiStore.getState().setWorkspaceMode('plan');
}

/**
 * Open a plan item — activate its plan, hydrate the tree, select it.
 *
 * Extracted rather than copied. This sequence is load-bearing and subtle:
 * F9 found that a naive `setActivePlan` + `selectItem` lands one item
 * behind, because the workspace shell runs `resetForPlan()` /
 * `hydratePlan()` on first seeing a new plan and that effect can fire
 * AFTER the selection, wiping it. The await-then-next-frame order below is
 * the fix, and a second copy of this logic would not have it.
 *
 * It had exactly one caller — the `ui-select-item` broadcast from the MCP
 * `select_item` tool. The plan-overlay banner in the code reader has a
 * button wired to an `onOpenItem` prop that NO caller ever supplied, so it
 * rendered with hover feedback and did nothing. Same door, two ways in;
 * now one implementation behind both.
 */
export async function openPlanItem(planUid: string, itemUid: string): Promise<void> {
  const { usePlanStore } = await import('../stores/plan-store');
  const { usePlanItemsStore } = await import('../stores/plan-items-store');

  await usePlanStore.getState().setActivePlan(planUid);

  const items = usePlanItemsStore.getState();
  if (items.activePlanUid !== planUid || Object.keys(items.itemsByUid).length === 0) {
    items.resetForPlan(planUid);
    await items.hydratePlan(planUid);
  }

  // Next frame, so the shell's mount effect has already run and will not
  // clear what we just set.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  usePlanItemsStore.getState().selectItem(itemUid);
}

/**
 * Open a plan item AND bring the plan workspace to the front.
 *
 * What a person means when they click "this item wants this file" while
 * reading code: show me the item. Selecting it behind the code surface
 * would be a no-op as far as they can see.
 */
export async function revealPlanItem(planUid: string, itemUid: string): Promise<void> {
  const { useUiStore } = await import('../stores/ui-store');
  await openPlanItem(planUid, itemUid);
  useUiStore.getState().setWorkspaceMode('plan');
}
