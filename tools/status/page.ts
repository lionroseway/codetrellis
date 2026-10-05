/**
 * A phase's progress as one HTML page (the owner's ask, 2026-10-05: a page he
 * can open to see where the phase is, kept up to date as the work moves).
 *
 * It is built from exactly what the LOG's block is built from (the status
 * file and git's facts), so the two cannot disagree. `npm run status -- --page`
 * writes it to `out/status/phase-<n>.html` (ignored by git), and the session
 * doing the work publishes that file to the phase's progress artifact, whose
 * link is in the phase's EXECUTION doc.
 *
 * The page is a fragment: the artifact host wraps it in its own document, so
 * it starts at <title> and carries its own styles, in light and dark.
 */

import type { Facts } from './git-facts';
import { flatten, resolve, type ItemStatus, type Resolved, type Status } from './status';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Backticks become code, `[text](url)` a link, the rest is escaped. */
function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

const WORDS: Record<ItemStatus, { glyph: string; word: string }> = {
  done: { glyph: '✓', word: 'Done' },
  in_review: { glyph: '◐', word: 'In review' },
  building: { glyph: '▸', word: 'Building' },
  todo: { glyph: '○', word: 'To do' },
};

export interface Counts { done: number; in_review: number; building: number; todo: number; total: number }

/** The steps that are work in themselves: items with no parts. A parent's state is its parts'. */
export function countLeaves(items: readonly Resolved[]): Counts {
  const c: Counts = { done: 0, in_review: 0, building: 0, todo: 0, total: 0 };
  const walk = (xs: readonly Resolved[]) => {
    for (const x of xs) {
      if (x.items.length) { walk(x.items); continue; }
      c[x.status] += 1;
      c.total += 1;
    }
  };
  walk(items);
  return c;
}

function bar(c: Counts): string {
  if (!c.total) return '';
  const pct = (n: number) => `${((n / c.total) * 100).toFixed(2)}%`;
  return `<div class="bar" role="img" aria-label="${c.done} of ${c.total} done, ${c.in_review} in review, ${c.building} building">`
    + `<span class="seg done" style="width:${pct(c.done)}"></span>`
    + `<span class="seg in_review" style="width:${pct(c.in_review)}"></span>`
    + `<span class="seg building" style="width:${pct(c.building)}"></span></div>`;
}

const prLink = (n: number) => `<a href="https://github.com/lionroseway/codetrellis/pull/${n}">#${n}</a>`;

function itemHtml(it: Resolved): string {
  const w = WORDS[it.status];
  const prs = it.prs.length ? ` <span class="prs">${it.prs.map(prLink).join(' ')}</span>` : '';
  const parts = it.items.length ? `<ul class="parts">${it.items.map(itemHtml).join('')}</ul>` : '';
  const id = it.id ? `<span class="id">${esc(it.id)}</span>` : '';
  const follow = it.followUp ? '<span class="tag">follow-up</span>' : '';
  return `<li class="item ${it.status}"><span class="chip ${it.status}" title="${w.word}">${w.glyph} ${w.word}</span>`
    + `<span class="what">${id}${follow}<span class="title">${inline(it.title)}</span>${prs}</span>${parts}</li>`;
}

export function renderPage(s: Status, facts: Facts | null, phase: number, now: Date): string {
  const resolved = resolve(s, facts);
  const all = countLeaves(resolved.flat());
  const flat = flatten(s, resolved);
  const inFlight = flat.filter((x) => x.id && x.from === 'git' && (x.status === 'in_review' || x.status === 'building'));
  const readAt = facts
    ? `Read from git at <code>${esc(facts.base)}</code> <code>${esc(facts.baseSha)}</code>${facts.source === 'github' ? ', with open pull requests from GitHub' : ' (offline)'}`
    : 'Not read from git';
  const sections = s.sections.map((sec, i) => {
    const c = countLeaves(resolved[i]);
    const goal = sec.goal ? `<p class="goal">${inline(sec.goal)}</p>` : '';
    return `<section class="sec"><header><h2>${inline(sec.title)}</h2><span class="count">${c.done} / ${c.total}</span></header>${goal}${bar(c)}`
      + `<ul class="items">${resolved[i].map(itemHtml).join('')}</ul></section>`;
  }).join('\n');

  return `<title>Phase ${phase} Progress</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@700&family=Source+Sans+3:wght@400;600&family=IBM+Plex+Mono:wght@400;600&display=swap">
<style>
/* A status board: the Now card, one bar for the phase, then one block per track. Glyph and word on every state, never colour alone. */
:root {
  --bg: #f3f5f6; --surface: #ffffff; --ink: #172026; --muted: #5d6a72; --rule: #d5dde1;
  --accent: #2f6f8f; --done: #2e7d4f; --review: #b7791f; --building: #2f6f8f; --todo: #8a979e;
  --display: "Schibsted Grotesk", "Helvetica Neue", Arial, sans-serif;
  --body: "Source Sans 3", "Segoe UI", system-ui, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, Menlo, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #11171a; --surface: #182024; --ink: #e1e8eb; --muted: #95a3aa; --rule: #2a353a;
  --accent: #7fb8d4; --done: #6cc391; --review: #e5b45a; --building: #7fb8d4; --todo: #6f7d84; color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #11171a; --surface: #182024; --ink: #e1e8eb; --muted: #95a3aa; --rule: #2a353a;
  --accent: #7fb8d4; --done: #6cc391; --review: #e5b45a; --building: #7fb8d4; --todo: #6f7d84; color-scheme: dark; }
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--ink); font-family: var(--body); font-size: 15px; line-height: 1.5; padding-inline: 16px; padding-block: 32px 64px; }
.wrap { max-width: 920px; margin: 0 auto; display: grid; gap: 28px; }
h1, h2 { font-family: var(--display); margin: 0; text-wrap: balance; }
h1 { font-size: clamp(1.8rem, 5vw, 2.6rem); line-height: 1.05; letter-spacing: -0.02em; }
h2 { font-size: 1.15rem; }
p { margin: 0; }
a { color: var(--accent); }
code { font-family: var(--mono); font-size: 0.85em; background: color-mix(in srgb, var(--accent) 12%, transparent); padding: 0 4px; border-radius: 3px; overflow-wrap: anywhere; }
.label { font-family: var(--mono); font-size: 0.7rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.now { background: var(--surface); border: 1px solid var(--rule); border-radius: 8px; padding: 18px 20px; display: grid; gap: 10px; }
.now dl { margin: 0; display: grid; grid-template-columns: 9rem 1fr; gap: 6px 16px; }
.now dt { font-family: var(--mono); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); padding-top: 3px; }
.now dd { margin: 0; min-width: 0; }
@media (max-width: 560px) { .now dl { grid-template-columns: 1fr; } .now dd { margin-bottom: 6px; } }
.overall { display: grid; gap: 8px; }
.totals { display: flex; flex-wrap: wrap; gap: 6px 18px; font-variant-numeric: tabular-nums; }
.bar { display: flex; height: 10px; border-radius: 5px; background: color-mix(in srgb, var(--todo) 25%, transparent); overflow: hidden; }
.seg.done { background: var(--done); } .seg.in_review { background: var(--review); } .seg.building { background: var(--building); }
.sec { display: grid; gap: 10px; }
.sec header { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; border-top: 2px solid var(--ink); padding-top: 12px; }
.count { font-family: var(--mono); font-variant-numeric: tabular-nums; color: var(--muted); }
.goal { color: var(--muted); max-width: 70ch; }
ul.items, ul.parts { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
ul.parts { margin: 6px 0 2px 1.4rem; }
.item { display: grid; grid-template-columns: 7.4rem 1fr; gap: 4px 10px; align-items: start; }
.item > ul.parts { grid-column: 2; }
.chip { font-family: var(--mono); font-size: 0.7rem; font-weight: 600; padding: 2px 6px; border-radius: 4px; white-space: nowrap; justify-self: start; border: 1px solid currentColor; }
.chip.done { color: var(--done); } .chip.in_review { color: var(--review); } .chip.building { color: var(--building); } .chip.todo { color: var(--todo); }
.what { min-width: 0; }
.id { font-family: var(--mono); font-weight: 600; margin-right: 6px; }
.tag { font-family: var(--mono); font-size: 0.68rem; color: var(--muted); border: 1px dashed var(--rule); border-radius: 3px; padding: 0 4px; margin-right: 6px; }
.item.done .title { color: var(--muted); }
.prs { font-family: var(--mono); font-size: 0.8rem; margin-left: 6px; }
@media (max-width: 520px) { .item { grid-template-columns: 1fr; } .item > ul.parts { grid-column: 1; } }
footer { color: var(--muted); font-size: 0.85rem; }
</style>
<div class="wrap">
  <header class="overall">
    <span class="label">CodeTrellis · Phase ${phase}</span>
    <h1>Phase ${phase} Progress</h1>
    <div class="totals"><span><b>${all.done}</b> of ${all.total} steps done</span><span>${WORDS.in_review.glyph} ${all.in_review} in review</span><span>${WORDS.building.glyph} ${all.building} building</span><span>${WORDS.todo.glyph} ${all.todo} to do</span></div>
    ${bar(all)}
  </header>
  <section class="now" aria-label="Now">
    <span class="label">Now</span>
    <dl>
      <dt>Step</dt><dd>${inline(s.now.step)}</dd>
      <dt>Status</dt><dd>${inline(s.now.status)}</dd>
      <dt>In flight</dt><dd>${inFlight.length ? inFlight.map((x) => `${esc(x.id!)} ${WORDS[x.status].word.toLowerCase()}${x.prs.length ? ` (${x.prs.map(prLink).join(', ')})` : ''}`).join('; ') : 'Nothing open'}</dd>
      <dt>Next</dt><dd>${inline(s.now.next)}</dd>
      <dt>Blockers</dt><dd>${inline(s.now.blockers)}</dd>
      <dt>Updated</dt><dd>${esc(String(s.now.updated))}</dd>
    </dl>
  </section>
${sections}
  <footer>${readAt}. Generated ${esc(now.toISOString().slice(0, 16).replace('T', ' '))} UTC from <code>docs/PHASE-${phase}-STATUS.yaml</code> by <code>npm run status -- --page</code>.</footer>
</div>
`;
}
