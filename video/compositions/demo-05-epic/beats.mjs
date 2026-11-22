// Demo 05 · One epic, three agents, at once (~35 s). Part 2: scale.
// Three sessions, each in its own worktree, claim the save, read and audit
// stories from the plan: they do not divide the work themselves. Ends on The
// Stack with all three stories claimed.
//
// Footage points are in the app's 1440x810 layout; scenes are the talk-team
// group's (scripts/demo/groups/talk.ts).
const team = (scene, at) => ({ src: 'talk.mp4', scene, at });
const STACK = { fx: 640, fy: 440, z: 1.7 };
const LINES = { fx: 1240, fy: 50, z: 1.9 };

export default {
  id: 'demo-05-epic',
  num: '05',
  title: 'One epic, three agents, at once',
  beats: [
    { dur: 5.5, clip: team(1, 1.6), shots: [{}, { at: 1.2, ...STACK, d: 1.4 }],
      caption: 'One epic, three stories. <b>Nobody on them yet.</b>' },
    { dur: 3.6, clip: team(2, 0.1), shots: [LINES],
      caption: 'Three Claude Code sessions, <b>each in its own worktree</b>.' },
    { dur: 7.5, clip: team(2, 3.7), trimmed: false, shots: [STACK],
      caption: 'Each <b>claims its story</b> from the plan.' },
    { dur: 5.5, clip: team(3, 1.4), shots: [LINES],
      caption: 'Each agent in <b>its own line of work</b>.' },
    { dur: 7.5, clip: team(4, 1.6), shots: [STACK],
      caption: 'The Stack: <b>who holds which story</b>.' },
  ],
};
