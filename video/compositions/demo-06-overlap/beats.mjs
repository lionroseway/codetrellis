// Demo 06 · Agents that talk to each other (~35 s). Part 2: coordinate.
// Two sessions edit savePreferences; the overlap is flagged high with both
// lines of work named; a person messages the agents and one answers that it
// will adjust. Flagging tells people and agents: it does not stop every
// conflict by itself. Ends on the overlap card, with the message and the
// agent's answer on it.
const team = (scene, at) => ({ src: 'talk.mp4', scene, at });
const CARD = { fx: 790, fy: 500, z: 1.55 };

export default {
  id: 'demo-06-overlap',
  num: '06',
  title: 'Agents that talk to each other',
  beats: [
    { dur: 10, clip: team(5, 2.4), shots: [{ fx: 790, fy: 430, z: 1.15 }, { at: 4.2, ...CARD, d: 1.4 }],
      caption: 'Two sessions change <code>savePreferences</code>. Flagged <b>high</b>, both named.' },
    { dur: 8, clip: team(6, 0.1), shots: [{ fx: 790, fy: 540, z: 1.7 }],
      caption: 'A person decides: <b>message the agents</b>.' },
    { dur: 5, clip: team(6, 8.1), trimmed: false, shots: [{ fx: 790, fy: 540, z: 1.7 }],
      caption: 'Each agent reads it <b>on its next step</b>.' },
    { dur: 7.6, clip: team(6, 13.1), trimmed: false, shots: [CARD],
      caption: 'One answers: <b>it will put the function back</b>.' },
  ],
};
