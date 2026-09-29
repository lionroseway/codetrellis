/**
 * A suggested merge order for the review queue (Phase 32 A5.4, awareness
 * spec §9.2), with the reason for each place.
 *
 * When line A changes something line B imports (an open contract overlap),
 * A goes first and B gets a heads-up to update, rather than B merging first
 * and A breaking it. Among lines free to go, ready ones come first, then by
 * name. Where lines each change something the other imports (a cycle), the
 * best-ranked one goes first and the reason says so. The order is a
 * suggestion, never enforced.
 *
 * Pure.
 */

export interface OrderLine {
  key: string;
  /** What a person calls it: its branch. */
  name: string;
  ready: boolean;
}

/** `first` changes `symbol`, which `then` imports. */
export interface OrderDependency {
  first: string;
  then: string;
  symbol: string;
}

export interface OrderedLine {
  key: string;
  /** 1-based. */
  position: number;
  reason: string;
}

const list = (xs: string[]): string => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export function mergeOrder(lines: readonly OrderLine[], deps: readonly OrderDependency[]): OrderedLine[] {
  const byKey = new Map(lines.map((l) => [l.key, l]));
  const real = deps.filter((d) => d.first !== d.then && byKey.has(d.first) && byKey.has(d.then));
  const incoming = new Map(lines.map((l) => [l.key, new Set<string>()]));
  for (const d of real) incoming.get(d.then)!.add(d.first);

  const rank = (a: OrderLine, b: OrderLine) => Number(b.ready) - Number(a.ready) || a.name.localeCompare(b.name);
  const placed: string[] = [];
  const done = new Set<string>();
  // Lines placed only to break a cycle: nothing was free, so the best-ranked
  // waiting line goes next and its reason says why.
  const cycle: string[] = [];
  while (done.size < lines.length) {
    const waiting = lines.filter((l) => !done.has(l.key)).sort(rank);
    const free = waiting.filter((l) => [...incoming.get(l.key)!].every((k) => done.has(k)));
    const next = free[0] ?? waiting[0];
    if (!free.length) cycle.push(next.key);
    placed.push(next.key);
    done.add(next.key);
  }

  const name = (k: string) => byKey.get(k)!.name;
  const reasonFor = (key: string): string => {
    if (cycle.includes(key)) {
      const partners = [...new Set(real.filter((d) => d.then === key && placed.indexOf(d.first) > placed.indexOf(key)).map((d) => name(d.first)))];
      return `${name(key)} and ${list(partners)} each change something the other imports: merge ${name(key)} first, then update ${list(partners)} to it.`;
    }
    const after = real.filter((d) => d.then === key);
    const before = real.filter((d) => d.first === key);
    const parts: string[] = [];
    if (after.length) {
      parts.push(`After ${list([...new Set(after.map((d) => name(d.first)))])}: it changes ${list([...new Set(after.map((d) => d.symbol))])}, which this imports, so update to it first.`);
    }
    if (before.length) {
      const who = [...new Set(before.map((d) => name(d.then)))];
      parts.push(`Before ${list(who)}: ${who.length > 1 ? 'they import' : 'it imports'} ${list([...new Set(before.map((d) => d.symbol))])}, which this changes, and will need updating after.`);
    }
    if (parts.length === 0) return 'No other line of work depends on this one.';
    return parts.join(' ');
  };

  return placed.map((key, i) => ({ key, position: i + 1, reason: reasonFor(key) }));
}
