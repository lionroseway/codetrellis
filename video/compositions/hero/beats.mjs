// The hero video, beat by beat (docs/website/hero-video.md). build.mjs turns
// each act into acts/act-<n>.html; bin/render.sh hero renders and joins them.
//
// Media starts are seconds into the staged footage (media.json says which
// capture each asset is). They were cut against the captures as recorded on
// 2026-10-04: a new recording moves them, so read its scenes.json and shift.
//
// Footage points (fx, fy) are in the app's 1600x900 layout.

/** Seconds each beat overlaps the one before it. */
export const FADE = 0.5;

const hero = (start) => ({ src: 'hero.mp4', start });
const main = (start) => ({ src: 'main.mp4', start });
const history = (start) => ({ src: 'code-history.mp4', start });

export const ACTS = [
  {
    id: 'act-0',
    title: 'Hero, act 0: the pain',
    realTag: false,
    beats: [
      // Three agents editing at once, under the line.
      { kind: 'statement', dur: 5, dark: true, media: hero(38),
        lines: ['Your agents write code', 'faster than you can <b>read</b> it.'] },
    ],
  },
  {
    id: 'act-1',
    title: 'Hero, act 1: the promise',
    beats: [
      { kind: 'title', dur: 7, media: hero(9),
        eyebrow: 'Observability for AI coding agents',
        headline: ['Keep up with', 'your agents.'],
        tagline: 'Check, correct and steer AI agents at the speed they write code, however complex your workflow.',
        pills: ['Free and open source', 'Any MCP agent', 'Desktop + phone'] },
    ],
  },
  {
    id: 'act-2',
    title: 'Hero, act 2: one agent, kept on track',
    beats: [
      // The agents arrive one by one in the TopBar.
      { kind: 'split', side: 'right', dur: 6.5, media: hero(7.5),
        zoom: { fx: 1090, fy: 0, s: 1.5, at: 1.2 },
        title: 'Connect <b>any</b> agent.',
        body: 'Claude Code, Codex, Cursor: anything that speaks MCP shows up with the work it is doing.' },
      // The plan workspace, made from the ticket.
      { kind: 'split', side: 'left', dur: 6, media: main(33.8),
        title: 'Turn a ticket into a <b>plan</b>.',
        body: 'The epic and its children become a plan, each item pointing at the files it will change. You approve it, not the agent.' },
      // The map: clusters, then files, then one file and its links.
      { kind: 'full', dur: 7.5, media: hero(18.6),
        shots: [{ fx: 800, fy: 450, s: 1 }, { at: 4.2, fx: 700, fy: 360, s: 1.18, d: 2.4 }],
        caption: 'However <b>complex</b> the system.' },
      // Live: three agents' edits landing on the map.
      { kind: 'full', dur: 6.5, media: hero(38.5),
        shots: [{ fx: 800, fy: 420, s: 1 }, { at: 1.2, fx: 700, fy: 380, s: 1.3, d: 2.2 }],
        caption: 'See <b>every change</b> as it happens.' },
      // The verdict: a line no plan item asked for.
      { kind: 'split', side: 'right', dur: 7, media: main(87.6),
        zoom: { fx: 600, fy: 232, s: 1.55, at: 1.2 },
        title: 'Check it did <b>what you asked</b>.',
        body: 'Every changed line against the plan: green where they agree, pink where something changed that no item asked for.' },
      // Line history on: the agent beside each line, and how CodeTrellis knows.
      { kind: 'split', side: 'left', dur: 5.5, media: history(21.7),
        zoom: { fx: 560, fy: 270, s: 1.45, at: 0.9 },
        title: 'See which agent wrote <b>every line</b>.',
        body: 'From the commit message, or "probably", from when its session was open in that checkout. CodeTrellis says which.' },
    ],
  },
];
