// Demo 01 · The plan, where agents can read it (~30 s). Part 1: plan.
// One epic, three stories; a short spec; a task with what done means; the
// same plan as files in the repository. No agent is working yet. Ends on the
// plan with every story in view.
//
// Footage points are in the app's 1440x810 layout. Offsets were cut against
// the capture media.json names; after a re-recording, `npm run review
// demo-01-plan` shows every beat's moment to check.
const talk = (scene, at) => ({ src: 'talk.mp4', scene, at });

export default {
  id: 'demo-01-plan',
  num: '01',
  title: 'The plan, where agents can read it',
  beats: [
    { dur: 5, clip: talk(1, 0.8), shots: [{}, { at: 1.6, fx: 520, fy: 250, z: 1.3, d: 1.6 }],
      caption: 'The plan: <b>one epic, three stories</b>.' },
    { dur: 5.5, clip: talk(2, 1), shots: [{ fx: 640, fy: 290, z: 1.3 }],
      caption: 'A short spec, <b>and the rule it must keep</b>.' },
    { dur: 7, clip: talk(3, 4.4), shots: [{ fx: 820, fy: 230, z: 1.2 }, { at: 2.2, fx: 1060, fy: 240, z: 1.7, d: 1.4 }],
      caption: 'Each task says <b>what done means</b>.' },
    { dur: 5, clip: talk(4, 1.6), shots: [{ fx: 640, fy: 250, z: 1.5 }],
      caption: 'The same plan, as <b>files in the repository</b>.' },
    { dur: 6.5, clip: talk(5, 2.6), shots: [{ fx: 450, fy: 270, z: 1.3 }],
      caption: 'Where agents can read it. <b>Nobody has started.</b>' },
  ],
};
