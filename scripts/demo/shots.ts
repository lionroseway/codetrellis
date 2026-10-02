/**
 * Checking a shot: what `ui_ready` says is on screen, against what the shot
 * claims to show.
 */
import type { ShotExpect } from './types';

export const collapse = (text: string, n = 220) => text.replace(/\s+/g, ' ').trim().slice(0, n);

/** What `ui_ready` says is on screen, in the terms a shot can ask for. */
export interface Seen {
  openFile: string | null;
  marks: Record<string, number>;
  criteria: Array<{ text: string; state: string }>;
  artefact: string | null;
  replay: { active: boolean; index: number; frames: number } | null;
  playForward: boolean;
  settings: string | null;
  sidebar: string | null;
  highlighted: string | null;
}

const NOTHING: Seen = { openFile: null, marks: {}, criteria: [], artefact: null, replay: null, playForward: false, settings: null, sidebar: null, highlighted: null };

export function seenFrom(text: string): Seen {
  try {
    const parsed = JSON.parse(text);
    return {
      openFile: parsed.openFile ?? null,
      // Visible marks only. Counting what is merely in the DOM let a shot
      // pass whose aligned lines were under the terminal drawer.
      marks: parsed.visibleVerdicts ?? {},
      criteria: Array.isArray(parsed.criteria) ? parsed.criteria : [],
      artefact: parsed.openArtefact?.name ?? null,
      replay: parsed.replay ?? null,
      playForward: parsed.playForward === true,
      settings: parsed.settingsSection ?? null,
      sidebar: parsed.sidebarView ?? null,
      highlighted: parsed.highlighted?.id ?? null,
    };
  } catch {
    return NOTHING;
  }
}

export function meets(want: ShotExpect, seen: Seen): boolean {
  if (want.file && !(seen.openFile?.endsWith(want.file) ?? false)) return false;
  if (want.verdict && !((seen.marks[want.verdict] ?? 0) > 0)) return false;
  if (want.criterion && !seen.criteria.some((c) => c.text.includes(want.criterion!.text) && c.state === want.criterion!.state)) return false;
  if (want.artefact && !(seen.artefact?.endsWith(want.artefact) ?? false)) return false;
  if (want.view === 'replay' && !seen.replay?.active) return false;
  if (want.view === 'play-forward' && !seen.playForward) return false;
  if (want.settings && seen.settings !== want.settings) return false;
  if (want.sidebar && seen.sidebar !== want.sidebar) return false;
  if (want.highlighted && seen.highlighted !== want.highlighted) return false;
  return true;
}

export function describeWant(want: ShotExpect): string {
  const parts: string[] = [];
  if (want.file || want.verdict) parts.push(`${want.file ?? 'any file'}${want.verdict ? ` with ${want.verdict} lines` : ''}`);
  if (want.criterion) parts.push(`the criterion "${want.criterion.text}" ${want.criterion.state}`);
  if (want.artefact) parts.push(`${want.artefact} in the viewer`);
  if (want.view) parts.push(want.view === 'replay' ? 'replay on' : 'play-forward on');
  if (want.settings) parts.push(`Settings at ${want.settings}`);
  if (want.sidebar) parts.push(`the sidebar's ${want.sidebar}`);
  if (want.highlighted) parts.push(`${want.highlighted} marked`);
  return parts.join(' and ');
}

export function describeSeen(want: ShotExpect, seen: Seen): string {
  const parts: string[] = [];
  if (want.file || want.verdict) {
    const marks = Object.entries(seen.marks).map(([k, n]) => `${n} ${k}`).join(', ') || 'no VISIBLE marked lines';
    parts.push(`${seen.openFile ?? 'no file'} with ${marks}`);
  }
  if (want.criterion) {
    parts.push(seen.criteria.length
      ? `criteria ${seen.criteria.map((c) => `"${collapse(c.text, 40)}" ${c.state}`).join(', ')}`
      : 'no criteria visible');
  }
  if (want.artefact) parts.push(seen.artefact ? `${seen.artefact} in the viewer` : 'no file in the viewer');
  if (want.view === 'replay') parts.push(seen.replay?.active ? `replay at frame ${seen.replay.index + 1} of ${seen.replay.frames}` : 'replay off');
  if (want.view === 'play-forward') parts.push(seen.playForward ? 'play-forward on' : 'play-forward off');
  if (want.settings) parts.push(seen.settings ? `Settings at ${seen.settings}` : 'Settings closed');
  if (want.sidebar) parts.push(seen.sidebar ? `the sidebar's ${seen.sidebar}` : 'the sidebar hidden');
  if (want.highlighted) parts.push(seen.highlighted ? `${seen.highlighted} marked` : 'nothing marked');
  return parts.join('; ');
}
