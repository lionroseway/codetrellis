import { PLAN_STATUS, TASK, TONES, type StateVisual } from '../../lib/visual-language';

/**
 * Plan and task statuses in the visual vocabulary (Phase 33 G1): review is
 * planned's violet (it was amber, which means "needs you"), approved and
 * assigned are a brighter grey (they were a second blue beside in progress).
 */
const style = (s: StateVisual) => `${TONES[s.tone].text} ${TONES[s.tone].bg} ${TONES[s.tone].border}`;
const STATUS_STYLES: Record<string, string> = {
  ...Object.fromEntries(Object.entries(PLAN_STATUS).map(([k, s]) => [k, style(s)])),
  ...Object.fromEntries(Object.entries(TASK).map(([k, s]) => [k, style(s)])),
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.draft;
  return (
    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${style}`}>
      {status.replace('_', ' ')}
    </span>
  );
}
