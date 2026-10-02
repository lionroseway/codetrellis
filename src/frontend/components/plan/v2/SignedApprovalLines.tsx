/**
 * Phase 32 C2.5b — an approval as a signed statement, under its criterion.
 *
 * "✓ signed with your git key" when this machine signed it into the plan's
 * folder; "kept on this machine" with why when it could not; "✓ verified,
 * signed by …" for a teammate's record whose SSH signature checked out
 * against git's allowed signers; "⚠ can't verify" with why for one that did
 * not, which counts for nothing.
 */

import { useEffect, useState } from 'react';
import type { SignedApproval } from '@shared/types';
import { shortDate } from '@shared/lib/git-state-words';

/** An item's signed approvals, read again whenever its criteria change. */
export function useSignedApprovals(itemUid: string, nonce: string): SignedApproval[] {
  const [list, setList] = useState<SignedApproval[]>([]);
  useEffect(() => {
    let live = true;
    fetch(`/api/items/${encodeURIComponent(itemUid)}/signed-approvals`)
      .then(async (r) => (r.ok ? ((await r.json()) as SignedApproval[]) : []))
      .catch(() => [] as SignedApproval[])
      .then((l) => { if (live) setList(l); });
    return () => { live = false; };
  }, [itemUid, nonce]);
  return list;
}

const day = (at: number) => shortDate(Math.floor(at / 1000));

export function signedApprovalWords(a: SignedApproval): { glyph: string; words: string; tone: string } {
  switch (a.state) {
    case 'signed': return { glyph: '✓', words: `signed with your git key${a.signer ? ` as ${a.signer}` : ''}, in the plan's folder`, tone: 'text-green-400/90' };
    case 'verified': return { glyph: '✓', words: `verified, signed by ${a.signer} on ${day(a.at)}`, tone: 'text-green-400/90' };
    case 'unverified': return { glyph: '⚠', words: `can't verify${a.signer ? ` an approval claiming to be ${a.signer}` : ' an approval record'}: ${a.reason}. It counts for nothing.`, tone: 'text-amber-300/90' };
    default: return { glyph: '·', words: `kept on this machine: ${a.reason}`, tone: 'text-foreground-subtle' };
  }
}

export function SignedApprovalLines({ approvals }: { approvals: SignedApproval[] }) {
  if (approvals.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5" data-testid="signed-approvals">
      {approvals.map((a) => {
        const w = signedApprovalWords(a);
        return (
          <li key={a.uid} data-testid="signed-approval" data-state={a.state} className={`text-[11px] ${w.tone}`}>
            {w.glyph} {w.words}
          </li>
        );
      })}
    </ul>
  );
}
