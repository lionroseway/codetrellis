// Demo 04 · Completion needs evidence (20–30 s). Part 1: review.
// The review compares the working tree with the last commit, for the plan:
// each task landed, partly landed or untouched, the file no task claimed, and
// the drafted pull request description. Nothing is pushed. Ends on the review
// summary. (In the app the unclaimed files are listed under the tasks.)
const talk = (scene, at) => ({ src: 'talk.mp4', scene, at });
const SUMMARY = { fx: 730, fy: 370, z: 1.6 };

export default {
  id: 'demo-04-review',
  num: '04',
  title: 'Completion needs evidence',
  beats: [
    { dur: 9, clip: talk(18, 6.4), shots: [SUMMARY],
      caption: 'Against the plan: <b>landed, partly landed, untouched</b>.' },
    { dur: 8, clip: talk(19, 3), shots: [{ fx: 730, fy: 620, z: 1.45 }],
      caption: 'The pull request description, <b>drafted from the evidence</b>.' },
    { dur: 6.5, clip: talk(20, 1.6), shots: [SUMMARY],
      caption: 'What landed, what did not, and <b>what nobody planned</b>.' },
  ],
};
