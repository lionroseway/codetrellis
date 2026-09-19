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
