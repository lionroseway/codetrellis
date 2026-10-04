// The hero video, beat by beat (docs/website/hero-video.md). build.mjs turns
// this into index.html: one window that glides between layouts, the footage
// dissolving inside it, the text moving around it.
//
// A beat: { layout, dur, media, shots, …text }.
//   layout  bleed (full screen, under a dark veil) · title · split (text on
//           `text: 'left' | 'right'`, the window on the other side) · full · end
//   media   { src, start }: an asset and the second of it the beat opens on
//   shots   camera keyframes inside the window: { at, fx, fy, z, d } is
//           footage point (fx, fy) centred, z times past "the whole window
//           fits", reached `at` seconds into the beat over `d` seconds. The
//           first has no `at`; with only one, the camera pushes in slowly.
//
// The app sits still between navigations, so each beat opens just before
// something happens on screen (node bin/motion.mjs captures/<name> shows
// where). Starts were cut against the captures recorded on 2026-10-04: a
// new recording moves them, so read its scenes.json and its motion.
//
// Footage points (fx, fy) are in the app's 1600x900 layout.

const hero = (start) => ({ src: 'hero.mp4', start });
const main = (start) => ({ src: 'main.mp4', start });
const history = (start) => ({ src: 'code-history.mp4', start });

export const ACTS = [
  {
    id: 'act-0',
    title: 'The pain',
    beats: [
      // The map lighting up under three agents, behind the line.
      { layout: 'bleed', dur: 5, media: hero(17.8),
        lines: ['Your agents write code', 'faster than you can <b>read</b> it.'] },
    ],
  },
  {
    id: 'act-1',
    title: 'The promise',
    beats: [
      { layout: 'title', dur: 6.5, media: hero(9.6),
        eyebrow: 'Observability for AI coding agents',
        headline: ['Keep up with', 'your agents.'],
        tagline: 'Check, correct and steer AI agents at the speed they write code, however complex your workflow.',
        pills: ['Free and open source', 'Any MCP agent', 'Desktop + phone'] },
    ],
  },
  {
    id: 'act-2',
    title: 'One agent, kept on track',
    beats: [
      // The project opens, then the agents arrive one by one in the top bar.
      { layout: 'split', text: 'left', dur: 5.5, media: hero(4.4),
        shots: [{}, { at: 2.4, fx: 1090, fy: 60, z: 1.55, d: 1.2 }],
        title: 'Connect <b>any</b> agent.',
        body: 'Claude Code, Codex, Cursor: anything that speaks MCP shows up with the work it is doing.' },
      // The plan builds from the ticket.
      { layout: 'split', text: 'right', dur: 5, media: main(18.2),
        shots: [{}, { at: 2.6, fx: 700, fy: 300, z: 1.25, d: 1.6 }],
        title: 'Turn a ticket into a <b>plan</b>.',
        body: 'The epic and its children become a plan, each item pointing at the files it will change. You approve it, not the agent.' },
      // The map opening from clusters into files.
      { layout: 'full', dur: 5.5, media: hero(12.6),
        shots: [{}, { at: 3.0, fx: 700, fy: 360, z: 1.2, d: 2.2 }],
        caption: 'However <b>complex</b> the system.' },
      // Three agents' edits landing live.
      { layout: 'full', dur: 6, media: hero(24.6),
        shots: [{ z: 1.04 }, { at: 1.5, fx: 760, fy: 400, z: 1.3, d: 3.5, ease: 'sine.inOut' }],
        caption: 'See <b>every change</b> as it happens.' },
      // The reader opens on a line no plan item asked for.
      { layout: 'split', text: 'left', dur: 5.5, media: main(65.4),
        shots: [{}, { at: 1.4, fx: 600, fy: 230, z: 1.55, d: 1.3 }],
        title: 'Check it did <b>what you asked</b>.',
        body: 'Every changed line against the plan: green where they agree, pink where something changed that no item asked for.' },
      // Line history comes on: the agent beside each line, and how CodeTrellis knows.
      { layout: 'split', text: 'right', dur: 4.5, media: history(14.6),
        shots: [{}, { at: 1.6, fx: 560, fy: 270, z: 1.45, d: 1.2 }],
        title: 'See which agent wrote <b>every line</b>.',
        body: 'From the commit message, or "probably", from when its session was open in that checkout. CodeTrellis says which.' },
    ],
  },
];
