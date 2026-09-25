/**
 * Receiving a streamed preview from the desktop (Phase 31 §12).
 *
 * One control-channel message is capped (64 KB by our SDP), so the desktop
 * streams a preview of a piece of evidence as `preview.chunk` messages,
 * each carrying the id WE chose when we asked. This collects them.
 *
 * Only ids we are waiting for are accepted: a chunk for anything else is
 * dropped, so nothing the desktop (or anything that reached the channel)
 * sends unasked is ever assembled. A transfer that breaks its own shape —
 * a total that changes, a sequence number out of range, more than the caps
 * allow — is failed rather than trusted, and one that stalls times out.
 *
 * Deliberately free of React Native imports: the desktop's test feeds the
 * desktop's real chunks through this real receiver
 * (src/backend/services/mobile-approvals.test.ts).
 */

export interface PreviewChunk {
  cmd: 'preview.chunk';
  id: string;
  seq: number;
  total: number;
  data: string;
}

export interface TransferLimits {
  timeoutMs: number;
  /** The most chunks one transfer may declare. */
  maxChunks: number;
  /** The most characters one transfer may carry in all. */
  maxChars: number;
}

export const DEFAULT_TRANSFER_LIMITS: TransferLimits = {
  timeoutMs: 60_000,
  maxChunks: 800,
  maxChars: 12_000_000,
};

interface Pending {
  parts: Array<string | undefined>;
  total: number | null;
  received: number;
  chars: number;
  resolve: (body: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** An id the desktop accepts: 8–64 letters, digits or dashes. */
export function newTransferId(): string {
  return `pv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class PreviewTransfers {
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly limits: TransferLimits = DEFAULT_TRANSFER_LIMITS) {}

  /** Start waiting for `id`. Resolves with the whole body once every chunk is in. */
  expect(id: string): Promise<string> {
    if (this.pending.has(id)) return Promise.reject(new Error(`Already waiting for ${id}`));
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(id, new Error('The preview did not arrive in time — try again, or open it on the desktop.')),
        this.limits.timeoutMs,
      );
      this.pending.set(id, { parts: [], total: null, received: 0, chars: 0, resolve, reject, timer });
    });
  }

  /**
   * Offer a control message. Returns true when it was a chunk for a
   * transfer we are waiting for (consumed), false otherwise.
   */
  accept(msg: unknown): boolean {
    if (!msg || typeof msg !== 'object') return false;
    const m = msg as Record<string, unknown>;
    if (m.cmd !== 'preview.chunk' || typeof m.id !== 'string') return false;
    const p = this.pending.get(m.id);
    if (!p) return false;

    const { seq, total, data } = m;
    if (
      typeof total !== 'number' || !Number.isInteger(total) || total < 1 || total > this.limits.maxChunks ||
      (p.total !== null && total !== p.total) ||
      typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0 || seq >= total ||
      typeof data !== 'string'
    ) {
      this.fail(m.id, new Error('The preview arrived malformed'));
      return true;
    }
    if (p.total === null) {
      p.total = total;
      p.parts = new Array<string | undefined>(total);
    }
    if (p.parts[seq] !== undefined) return true; // a duplicate — already have it
    p.chars += data.length;
    if (p.chars > this.limits.maxChars) {
      this.fail(m.id, new Error('The preview is larger than the phone accepts'));
      return true;
    }
    p.parts[seq] = data;
    p.received++;
    if (p.received === p.total) {
      clearTimeout(p.timer);
      this.pending.delete(m.id);
      p.resolve(p.parts.join(''));
    }
    return true;
  }

  /** Stop waiting for one transfer (its request failed). */
  cancel(id: string, reason = 'Cancelled'): void {
    this.fail(id, new Error(reason));
  }

  /** Stop waiting for everything (the connection went). */
  cancelAll(reason = 'Connection lost'): void {
    for (const id of [...this.pending.keys()]) this.fail(id, new Error(reason));
  }

  get waiting(): number {
    return this.pending.size;
  }

  private fail(id: string, err: Error): void {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);
    p.reject(err);
  }
}
