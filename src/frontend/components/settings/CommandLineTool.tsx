/**
 * The `codetrellis` command on the PATH, from the installed app, desktop only
 * (`cli-install.ts`). Says where it goes before adding it, and whether it is
 * there now; a `codetrellis` that is not the app's (say, from npm) is named
 * and replaced only when the person chooses to.
 */
import { useEffect, useState } from 'react';

type Api = NonNullable<NonNullable<Window['electronAPI']>['cli']>;
type Plan = Awaited<ReturnType<Api['plan']>>;
type Applied = Awaited<ReturnType<Api['install']>>;

export function CommandLineTool() {
  const api: Api | undefined = window.electronAPI?.cli;
  const [plan, setPlan] = useState<Plan | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (api) void api.plan().then(setPlan);
  }, [api]);
  if (!api || !plan) return null;

  const act = async (what: () => Promise<Applied>, done: (target: string, onPath: boolean) => string) => {
    setBusy(true);
    try {
      const r = await what();
      setMessage(r.ok ? { tone: 'ok', text: done(r.target, r.onPath) } : { tone: 'warn', text: r.reason });
      setPlan(await api.plan());
    } finally {
      setBusy(false);
    }
  };
  const added = (target: string, onPath: boolean) =>
    `Added. Open a new terminal and run codetrellis --help.${onPath ? '' : ` ${target.replace(/[\\/]codetrellis$/, '')} is not on your PATH yet: add it in your shell's profile.`}`;

  const button = 'px-2.5 py-1 rounded-md text-[11px] border disabled:opacity-50';
  return (
    <div className="space-y-2" data-testid="command-line-tool">
      <p className="text-[10.5px] text-foreground-muted leading-relaxed">
        The <code className="font-mono">codetrellis</code> command in any terminal, script or agent session, run by this app,
        so it needs no Node install and always matches this version. The same commands as{' '}
        <code className="font-mono">npm install -g codetrellis</code>.
      </p>
      {!plan.ok ? (
        <p className="text-[10.5px] text-foreground-subtle" data-testid="command-line-unavailable">{plan.reason}</p>
      ) : (
        <>
          <p className="text-[10.5px] text-foreground-muted" data-testid="command-line-state">
            {plan.state === 'installed' && <>Added: <code className="font-mono break-all">{plan.target}</code>.</>}
            {plan.state === 'missing' && plan.says}
            {plan.state === 'stale' && <>Your <code className="font-mono break-all">{plan.target}</code> points at another copy of CodeTrellis. Update it to run this one.</>}
            {plan.state === 'other' && <><code className="font-mono break-all">{plan.target}</code> is already {plan.existing}, perhaps from npm. Replace it to run this app&apos;s instead.</>}
          </p>
          <div className="flex gap-2">
            {plan.state !== 'installed' && (
              <button
                disabled={busy}
                onClick={() => void act(() => api.install(plan.state === 'other'), added)}
                className={`${button} border-accent/30 text-accent hover:bg-accent/10`}
              >
                {plan.state === 'missing' ? 'Add the codetrellis command' : plan.state === 'stale' ? 'Update it' : 'Replace it'}
              </button>
            )}
            {(plan.state === 'installed' || plan.state === 'stale') && (
              <button
                disabled={busy}
                onClick={() => void act(api.remove, () => 'Removed.')}
                className={`${button} border-white/[0.1] text-foreground-muted hover:bg-white/[0.04]`}
              >
                Remove
              </button>
            )}
          </div>
        </>
      )}
      {message && (
        <p className={`text-[10.5px] ${message.tone === 'ok' ? 'text-emerald-300/90' : 'text-amber-200/90'}`} data-testid="command-line-message">
          {message.text}
        </p>
      )}
    </div>
  );
}
