// Demo 02 · One agent, one task (~40 s). Part 1: build.
// One session claims the task in its own worktree and builds it while the
// Timeline keeps up; line history says which agent wrote a line and the
// commit it landed in; a person approves the acceptance criteria. The agent
// here is scripted, so no model's thinking is cut: the "time trimmed" tag
// marks the cuts between moments. Ends on the task done, with its criteria.
const talk = (scene, at) => ({ src: 'talk.mp4', scene, at });
const TIMELINE = { fx: 900, fy: 450, z: 1.4 };
const CRITERIA = { fx: 1080, fy: 240, z: 1.65 };

export default {
  id: 'demo-02-build',
  num: '02',
  title: 'One agent, one task',
  beats: [
    { dur: 7.8, clip: talk(6, 4.4), shots: [{ fx: 1240, fy: 50, z: 1.9 }, { at: 3.2, ...TIMELINE, d: 1.3 }],
      caption: 'One Claude Code session <b>claims the task</b>, in its own worktree.' },
    { dur: 9, clip: talk(7, 0.4), shots: [TIMELINE],
      caption: 'It builds. <b>The timeline keeps up.</b>' },
    { dur: 7.5, clip: talk(8, 3.2), shots: [{ fx: 780, fy: 250, z: 1.4 }],
      caption: 'Every line: <b>which agent, which commit</b>.' },
    { dur: 10.5, clip: talk(9, 3.6), shots: [CRITERIA],
      caption: 'The agent offers what shows it. <b>A person approves.</b>' },
    { dur: 8, clip: talk(9, 14.1), trimmed: false, shots: [CRITERIA, { at: 2, fx: 760, fy: 230, z: 1.15, d: 1.6 }],
      caption: 'Done, <b>on its acceptance criteria</b>.' },
  ],
};
