/**
 * Asking who you are — only when nobody can tell us.
 *
 * This used to run on EVERY first launch, and App.tsx rendered it in
 * place of the entire application. So a new user met a two-step form
 * before they could look at anything: confirm a name and email that had
 * already been read out of `git config` and typed into both boxes for
 * them, then read an MCP snippet.
 *
 * Two things were wrong with that, and the second is the worse one.
 *
 * It interrupted to confirm what we already knew. And because the app
 * was not merely covered but NOT MOUNTED, anything driving the product
 * — an agent over MCP, the demo script — got correct answers from the
 * backend while the window showed a sign-up form. A full demo run
 * reported "nothing looked wrong" across twenty-four scenes that nobody
 * could see, which is the exact failure mode the demo exists to catch.
 *
 * Now App.tsx seeds the identity from git silently and renders the app.
 * This component survives for the case that genuinely warrants a
 * question — a machine where `git config` has no name and no email —
 * and it sits OVER the app, escapable, rather than instead of it.
 *
 * The MCP step is gone. The guide covers connecting an agent across
 * seventeen topics you can come back to and search, which is a better
 * home for it than a panel you see once and cannot reopen.
 */

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, User } from 'lucide-react';

interface FirstRunCheckResponse {
  firstRunComplete: boolean;
  identity: { displayName: string; email: string };
  gitDefaults: { name: string; email: string };
}

export function FirstRunWizard({ onComplete }: { onComplete: () => void }) {
  // One step now. The MCP panel that used to be step two lives in the
  // guide, which you can reopen and search.
  const step = 0;
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);

  // On mount, fetch the first-run status + git defaults.
  useEffect(() => {
    let cancelled = false;
    (fetch('/api/settings/first-run-check').then((r) => r.json()) as Promise<FirstRunCheckResponse>)
      .then((check) => {
      if (cancelled) return;

      // Already completed — skip the wizard entirely.
      if (check.firstRunComplete) {
        onComplete();
        return;
      }

      // Pre-populate: prefer existing identity fields (they may have
      // been seeded by maybeSeedIdentityFromGit during an earlier
      // project scan), fall back to raw git defaults.
      setDisplayName(check.identity.displayName || check.gitDefaults.name || '');
      setEmail(check.identity.email || check.gitDefaults.email || '');
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [onComplete]);

  const saveIdentityAndAdvance = useCallback(async () => {
    setSaving(true);
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identity: {
            displayName: displayName.trim(),
            email: email.trim(),
          },
        }),
      });
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstRunComplete: true }),
      });
    } catch {
      // Swallow — identity save is best-effort. The user can fix it
      // later in Settings, and the flag is retried next launch.
    }
    setSaving(false);
    onComplete();
  }, [displayName, email, onComplete]);



  if (loading) return null; // Don't flash anything while checking.

  return createPortal(
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/90 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Set your name for attribution"
      onClick={(e) => { if (e.target === e.currentTarget) onComplete(); }}
    >
      <div className="relative w-full max-w-lg mx-4 rounded-2xl border border-white/[0.08] bg-[#101013] shadow-2xl">
        <div className="pt-7" />

        {step === 0 && (
          <div className="px-10 pt-2 pb-8">
            {/* Hero icon */}
            <div className="flex items-center justify-center w-14 h-14 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-accent/20 to-accent/5 border border-accent/30">
              <User size={26} className="text-accent" strokeWidth={1.5} />
            </div>

            <p className="text-center text-[11px] uppercase tracking-[0.18em] text-foreground-subtle font-medium mb-3">
              Welcome
            </p>

            <h2 className="text-center text-2xl font-semibold text-foreground tracking-tight mb-2 leading-tight">
              Who are you?
            </h2>

            <p className="text-center text-foreground-muted text-[13px] leading-relaxed max-w-sm mx-auto mb-8">
              <code className="text-foreground-muted">git config</code> has no name on this
              machine, so we cannot work it out. Used to attribute your plans and
              messages. Stored locally — never sent anywhere.
            </p>

            {/* Name */}
            <div className="mb-4">
              <label className="block text-[10px] uppercase tracking-wider text-foreground-subtle mb-1.5">
                Display name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                autoFocus
                className="w-full bg-white/[0.03] border border-white/[0.1] rounded-lg px-3 py-2 text-[13px] text-foreground placeholder:text-foreground-subtle/40 focus:outline-none focus:border-accent/40 transition-colors"
              />
            </div>

            {/* Email */}
            <div className="mb-6">
              <label className="block text-[10px] uppercase tracking-wider text-foreground-subtle mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveIdentityAndAdvance();
                }}
                placeholder="you@example.com"
                className="w-full bg-white/[0.03] border border-white/[0.1] rounded-lg px-3 py-2 text-[13px] font-mono text-foreground placeholder:text-foreground-subtle/40 focus:outline-none focus:border-accent/40 transition-colors"
              />
              <p className="text-[10px] text-foreground-subtle mt-1.5">
                Change it anytime in Settings.
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 px-10 py-4 border-t border-white/[0.06]">
          {/* Leaving without answering is a legitimate choice. Work gets
              attributed to whatever is set later, and nothing here is
              worth standing between someone and the product. */}
          <button
            onClick={onComplete}
            className="text-[12px] text-foreground-subtle hover:text-foreground transition-colors"
          >
            Skip for now
          </button>
          <button
            onClick={saveIdentityAndAdvance}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12px] font-medium bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 hover:border-accent/60 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
            <CheckCircle2 size={14} />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
