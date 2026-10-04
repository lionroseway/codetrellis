import React from 'react';
import {AbsoluteFill, Easing, interpolate, random, spring, useCurrentFrame, useVideoConfig} from 'remotion';

/* ---------- tokens ---------- */
const C = {
  page: '#F7F9FC',
  navy: '#0B1220',
  navy70: 'rgba(11,18,32,0.68)',
  navy45: 'rgba(11,18,32,0.45)',
  blue: '#2F6BFF',
  cyan: '#22C3E6',
  violet: '#8B5CF6',
  win: '#0E1420',
  panel: '#121A28',
  card: '#151E2E',
  border: '#232E42',
  borderSoft: '#1B2537',
  text: '#E8EEF8',
  muted: '#8794AB',
  dim: '#5B6880',
  amber: '#F5B83D',
};
const SANS = 'Geist, system-ui, sans-serif';
const MONO = '"Geist Mono", ui-monospace, monospace';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const ease = Easing.bezier(0.22, 1, 0.36, 1); // easeOutQuint-ish
const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/* spring helpers: no-overshoot reveal, and a soft settle with a hint of overshoot */
const useSprings = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const smooth = (start: number, dur = 24) =>
    spring({frame: frame - start, fps, durationInFrames: dur, config: {damping: 200}});
  const settle = (start: number, dur = 40) =>
    spring({frame: frame - start, fps, durationInFrames: dur, config: {damping: 16, stiffness: 90, mass: 1}});
  return {frame, smooth, settle};
};

/* ---------- graph data ---------- */
type NodeId = 'web' | 'mobile' | 'api' | 'jobs' | 'auth' | 'payments' | 'core' | 'db';
const NODES: Record<NodeId, {x: number; y: number; files: number; lang: string}> = {
  web: {x: 112, y: 236, files: 64, lang: '#61DAFB'},
  mobile: {x: 112, y: 446, files: 38, lang: '#61DAFB'},
  api: {x: 290, y: 330, files: 41, lang: '#3178C6'},
  jobs: {x: 290, y: 566, files: 9, lang: '#3776AB'},
  auth: {x: 466, y: 150, files: 18, lang: '#3178C6'},
  payments: {x: 466, y: 410, files: 27, lang: '#3178C6'},
  core: {x: 642, y: 236, files: 52, lang: '#3178C6'},
  db: {x: 642, y: 500, files: 12, lang: '#E38C00'},
};
const NODE_ORDER: NodeId[] = ['web', 'mobile', 'api', 'jobs', 'auth', 'payments', 'core', 'db'];
const NW = 148;
const NH = 58;
const EDGES: Array<[NodeId, NodeId]> = [
  ['web', 'api'],
  ['mobile', 'api'],
  ['jobs', 'payments'],
  ['jobs', 'db'],
  ['api', 'auth'],
  ['api', 'payments'],
  ['auth', 'core'],
  ['payments', 'core'],
  ['payments', 'db'],
];

const edgeGeom = (a: NodeId, b: NodeId) => {
  const s = NODES[a];
  const t = NODES[b];
  const p0 = {x: s.x + NW / 2, y: s.y};
  const p3 = {x: t.x - NW / 2, y: t.y};
  const k = Math.max(40, (p3.x - p0.x) * 0.55);
  const p1 = {x: p0.x + k, y: p0.y};
  const p2 = {x: p3.x - k, y: p3.y};
  const d = `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`;
  const at = (u: number) => {
    const m = 1 - u;
    return {
      x: m * m * m * p0.x + 3 * m * m * u * p1.x + 3 * m * u * u * p2.x + u * u * u * p3.x,
      y: m * m * m * p0.y + 3 * m * m * u * p1.y + 3 * m * u * u * p2.y + u * u * u * p3.y,
    };
  };
  return {d, at};
};

/* ---------- agents ---------- */
type Agent = {
  name: string;
  color: string;
  action: string;
  target: NodeId;
  via: [NodeId, NodeId];
  start: number;
};
const AGENTS: Agent[] = [
  {name: 'Claude Code', color: '#FF8A4C', action: 'editing payments/refund.ts', target: 'payments', via: ['api', 'payments'], start: 150},
  {name: 'Codex', color: '#2DD4A4', action: 'writing db/migrations/0042.sql', target: 'db', via: ['payments', 'db'], start: 168},
  {name: 'Cursor', color: '#A78BFA', action: 'refactoring auth/session.ts', target: 'auth', via: ['api', 'auth'], start: 186},
];
const PULSE_DELAY = 8;
const PULSE_DUR = 22;

/* phone / breakpoint timing */
const PHONE_IN = 236;
const CARD_IN = 250;
const TAP = 268;
const APPROVED = 274;
const OUTRO = 294;

/* ---------- background ---------- */
const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = frame * 0.15;
  return (
    <AbsoluteFill style={{background: C.page, overflow: 'hidden'}}>
      <AbsoluteFill
        style={{
          backgroundImage: 'radial-gradient(rgba(11,18,32,0.07) 1.2px, transparent 1.3px)',
          backgroundSize: '32px 32px',
          backgroundPosition: `${-drift}px ${-drift * 0.4}px`,
          maskImage: 'radial-gradient(ellipse 75% 70% at 60% 45%, black 20%, transparent 85%)',
          WebkitMaskImage: 'radial-gradient(ellipse 75% 70% at 60% 45%, black 20%, transparent 85%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 1300,
          height: 900,
          left: 640 + Math.sin(frame / 60) * 20,
          top: 120,
          borderRadius: '50%',
          background: 'radial-gradient(closest-side, rgba(47,107,255,0.13), rgba(34,195,230,0.06) 55%, transparent)',
          filter: 'blur(20px)',
        }}
      />
    </AbsoluteFill>
  );
};

/* ---------- masked line ---------- */
const MaskLine: React.FC<{progress: number; children: React.ReactNode; style?: React.CSSProperties}> = ({
  progress,
  children,
  style,
}) => (
  <div style={{overflow: 'hidden', paddingBottom: '0.14em', marginBottom: '-0.14em', ...style}}>
    <div style={{transform: `translateY(${(1 - progress) * 115}%)`, opacity: interpolate(progress, [0, 0.3], [0, 1], clamp)}}>
      {children}
    </div>
  </div>
);

/* ---------- headline (beat 1 → left column in beat 2) ---------- */
const Headline: React.FC = () => {
  const {frame, smooth} = useSprings();
  const lines = [0, 1, 2].map((i) => smooth(4 + i * 9, 26));
  const move = interpolate(frame, [80, 112], [0, 1], {...clamp, easing: easeInOut});
  const out = 0; // scene-level outro handles exit

  const fontSize = lerp(164, 82, move);
  const left = lerp(960, 120, move);
  const tx = lerp(-50, 0, move);
  const top = lerp(540, 492, move);


  const eyebrow = smooth(104, 22);
  const sub = smooth(112, 24);

  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        transform: `translate(${tx}%, -50%) translateY(${-out * 30}px)`,
        opacity: 1 - out,
        fontFamily: SANS,
        fontWeight: 600,
        fontSize,
        lineHeight: 1.04,
        letterSpacing: '-0.045em',
        color: C.navy,
        whiteSpace: 'nowrap',
      }}
    >
      <div
        style={{
          position: 'absolute',
          bottom: '100%',
          marginBottom: 26,
          left: 2,
          opacity: eyebrow,
          transform: `translateY(${(1 - eyebrow) * 12}px)`,
          fontFamily: MONO,
          fontWeight: 500,
          fontSize: 15,
          letterSpacing: '0.16em',
          color: C.blue,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span style={{width: 8, height: 8, borderRadius: 2, background: C.blue, display: 'inline-block'}} />
        CODETRELLIS
      </div>
      <MaskLine progress={lines[0]}>Any agent.</MaskLine>
      <MaskLine progress={lines[1]}>Any number.</MaskLine>
      <MaskLine progress={lines[2]}>
        One{' '}
        <span style={{color: C.blue, position: 'relative', display: 'inline-block'}}>
          map.

        </span>
      </MaskLine>
      <div
        style={{
          position: 'absolute',
          top: '100%',
          marginTop: 30,
          left: 2,
          width: 480,
          whiteSpace: 'normal',
          fontSize: 25,
          lineHeight: 1.45,
          letterSpacing: '-0.01em',
          fontWeight: 400,
          color: C.navy70,
          opacity: sub,
          transform: `translateY(${(1 - sub) * 14}px)`,
        }}
      >
        See every AI coding agent working on your code at once — and step in before their work collides.
      </div>
    </div>
  );
};

/* ---------- graph ---------- */
const Graph: React.FC<{w: number; h: number}> = ({w, h}) => {
  const {frame, smooth} = useSprings();
  const bpActive = frame >= CARD_IN - 6 && frame < APPROVED + 4;

  const touched = (id: NodeId) => AGENTS.find((a) => a.target === id);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: 'radial-gradient(rgba(255,255,255,0.055) 1px, transparent 1.2px)',
        backgroundSize: '24px 24px',
      }}
    >
      <svg width={w} height={h} style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>
        {EDGES.map(([a, b], i) => {
          const {d} = edgeGeom(a, b);
          const p = interpolate(frame, [104 + i * 3, 126 + i * 3], [0, 1], {...clamp, easing: ease});
          return (
            <path
              key={`${a}-${b}`}
              d={d}
              pathLength={1}
              fill="none"
              stroke="#34425C"
              strokeWidth={2}
              strokeDasharray="1 1"
              strokeDashoffset={1 - p}
            />
          );
        })}
        {AGENTS.map((ag) => {
          const {d, at} = edgeGeom(ag.via[0], ag.via[1]);
          const s = ag.start + PULSE_DELAY;
          const u = interpolate(frame, [s, s + PULSE_DUR], [0, 1], {...clamp, easing: easeInOut});
          if (frame < s) return null;
          const seg = 0.28;
          const head = at(u);
          const headOpacity = interpolate(frame, [s + PULSE_DUR - 2, s + PULSE_DUR + 8], [1, 0], clamp);
          const color = ag.name === 'Codex' && bpActive ? C.amber : ag.color;
          return (
            <g key={ag.name}>
              {/* persistent tinted trail once the agent has touched the path */}
              <path d={d} pathLength={1} fill="none" stroke={color} strokeOpacity={0.45} strokeWidth={2}
                strokeDasharray="1 1" strokeDashoffset={1 - u} />
              <path d={d} pathLength={1} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round"
                strokeDasharray={`${seg} 2`} strokeDashoffset={-(u - seg)} opacity={headOpacity} />
              <circle cx={head.x} cy={head.y} r={10} fill={color} opacity={0.55 * headOpacity} filter="url(#glow)" />
              <circle cx={head.x} cy={head.y} r={4.5} fill="#fff" opacity={headOpacity} />
            </g>
          );
        })}
      </svg>

      {NODE_ORDER.map((id, i) => {
        const n = NODES[id];
        const appear = smooth(96 + i * 3, 22);
        const ag = touched(id);
        const arrive = ag ? ag.start + PULSE_DELAY + PULSE_DUR : 9999;
        const lit = interpolate(frame, [arrive - 2, arrive + 6], [0, 1], clamp);
        const ring = interpolate(frame, [arrive, arrive + 22], [0, 1], {...clamp, easing: ease});
        const color = ag ? (ag.name === 'Codex' && bpActive ? C.amber : ag.color) : C.blue;
        return (
          <div
            key={id}
            style={{
              position: 'absolute',
              left: n.x - NW / 2,
              top: n.y - NH / 2,
              width: NW,
              height: NH,
              opacity: appear,
              transform: `translateY(${(1 - appear) * 14}px) scale(${0.92 + appear * 0.08})`,
            }}
          >
            {ag && frame >= arrive && (
              <div
                style={{
                  position: 'absolute',
                  inset: -2,
                  borderRadius: 14,
                  border: `2px solid ${color}`,
                  opacity: (1 - ring) * 0.9,
                  transform: `scale(${1 + ring * 0.35})`,
                }}
              />
            )}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: 12,
                background: C.card,
                border: `1.5px solid ${lit > 0 ? color : C.border}`,
                boxShadow: lit > 0 ? `0 0 0 4px ${color}22, 0 0 28px ${color}40` : '0 6px 16px rgba(0,0,0,0.35)',
                display: 'flex',
                alignItems: 'center',
                padding: '0 14px',
                gap: 10,
              }}
            >
              <div style={{width: 10, height: 10, borderRadius: 3, background: n.lang, opacity: 0.9}} />
              <div style={{display: 'flex', flexDirection: 'column', gap: 3}}>
                <div style={{fontFamily: MONO, fontSize: 16, fontWeight: 500, color: C.text, letterSpacing: '-0.01em'}}>{id}/</div>
                <div style={{fontFamily: MONO, fontSize: 11.5, color: C.dim}}>{n.files} files</div>
              </div>
            </div>
            {ag && (
              <div
                style={{
                  position: 'absolute',
                  right: -8,
                  top: -9,
                  height: 20,
                  padding: '0 8px',
                  borderRadius: 10,
                  background: color,
                  color: '#0B1220',
                  fontFamily: SANS,
                  fontWeight: 600,
                  fontSize: 11.5,
                  display: 'flex',
                  alignItems: 'center',
                  opacity: lit,
                  transform: `scale(${0.6 + lit * 0.4})`,
                  boxShadow: '0 4px 10px rgba(0,0,0,0.35)',
                }}
              >
                {ag.name}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

/* ---------- agent rail ---------- */
const AgentChip: React.FC<{ag: Agent; index: number}> = ({ag}) => {
  const {frame, smooth} = useSprings();
  const p = smooth(ag.start, 22);
  const isCodex = ag.name === 'Codex';
  const bp = isCodex && frame >= CARD_IN - 6 && frame < APPROVED + 4;
  const resumed = isCodex && frame >= APPROVED + 4;
  const color = bp ? C.amber : ag.color;
  const action = bp ? 'breakpoint · run migrations?' : resumed ? 'running migrations · approved' : ag.action;
  const blink = bp ? 0.45 + 0.55 * Math.abs(Math.cos((frame - CARD_IN) / 5)) : 1;
  const progress = interpolate(frame, [ag.start + 10, 300], [0.08, isCodex ? 0.72 : 0.9], clamp);

  return (
    <div
      style={{
        opacity: p,
        transform: `translateX(${(1 - p) * 40}px)`,
        background: C.card,
        border: `1px solid ${bp ? 'rgba(245,184,61,0.55)' : C.border}`,
        borderRadius: 12,
        padding: '14px 16px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
        <div style={{position: 'relative', width: 10, height: 10}}>
          <div style={{position: 'absolute', inset: 0, borderRadius: 5, background: color, opacity: blink}} />
          <div style={{position: 'absolute', inset: -4, borderRadius: 9, background: color, opacity: 0.18 * blink}} />
        </div>
        <div style={{fontFamily: SANS, fontWeight: 600, fontSize: 17, color: C.text, letterSpacing: '-0.01em'}}>{ag.name}</div>
        <div style={{flex: 1}} />
        <div
          style={{
            fontFamily: MONO,
            fontSize: 10.5,
            letterSpacing: '0.08em',
            color: C.muted,
            border: `1px solid ${C.border}`,
            borderRadius: 5,
            padding: '2px 6px',
          }}
        >
          MCP
        </div>
      </div>
      <div style={{fontFamily: MONO, fontSize: 13, color: bp ? C.amber : C.muted, whiteSpace: 'nowrap'}}>{action}</div>
      <div style={{height: 3, borderRadius: 2, background: C.borderSoft, overflow: 'hidden'}}>
        <div style={{width: `${progress * 100}%`, height: '100%', background: color, opacity: 0.85}} />
      </div>
    </div>
  );
};

const TIMELINE: Array<{t: number; who: number; text: string}> = [
  {t: 160, who: 0, text: 'read_file  payments/refund.ts'},
  {t: 178, who: 1, text: 'get_dependents  db/'},
  {t: 196, who: 2, text: 'open_file  auth/session.ts'},
  {t: 212, who: 0, text: 'edit  payments/refund.ts  +14 −3'},
  {t: 226, who: 2, text: 'get_symbol  Session.refresh'},
];

const Rail: React.FC = () => {
  const {frame, smooth} = useSprings();
  const count = AGENTS.filter((a) => frame >= a.start).length;
  const head = smooth(118, 20);
  return (
    <div style={{position: 'absolute', inset: 0, padding: '22px 20px', display: 'flex', flexDirection: 'column', gap: 12}}>
      <div style={{display: 'flex', alignItems: 'center', opacity: head, marginBottom: 4}}>
        <div style={{fontFamily: MONO, fontSize: 12, letterSpacing: '0.14em', color: C.muted}}>AGENTS</div>
        <div style={{flex: 1}} />
        <div style={{fontFamily: MONO, fontSize: 12, color: count ? '#2DD4A4' : C.dim}}>● {count} connected</div>
      </div>
      {AGENTS.map((ag, i) => (
        <AgentChip key={ag.name} ag={ag} index={i} />
      ))}
      <div style={{marginTop: 14, fontFamily: MONO, fontSize: 12, letterSpacing: '0.14em', color: C.muted, opacity: smooth(158, 20)}}>
        TIMELINE
      </div>
      <div style={{display: 'flex', flexDirection: 'column', gap: 9}}>
        {TIMELINE.map((row) => {
          const p = smooth(row.t, 18);
          return (
            <div
              key={row.text}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                opacity: p,
                transform: `translateY(${(1 - p) * 8}px)`,
                fontFamily: MONO,
                fontSize: 12.5,
                color: '#A9B4C8',
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{width: 6, height: 6, borderRadius: 3, background: AGENTS[row.who].color, flex: 'none'}} />
              {row.text}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ---------- app window ---------- */
const WIN = {x: 704, y: 168, w: 1100, h: 744};
const TITLE_H = 46;
const RAIL_W = 344;
const STATUS_H = 34;

const AppWindow: React.FC = () => {
  const {frame, settle} = useSprings();
  const rise = settle(90, 54);
  const out = 0; // scene-level outro handles exit
  const phoneDim = interpolate(frame, [PHONE_IN, PHONE_IN + 20, OUTRO], [0, 1, 1], clamp);

  const rx = lerp(26, 0, rise);
  const ry = lerp(-16, 0, rise);
  const rz = lerp(3, 0, rise);
  const ty = lerp(380, 0, rise);
  const sc = lerp(0.9, 1, rise) * lerp(1, 0.94, out);
  const op = interpolate(frame, [90, 104], [0, 1], clamp) * (1 - out);

  const gw = WIN.w - RAIL_W;
  const gh = WIN.h - TITLE_H - STATUS_H;

  return (
    <div style={{position: 'absolute', inset: 0, perspective: 2200, perspectiveOrigin: '60% 40%'}}>
      <div
        style={{
          position: 'absolute',
          left: WIN.x,
          top: WIN.y,
          width: WIN.w,
          height: WIN.h,
          opacity: op,
          transform: `translateY(${ty - out * 20}px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg) scale(${sc})`,
          transformOrigin: '50% 60%',
          borderRadius: 16,
          background: C.win,
          border: '1px solid #1E2839',
          boxShadow:
            '0 80px 140px -30px rgba(11,18,32,0.42), 0 30px 60px -20px rgba(11,18,32,0.30), 0 0 0 1px rgba(11,18,32,0.06)',
          overflow: 'hidden',
          filter: `brightness(${1 - phoneDim * 0.18})`,
        }}
      >
        {/* title bar */}
        <div
          style={{
            height: TITLE_H,
            display: 'flex',
            alignItems: 'center',
            padding: '0 18px',
            borderBottom: `1px solid ${C.borderSoft}`,
            background: '#0B111C',
          }}
        >
          <div style={{display: 'flex', gap: 8}}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{width: 12, height: 12, borderRadius: 6, background: '#263046'}} />
            ))}
          </div>
          <div style={{flex: 1, textAlign: 'center', fontFamily: MONO, fontSize: 13, color: C.muted}}>
            CodeTrellis <span style={{color: C.dim}}>—</span> acme/storefront
          </div>
          <div style={{fontFamily: MONO, fontSize: 12, color: C.dim, width: 52, textAlign: 'right'}}>main</div>
        </div>
        {/* body */}
        <div style={{position: 'relative', height: WIN.h - TITLE_H}}>
          <div style={{position: 'absolute', left: 0, top: 0, width: gw, height: gh}}>
            <Graph w={gw} h={gh} />
          </div>
          <div
            style={{
              position: 'absolute',
              left: 0,
              bottom: 0,
              width: gw,
              height: STATUS_H,
              borderTop: `1px solid ${C.borderSoft}`,
              display: 'flex',
              alignItems: 'center',
              padding: '0 18px',
              gap: 22,
              fontFamily: MONO,
              fontSize: 12,
              color: C.dim,
              background: '#0B111C',
            }}
          >
            <span>8 packages · 271 files</span>
            <span>13 languages + SQL</span>
            <span>212 MCP tools</span>
            <span style={{flex: 1}} />
            <span style={{color: '#2DD4A4'}}>● live</span>
          </div>
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              width: RAIL_W,
              height: '100%',
              borderLeft: `1px solid ${C.borderSoft}`,
              background: C.panel,
            }}
          >
            <Rail />
          </div>
        </div>
      </div>
    </div>
  );
};

/* ---------- phone ---------- */
const Phone: React.FC = () => {
  const {frame, settle, smooth} = useSprings();
  const inP = settle(PHONE_IN, 44);
  const out = 0; // scene-level outro handles exit
  const card = settle(CARD_IN, 36);
  const press = interpolate(frame, [TAP - 2, TAP + 2, TAP + 8], [0, 1, 0], clamp);
  const ripple = interpolate(frame, [TAP, TAP + 18], [0, 1], {...clamp, easing: ease});
  const finger = interpolate(frame, [TAP - 10, TAP - 2, TAP + 6, TAP + 14], [0, 1, 1, 0], clamp);
  const approved = smooth(APPROVED, 14);

  const PW = 306;
  const PH = 610;
  const x = 1526;
  const y = 462;

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: PW,
        height: PH,
        transform: `translate(${(1 - inP) * 160}px, ${(1 - inP) * 520 + out * 40}px) rotate(${(1 - inP) * 8}deg)`,
        opacity: interpolate(frame, [PHONE_IN, PHONE_IN + 8], [0, 1], clamp) * (1 - out),
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 58,
          background: 'linear-gradient(160deg, #2A3242, #0A0E16 40%, #151B27)',
          boxShadow: '0 60px 100px -20px rgba(11,18,32,0.55), 0 20px 40px -10px rgba(11,18,32,0.35)',
          padding: 11,
        }}
      >
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            borderRadius: 48,
            overflow: 'hidden',
            background: 'linear-gradient(180deg, #111A2B 0%, #0B111C 100%)',
          }}
        >
          {/* status bar + island */}
          <div style={{position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', width: 104, height: 30, borderRadius: 16, background: '#000'}} />
          <div style={{position: 'absolute', top: 18, left: 30, fontFamily: SANS, fontWeight: 600, fontSize: 15, color: C.text}}>9:41</div>
          <div style={{position: 'absolute', top: 20, right: 28, display: 'flex', gap: 4}}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{width: 3.5, height: 6 + i * 2.5, borderRadius: 1, background: C.text, alignSelf: 'flex-end'}} />
            ))}
          </div>

          {/* app header */}
          <div style={{position: 'absolute', top: 66, left: 22, right: 22}}>
            <div style={{fontFamily: MONO, fontSize: 11, letterSpacing: '0.14em', color: C.muted}}>ACME/STOREFRONT</div>
            <div style={{fontFamily: SANS, fontWeight: 600, fontSize: 26, color: C.text, letterSpacing: '-0.02em', marginTop: 4}}>Agents</div>
          </div>

          {/* notification card */}
          <div
            style={{
              position: 'absolute',
              top: 126,
              left: 12,
              right: 12,
              transform: `translateY(${(1 - card) * -60}px) scale(${0.94 + card * 0.06})`,
              opacity: interpolate(frame, [CARD_IN, CARD_IN + 8], [0, 1], clamp),
              background: 'rgba(28,38,58,0.96)',
              border: `1px solid ${approved > 0.5 ? 'rgba(45,212,164,0.5)' : 'rgba(245,184,61,0.45)'}`,
              borderRadius: 22,
              padding: '16px 16px 16px',
              boxShadow: '0 18px 40px rgba(0,0,0,0.45)',
            }}
          >
            <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  background: `linear-gradient(135deg, ${C.blue}, ${C.cyan})`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Mark size={14} color="#fff" />
              </div>
              <div style={{fontFamily: MONO, fontSize: 11, letterSpacing: '0.1em', color: C.muted}}>CODETRELLIS</div>
              <div style={{flex: 1}} />
              <div style={{fontFamily: SANS, fontSize: 12, color: C.dim}}>now</div>
            </div>
            <div style={{marginTop: 12, display: 'flex', alignItems: 'center', gap: 8}}>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  fontWeight: 500,
                  color: approved > 0.5 ? '#2DD4A4' : C.amber,
                  border: `1px solid ${approved > 0.5 ? 'rgba(45,212,164,0.45)' : 'rgba(245,184,61,0.45)'}`,
                  borderRadius: 6,
                  padding: '2px 7px',
                  letterSpacing: '0.06em',
                }}
              >
                {approved > 0.5 ? 'APPROVED' : 'BREAKPOINT'}
              </div>
            </div>
            <div style={{marginTop: 10, fontFamily: SANS, fontWeight: 600, fontSize: 19, lineHeight: 1.3, color: C.text, letterSpacing: '-0.01em'}}>
              Codex wants to run migrations
            </div>
            <div style={{marginTop: 6, fontFamily: MONO, fontSize: 12, color: C.muted}}>db/migrations/0042.sql</div>
            <div style={{marginTop: 16, display: 'flex', gap: 10}}>
              <div style={{position: 'relative', flex: 1}}>
                <div
                  style={{
                    height: 44,
                    borderRadius: 12,
                    background: approved > 0.5 ? '#1F9E7C' : C.blue,
                    color: '#fff',
                    fontFamily: SANS,
                    fontWeight: 600,
                    fontSize: 16,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    transform: `scale(${1 - press * 0.05})`,
                    overflow: 'hidden',
                    position: 'relative',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      left: '50%',
                      top: '50%',
                      width: 220,
                      height: 220,
                      marginLeft: -110,
                      marginTop: -110,
                      borderRadius: '50%',
                      background: 'rgba(255,255,255,0.35)',
                      transform: `scale(${ripple})`,
                      opacity: frame >= TAP ? 1 - ripple : 0,
                    }}
                  />
                  {approved > 0.5 ? <><Check /> Approved</> : 'Approve'}
                </div>
                {/* touch indicator */}
                <div
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    width: 46,
                    height: 46,
                    marginLeft: -23 + 10,
                    marginTop: -23 + 6,
                    borderRadius: '50%',
                    background: 'rgba(255,255,255,0.28)',
                    border: '2px solid rgba(255,255,255,0.65)',
                    opacity: finger,
                    transform: `scale(${1 - press * 0.15})`,
                  }}
                />
              </div>
              <div
                style={{
                  flex: 1,
                  height: 44,
                  borderRadius: 12,
                  border: `1px solid ${C.border}`,
                  color: C.muted,
                  fontFamily: SANS,
                  fontWeight: 600,
                  fontSize: 16,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: 1 - approved * 0.5,
                }}
              >
                Deny
              </div>
            </div>
          </div>

          {/* agent list under the card */}
          <div style={{position: 'absolute', top: 384, left: 20, right: 20, display: 'flex', flexDirection: 'column', gap: 10}}>
            {AGENTS.map((ag, i) => {
              const p = smooth(PHONE_IN + 14 + i * 4, 18);
              const isCodex = ag.name === 'Codex';
              const col = isCodex && frame < APPROVED + 4 ? C.amber : ag.color;
              return (
                <div
                  key={ag.name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    opacity: p,
                    transform: `translateY(${(1 - p) * 10}px)`,
                    padding: '12px 14px',
                    borderRadius: 14,
                    background: 'rgba(255,255,255,0.04)',
                    border: `1px solid ${C.borderSoft}`,
                  }}
                >
                  <div style={{width: 9, height: 9, borderRadius: 5, background: col}} />
                  <div style={{fontFamily: SANS, fontWeight: 600, fontSize: 15, color: C.text}}>{ag.name}</div>
                  <div style={{flex: 1}} />
                  <div style={{fontFamily: MONO, fontSize: 11, color: C.dim}}>
                    {isCodex ? (frame < APPROVED + 4 ? 'waiting' : 'running') : 'active'}
                  </div>
                </div>
              );
            })}
          </div>
          {/* home indicator */}
          <div style={{position: 'absolute', bottom: 10, left: '50%', marginLeft: -60, width: 120, height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.55)'}} />
        </div>
      </div>
    </div>
  );
};

const Check: React.FC = () => (
  <svg width={16} height={16} viewBox="0 0 16 16">
    <path d="M3 8.5 L6.5 12 L13 4.5" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/* CodeTrellis mark: a small lattice of connected nodes */
const Mark: React.FC<{size: number; color: string}> = ({size, color}) => (
  <svg width={size} height={size} viewBox="0 0 24 24">
    <path d="M6 6 L18 6 M6 6 L6 18 M6 18 L18 18 M18 6 L12 12 L6 18 M12 12 L18 18" stroke={color} strokeWidth={1.8} fill="none" strokeLinecap="round" />
    {[[6, 6], [18, 6], [6, 18], [18, 18], [12, 12]].map(([cx, cy]) => (
      <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={2.8} fill={color} />
    ))}
  </svg>
);

/* ---------- end card ---------- */
const EndCard: React.FC = () => {
  const {frame, smooth, settle} = useSprings();
  const s = OUTRO + 12;
  const logo = settle(s, 36);
  const word = smooth(s + 4, 26);
  const tag = smooth(s + 9, 24);
  const pills = ['Any MCP agent', 'Desktop + phone', 'No telemetry', 'Apache 2.0'];
  const url = smooth(s + 22, 20);
  if (frame < s - 2) return null;
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', flexDirection: 'column'}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 30}}>
        <div
          style={{
            width: 116,
            height: 116,
            borderRadius: 30,
            background: `linear-gradient(140deg, ${C.blue} 0%, #4F7DFF 50%, ${C.cyan} 130%)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 30px 60px -18px rgba(47,107,255,0.55), inset 0 1px 0 rgba(255,255,255,0.35)',
            transform: `scale(${0.6 + logo * 0.4}) rotate(${(1 - logo) * -12}deg)`,
            opacity: interpolate(logo, [0, 0.3], [0, 1], clamp),
          }}
        >
          <Mark size={66} color="#fff" />
        </div>
        <MaskLine progress={word}>
          <div style={{fontFamily: SANS, fontWeight: 600, fontSize: 132, letterSpacing: '-0.05em', color: C.navy, lineHeight: 1.05}}>
            CodeTrellis
          </div>
        </MaskLine>
      </div>
      <MaskLine progress={tag} style={{marginTop: 34}}>
        <div style={{fontFamily: SANS, fontWeight: 500, fontSize: 44, letterSpacing: '-0.025em', color: C.navy70}}>
          Mission control for <span style={{color: C.blue}}>AI coding agents.</span>
        </div>
      </MaskLine>
      <div style={{display: 'flex', gap: 14, marginTop: 52}}>
        {pills.map((p, i) => {
          const pp = smooth(s + 14 + i * 3, 20);
          return (
            <div
              key={p}
              style={{
                opacity: pp,
                transform: `translateY(${(1 - pp) * 16}px)`,
                fontFamily: MONO,
                fontSize: 19,
                fontWeight: 500,
                color: C.navy,
                padding: '11px 20px',
                borderRadius: 999,
                background: '#FFFFFF',
                border: '1px solid #DCE3EE',
                boxShadow: '0 6px 18px -8px rgba(11,18,32,0.18)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <span style={{width: 7, height: 7, borderRadius: 4, background: i % 2 ? C.cyan : C.blue}} />
              {p}
            </div>
          );
        })}
      </div>
      <div
        style={{
          marginTop: 56,
          fontFamily: MONO,
          fontSize: 28,
          fontWeight: 500,
          color: C.blue,
          letterSpacing: '0.01em',
          opacity: url,
          transform: `translateY(${(1 - url) * 12}px)`,
        }}
      >
        codetrellis.dev →
      </div>
    </AbsoluteFill>
  );
};

/* ---------- sparkle field (seeded, deterministic) ---------- */
const Motes: React.FC = () => {
  const frame = useCurrentFrame();
  const fade = interpolate(frame, [90, 130, OUTRO, OUTRO + 16], [0, 1, 1, 0], clamp);
  return (
    <AbsoluteFill style={{opacity: fade}}>
      {new Array(14).fill(0).map((_, i) => {
        const x = 640 + random(`x${i}`) * 1240;
        const y = 80 + random(`y${i}`) * 940;
        const r = 2 + random(`r${i}`) * 3;
        const sp = 0.2 + random(`s${i}`) * 0.4;
        const col = random(`c${i}`) > 0.5 ? C.blue : C.cyan;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x,
              top: y - frame * sp,
              width: r * 2,
              height: r * 2,
              borderRadius: r,
              background: col,
              opacity: 0.18,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/* Beats 1–3 leave together as one composited group, so nothing shows through anything else. */
const Scene: React.FC<{children: React.ReactNode}> = ({children}) => {
  const frame = useCurrentFrame();
  const out = interpolate(frame, [OUTRO, OUTRO + 16], [0, 1], {...clamp, easing: easeInOut});
  if (out >= 1) return null;
  return (
    <AbsoluteFill
      style={{
        opacity: 1 - out,
        transform: `scale(${1 - out * 0.05}) translateY(${-out * 24}px)`,
        filter: out > 0 ? `blur(${out * 10}px)` : undefined,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

export const Hero: React.FC = () => (
  <AbsoluteFill style={{fontFamily: SANS, WebkitFontSmoothing: 'antialiased'}}>
    <Background />
    <Scene>
      <Motes />
      <AppWindow />
      <Headline />
      <Phone />
    </Scene>
    <EndCard />
  </AbsoluteFill>
);
