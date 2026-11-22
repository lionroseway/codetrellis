// Demo 07 · "Ask me before you change that" (~35 s).
// A breakpoint on a sensitive file holds an agent's edit; the question reaches
// the phone; Continue with steer, typed there; the agent carries on. Desktop
// to the left, phone to the right.
// It ends on what the agent wrote: the new field, in the reader, attributed.
//
// The phone is its own recording (capture/phone/talk-steer.json): the real
// phone screens, shown the same held edit, not paired live to this desktop
// capture. Its Send lands as the desktop takes the answer (scene 10 opens).
// A breakpoint holds an edit that asks first; a write that gets past it is
// reported, not undone. The still (the held edit, three choices) is beat 2.
const team = (scene, at) => ({ src: 'talk.mp4', scene, at });
const CARD = { fx: 665, fy: 385, z: 2.3 };
// Seconds into the phone recording that Send is tapped (captures/phone-talk-steer/tap.json).
const SEND = 7.58;
// Seconds of the held card shown before the answer.
const HELD = 12.4;

export default {
  id: 'demo-07-breakpoint',
  num: '07',
  title: 'Ask me before you change that',
  still: 1,
  beats: [
    { dur: 4.5, clip: team(8, 0.3), shots: [{}, { at: 1, fx: 600, fy: 260, z: 1.5, d: 1.4 }],
      caption: 'A breakpoint on a file that matters: <b>ask me first</b>.' },
    { dur: 5.4, layout: 'phone', clip: team(10, -HELD), shots: [CARD],
      caption: 'An agent tries to edit it. <b>Held</b>: nothing is written.',
      phone: { src: 'phone.mp4', first: 'phone-first.png', end: 'phone-end.png', at: HELD - SEND, length: 11.2, for: 23.4,
        taps: [{ x: 203, y: 259, at: 3.08 }, { x: 143, y: 335, at: 7.58 }] } },
    { dur: 7.5, layout: 'phone', clip: team(10, -HELD + 5.4), trimmed: false, shots: [CARD],
      caption: 'On the phone: <b>Continue with steer</b>.' },
    { dur: 3, layout: 'phone', clip: team(10, 0.5), trimmed: false, shots: [CARD],
      caption: 'Answered. <b>The edit goes through</b>, with the steer.' },
    { dur: 7.5, layout: 'phone', clip: team(10, 10.6), shots: [{ fx: 780, fy: 300, z: 1.6 }, { at: 2.8, fx: 780, fy: 500, z: 1.9, d: 1.4 }],
      caption: 'One new field, by the agent. <b>The validation untouched.</b>' },
  ],
};
