import { useUiStore } from '../../stores/ui-store';

/**
 * Settings → Architecture rules, since Phase 33 G7: rules are made, read and
 * changed in the Rules view, a workspace of their own; Settings keeps only
 * switches (RULES-AND-CLARITY §5.6). Rules have none, so this says where
 * they went and opens it.
 */
export function ArchitectureRulesSection() {
  const setWorkspaceMode = useUiStore((s) => s.setWorkspaceMode);
  return (
    <div className="space-y-3 text-[12px]" data-testid="rules-settings">
      <p className="text-foreground leading-relaxed">
        Architecture rules have their own view now, beside the graph, plans, docs and code: the suites, whether each holds, what breaks
        them, what agents propose, and the history of changes. Rules are made and changed there.
      </p>
      <button
        type="button"
        onClick={() => { setWorkspaceMode('rules'); window.dispatchEvent(new CustomEvent('close-settings')); }}
        className="px-3 py-1 rounded text-[12px] bg-accent/20 text-foreground hover:bg-accent/30"
        data-testid="rules-open-view"
      >
        Open the Rules view
      </button>
    </div>
  );
}
