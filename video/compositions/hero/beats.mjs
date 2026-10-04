// The hero video, beat by beat (docs/website/hero-video.md). build.mjs turns
// this into index.html: one window that glides between layouts, the footage
// dissolving inside it, the text moving around it.
//
// A beat: { layout, dur, media, shots, …text }.
//   layout  bleed (full screen, under a dark veil) · title · split (text on
//           `text: 'left' | 'right'`, the window on the other side) · full · end
//   media   { src, scene, at }: an asset, and where in it the beat opens
//           (`at` seconds into demo scene `scene`; see clip() below)
//   shots   camera keyframes inside the window: { at, fx, fy, z, d } is
//           footage point (fx, fy) centred, z times past "the whole window
//           fits", reached `at` seconds into the beat over `d` seconds. The
//           first has no `at`; with only one, the camera pushes in slowly.
//
// The app sits still between navigations, so each beat opens just before
// something happens on screen (node bin/motion.mjs captures/<name> shows
// where). Offsets were cut against the captures media.json names. After a
// re-recording, `npm run review hero` shows every beat's moment to check.
//
// Footage points (fx, fy) are in the app's 1600x900 layout.

// A clip opens `at` seconds into scene `scene` of its capture (the scene the
// demo printed as "N. Title"; 0 is the start of the recording). Scenes, not
// raw seconds, so a re-recording on another machine, faster or slower, keeps
// each beat on its moment: build.mjs reads each capture's scenes.json.
const clip = (src) => (scene, at) => ({ src, scene, at });
const hero = clip('hero.mp4');
const main = clip('main.mp4');
const history = clip('code-history.mp4');
const scale = clip('scale.mp4');
const parallel = clip('parallel.mp4');
const observe = clip('observe.mp4');
const teams = clip('teams.mp4');
const record = clip('record.mp4');

export const ACTS = [
  {
    id: 'act-0',
    title: 'The pain',
    beats: [
      // The map lighting up under three agents, behind the line.
      { layout: 'bleed', dur: 5, media: hero(2, 4.8),
        lines: ['Your agents write code', 'faster than you can <b>read</b> it.'] },
    ],
  },
  {
    id: 'act-1',
    title: 'The promise',
    beats: [
      { layout: 'title', dur: 6.5, media: hero(1, 4),
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
      { layout: 'split', text: 'left', dur: 5.5, media: hero(0, 4.4),
        shots: [{}, { at: 2.4, fx: 1090, fy: 60, z: 1.55, d: 1.2 }],
        title: 'Connect <b>any</b> agent.',
        body: 'Claude Code, Codex, Cursor: anything that speaks MCP shows up with the work it is doing.' },
      // A plan a payments team would run: phases, every service, tickets, a budget.
      { layout: 'split', text: 'right', dur: 6, media: scale(1, 0.5),
        shots: [{}, { at: 3.4, fx: 520, fy: 330, z: 1.2, d: 1.8 }],
        title: 'Turn a ticket into a plan <b>the whole team runs</b>.',
        body: 'Phases, tasks across every service, tickets, criteria and a budget, each task pointing at the files it will change. You approve it, not the agent.' },
      // CodeTrellis mapping itself: 1,506 files, and the imports between them.
      { layout: 'full', dur: 6, media: scale(4, 15.7),
        shots: [{}, { at: 2.4, fx: 760, fy: 300, z: 1.3, d: 2.8 }],
        caption: 'However <b>large</b> the codebase.' },
      // Three agents claim tasks and report progress: the task turns Assigned
      // with a bar, the tree fills in percentages, Activity takes each status.
      { layout: 'full', dur: 7.5, media: scale(2, 4.5),
        shots: [{ fx: 470, fy: 330, z: 1.55 }],
        caption: 'See <b>every change</b> as it happens.' },
      // The reader opens on a line no plan item asked for.
      { layout: 'split', text: 'left', dur: 5.5, media: main(7, 1.9),
        shots: [{}, { at: 1.4, fx: 600, fy: 230, z: 1.55, d: 1.3 }],
        title: 'Check it did <b>what you asked</b>.',
        body: 'Every changed line against the plan: green where they agree, pink where something changed that no item asked for.' },
      // Line history comes on: the agent beside each line, and how CodeTrellis knows.
      { layout: 'split', text: 'right', dur: 4.5, media: history(1, 8.2),
        shots: [{}, { at: 1.6, fx: 560, fy: 270, z: 1.45, d: 1.2 }],
        title: 'See which agent wrote <b>every line</b>.',
        body: 'From the commit message, or "probably", from when its session was open in that checkout. CodeTrellis says which.' },
    ],
  },
  {
    id: 'act-3',
    title: 'Correct',
    beats: [
      // A HIGH overlap; Claude Code's claim waits in Needs you, with why.
      // The signature change lands at ~39 s, the held claim at ~40.5 s; the
      // freeze takes the window at 42 s, so the beat ends there.
      { layout: 'split', text: 'left', dur: 5, media: hero(5, 0.6),
        shots: [{}, { at: 0.9, fx: 640, fy: 765, z: 2.1, d: 1.2 }],
        title: 'Serious overlaps <b>wait for you</b>.',
        body: 'When two lines of work change the same function, the next step waits in Needs you, with why. Nothing is claimed until you answer.' },
      // A breakpoint on shared code: held at ~33.8 s, Continue at ~35.7 s.
      { layout: 'split', text: 'right', dur: 4.8, media: parallel(6, 0.1),
        shots: [{}, { at: 0.7, fx: 630, fy: 775, z: 2.1, d: 1.1 }],
        title: 'Ask me <b>before this changes</b>.',
        body: 'Put a breakpoint on code that matters. The edit is held, not made, until you continue, steer or stop it.' },
    ],
  },
  {
    id: 'act-4',
    title: 'Together',
    beats: [
      // Two worktrees edit isValidEmail; Awareness names it, the chips go red.
      { layout: 'full', dur: 6, media: parallel(2, 0.4),
        shots: [{ z: 1.04 }, { at: 1.6, fx: 620, fy: 740, z: 1.45, d: 1.6 }],
        caption: 'Several agents on one task, <b>told before they collide</b>.' },
      // Dana's own branch, beside the agents': the same function, flagged.
      { layout: 'split', text: 'left', dur: 6, media: hero(4, 3.5),
        shots: [{}, { at: 1.3, fx: 640, fy: 765, z: 2.1, d: 1.3 }],
        title: 'Your teammates, <b>beside the agents</b>.',
        body: 'A developer\'s branch is a line of work like any agent\'s. When it touches the same function, both sides see it.' },
      { layout: 'mosaic', dur: 7,
        media: observe(3, 1.9),
        shots: [{ fx: 640, fy: 760, z: 1.5 }],
        tiles: [
          { x: 96, y: 470, w: 960, h: 540, label: 'Plans that will meet, settled first' },
          { x: 1104, y: 130, w: 720, h: 405, ...teams(1, 10.5), region: { fx: 200, fy: 380, fw: 900 }, label: 'Weekly playbooks' },
          { x: 1104, y: 581, w: 720, h: 405, ...scale(2, 9.9), region: { fx: 0, fy: 110, fw: 880 }, label: 'Every agent\'s progress, live' },
        ],
        textBox: { x: 96, y: 130, w: 900 },
        title: 'A whole team, <b>in one view</b>.',
        body: 'Who is on what, where plans meet, and what is due, for agents and people alike.' },
    ],
  },
  {
    id: 'act-5',
    title: 'Hold the line',
    beats: [
      // The team's rule, with its reason, in Settings.
      { layout: 'split', text: 'left', dur: 6, media: teams(1, 1.3),
        shots: [{}, { at: 1.2, fx: 880, fy: 310, z: 1.5, d: 1.3 }],
        title: 'Write your architecture down <b>once</b>.',
        body: '“Routes may not import config: routes read settings through the app.” Every agent and the pipeline check the same rule.' },
      { layout: 'mosaic', dur: 7,
        media: teams(4, 1.4),
        shots: [{ fx: 1450, fy: 260, z: 1.6 }],
        tiles: [
          { x: 96, y: 470, w: 960, h: 540, label: '“Done” on stale tests, refused' },
          { x: 1104, y: 130, w: 720, h: 405, ...hero(6, 0.7), region: { fx: 0, fy: 0, fw: 900 }, label: 'Release week: frozen' },
          { x: 1104, y: 581, w: 720, h: 405, ...observe(4, 2.7), region: { fx: 600, fy: 420, fw: 900 }, label: 'Vague plans flagged first' },
        ],
        textBox: { x: 96, y: 130, w: 900 },
        title: 'Guardrails agents <b>check themselves</b>.',
        body: '“Done” means tested on the code as it is. Release week means frozen. A vague plan is flagged before anyone starts.' },
      // A real `codetrellis check`: exit 3 on the breach, 0 after the fix.
      { layout: 'terminal', dur: 9, bar: 'exports-v2 · ci',
        box: { x: 96, y: 120, w: 1040 },
        recipe: { x: 96, y: 700, w: 1040, name: '.github/workflows/conformity.yml', at: 3.4, lines: [
          '- name: Start CodeTrellis',
          '  run: codetrellis start --quiet',
          '- name: Conformity',
          '  run: codetrellis check   # exit 3 when it does not conform',
        ] },
        holdFail: 2.8,
        textBox: { x: 1220, w: 600 },
        title: 'CI fails when work <b>drifts</b>.',
        body: 'The same rules, headless in the pipeline, and in cloud sessions through a SessionStart hook.' },
    ],
  },
  {
    id: 'act-6',
    title: 'Anywhere',
    beats: [
      // The digest: who overlaps, whether they were told, what you are asked.
      { layout: 'split', text: 'left', dur: 6, media: hero(7, 0.9),
        shots: [{}, { at: 1.3, fx: 640, fy: 770, z: 2.1, d: 1.3 }],
        title: 'Catch up in <b>under a minute</b>.',
        body: 'Who overlaps, what changed, whether the agents were told, and what you are asked.' },
      // The agent drives the window: the overlap on the graph, then the lines.
      { layout: 'full', dur: 7.5, media: hero(7, 6.1),
        shots: [{ z: 1.04 }],
        caption: 'Ask your agent to <b>show you</b>.' },
      // The breakpoint answered from the phone. The desktop footage is lined
      // up so its card clears (~35.7 s) as the phone's tap lands, which is
      // what an answer from the phone does.
      { layout: 'phone', dur: 6.5, media: parallel(6, 0.9),
        shots: [{ fx: 630, fy: 775, z: 1.9 }],
        phone: { src: 'phone-breakpoint.mp4', done: 'phone-breakpoint-done.png', start: 0, delay: 0.9, tap: { x: 68, y: 215, at: 1.58 } },
        caption: 'Take it with you: <b>answer from your phone</b>.' },
    ],
  },
  {
    id: 'act-7',
    title: 'Proof and trust',
    beats: [
      // The stack as it was at 10:45, scrubbed back.
      { layout: 'split', text: 'right', dur: 5.5, media: observe(2, 0.2),
        shots: [{}, { at: 1.0, fx: 700, fy: 720, z: 1.75, d: 1.3 }],
        title: 'Replay <b>exactly</b> what happened.',
        body: 'Scrub back to any moment: the stack, the overlaps and who was told, as they were then.' },
      // A person approves; the record checks its chain.
      // Approved at ~13.5 s; Settings → Data checks the chain at ~18.5 s.
      { layout: 'split', text: 'left', dur: 7.8, media: record(1, 6.3),
        shots: [{ fx: 1450, fy: 200, z: 1.7 }, { at: 5.8, fx: 1100, fy: 620, z: 1.25, d: 1.1 }],
        title: 'Prove it <b>later</b>.',
        body: 'An agent cannot approve its own work. The record keeps who decided, in a chain anyone can check months on.' },
      { layout: 'strip', dur: 4.5,
        lines: ['On your machine. No telemetry.', 'Free and <b>open source</b>.'],
        groups: [['13 languages + SQL', 'Any MCP agent', '212 tools', 'Desktop, iOS, Android']] },
    ],
  },
  {
    id: 'close',
    title: 'Close',
    beats: [
      { layout: 'rotate', dur: 17, media: scale(4, 15.7), shots: [{ z: 1.1 }],
        lead: 'Use CodeTrellis to…',
        lines: [
          'keep agents to the work you agreed',
          'see every change as it happens',
          'catch two agents on the same code',
          'work beside your teammates and their agents',
          'enforce your architecture, in CI too',
          'review agent work against the plan',
          'let your agent walk you through it',
          'answer your agents from your phone',
          'replay exactly what happened',
        ],
        more: 'And many more features and use cases.' },
      { layout: 'end', dur: 5,
        headline: 'Keep up with your agents.',
        pills: ['Free and open source', 'Apache 2.0'],
        url: 'codetrellis.dev' },
    ],
  },
];
