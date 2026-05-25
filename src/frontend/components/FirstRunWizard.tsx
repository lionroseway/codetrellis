/**
 * First-run onboarding wizard — Phase 5.1.
 *
 * Shows on the very first launch (when `settings.firstRunComplete` is
 * false). Two steps:
 *
 *   1. **Identity** — confirm display name + email (pre-populated from
 *      `git config`). Explains that attribution is local-only.
 *   2. **Ready** — shows the MCP config snippet and a "Open a project"
 *      CTA so the user can jump straight into the app.
 *
 * Unlike LearnTrellis (which uses localStorage and is dismissible via
 * backdrop click), this wizard is *blocking* — it persists
 * `firstRunComplete: true` to `~/.codetrellis/settings.json` via
 * `PUT /api/settings` on completion, so it survives across machines
 * when personal sync is added in Phase 5.3.
 *
 * The wizard fetches `/api/settings/first-run-check` on mount to get
 * the current identity + git defaults. If the backend already has
 * `firstRunComplete: true` (e.g. from a previous session or imported
 * settings), it bails immediately.
 */

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowRight,
  CheckCircle2,
  Copy,
  Sparkles,
  User,
} from 'lucide-react';

interface FirstRunCheckResponse {
  firstRunComplete: boolean;
  identity: { displayName: string; email: string };
  gitDefaults: { name: string; email: string };
}

export function FirstRunWizard({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [mcpConfig, setMcpConfig] = useState<Record<string, unknown> | null>(null);
  const [copied, setCopied] = useState(false);

  // On mount, fetch the first-run status + git defaults.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/settings/first-run-check').then((r) => r.json()) as Promise<FirstRunCheckResponse>,
      fetch('/api/mcp/config').then((r) => r.json()).catch(() => null),
    ]).then(([check, mcp]) => {
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
      if (mcp) setMcpConfig(mcp);
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
    } catch {
      // Swallow — identity save is best-effort. The user can fix it
      // later in Settings.
    }
    setSaving(false);
    setStep(1);
  }, [displayName, email]);

  const finish = useCallback(async () => {
    setSaving(true);
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstRunComplete: true }),
      });
    } catch {
      // Swallow — the flag will be tried again next launch.
    }
    setSaving(false);
    onComplete();
  }, [onComplete]);

  const copyMcpConfig = useCallback(() => {
    if (!mcpConfig) return;
    navigator.clipboard.writeText(JSON.stringify(mcpConfig, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [mcpConfig]);

  if (loading) return null; // Don't flash anything while checking.

  return createPortal(
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/90 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to CodeTrellis"
    >
      <div className="relative w-full max-w-lg mx-4 rounded-2xl border border-white/[0.08] bg-[#101013] shadow-2xl">
        {/* Step indicator */}
        <div className="flex justify-center pt-7 pb-4 gap-2">
          {[0, 1].map((i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step
                  ? 'w-8 bg-accent'
                  : i < step
                  ? 'w-3 bg-accent/50'
                  : 'w-3 bg-white/10'
              }`}
            />
          ))}
        </div>

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
              Used to attribute your plans, tasks, and channel events.
              Stored locally — never sent anywhere.
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
                Pre-filled from <code className="font-mono bg-white/[0.05] px-1 rounded">git config</code>.
                Change it anytime in Settings.
              </p>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="px-10 pt-2 pb-8">
            {/* Hero icon */}
            <div className="flex items-center justify-center w-14 h-14 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-accent/20 to-accent/5 border border-accent/30">
              <Sparkles size={26} className="text-accent" strokeWidth={1.5} />
            </div>

            <p className="text-center text-[11px] uppercase tracking-[0.18em] text-foreground-subtle font-medium mb-3">
              You're set
            </p>

            <h2 className="text-center text-2xl font-semibold text-foreground tracking-tight mb-2 leading-tight">
              Open a project to start
            </h2>

            <p className="text-center text-foreground-muted text-[13px] leading-relaxed max-w-sm mx-auto mb-8">
              Click <strong className="text-foreground">+</strong> in the top-left to scan
              any folder. If you use an AI agent, drop this into its MCP config:
            </p>

            {/* MCP config snippet */}
            {mcpConfig && (
              <div className="relative max-w-sm mx-auto rounded-lg border border-white/[0.06] bg-black/30 overflow-hidden mb-6">
                <button
                  onClick={copyMcpConfig}
                  className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] text-foreground-subtle hover:text-foreground hover:bg-white/[0.04] transition-colors"
                  aria-label="Copy MCP config"
                >
                  <Copy size={11} />
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <pre className="px-4 py-3 text-[11px] font-mono leading-relaxed text-foreground/80 overflow-x-auto">
                  {JSON.stringify(mcpConfig, null, 2)}
                </pre>
              </div>
            )}

            <ul className="space-y-2 max-w-sm mx-auto mb-2">
              <li className="flex items-start gap-2.5 text-[12px] text-foreground-muted leading-relaxed">
                <span className="mt-1.5 w-1 h-1 shrink-0 rounded-full bg-accent" />
                Works with or without an AI agent — just watch, or build plans
              </li>
              <li className="flex items-start gap-2.5 text-[12px] text-foreground-muted leading-relaxed">
                <span className="mt-1.5 w-1 h-1 shrink-0 rounded-full bg-accent" />
                Everything stays local. No telemetry, no cloud
              </li>
            </ul>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-white/[0.06]">
          {step === 0 ? (
            <>
              <span className="text-[11px] text-foreground-subtle font-mono">
                1 / 2
              </span>
              <button
                onClick={saveIdentityAndAdvance}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12px] font-medium bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 hover:border-accent/60 transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Next'}
                <ArrowRight size={14} />
              </button>
            </>
          ) : (
            <>
              <span className="text-[11px] text-foreground-subtle font-mono">
                2 / 2
              </span>
              <button
                onClick={finish}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12px] font-medium bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 hover:border-accent/60 transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Get started'}
                <CheckCircle2 size={14} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
