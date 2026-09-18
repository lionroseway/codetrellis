import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, ShieldCheck, X, FolderOpen, AlertCircle, ExternalLink } from 'lucide-react';

/**
 * Downloading an update through the verified path — Phase 29.
 *
 * See [docs/PHASE-29-SURFACING-WHAT-WE-COLLECT.md](../../../../docs/PHASE-29-SURFACING-WHAT-WE-COLLECT.md).
 *
 * ## This is a security control that shipped with no way to invoke it
 *
 * `update-download-service.ts` is **Phase 19, finding 23**. It fetches
 * the bytes itself, pins the host on *every* redirect hop, and verifies
 * the file against `SHA256SUMS` plus a detached Ed25519 signature whose
 * public key ships in the app — so GitHub is out of the trust chain. A
 * release without a valid signed manifest is refused outright rather
 * than falling back to the API's own digest, because a guarantee that
 * silently depends on which path the update check took is the kind of
 * difference nobody notices until it matters.
 *
 * All of that has been reachable at `/api/updates/download` since it was
 * written, and **nothing called it**. Settings offered a plain browser
 * link, so every user who has ever updated this app did so unverified,
 * while the app carried a complete verified path it never mentioned.
 *
 * That is why 4.11 stopped being the smallest item on the register.
 *
 * ## The browser link stays, and says what it is
 *
 * Not every situation supports the in-app path — a release published
 * without a signed manifest is refused by design, and that refusal must
 * not become a dead end. So the browser link remains as a secondary
 * action, labelled plainly as unverified rather than sitting there
 * looking equivalent.
 *
 * ## What "verified" is allowed to mean
 *
 * The service is careful about this and the UI must not inflate it:
 * verification proves **these are the bytes the release published**, not
 * that the bytes are trustworthy. It also does not install — on macOS a
 * DMG can only be revealed, and the user drags it. The copy says
 * "verified against the signed manifest", never "safe".
 */

type DownloadPhase = 'idle' | 'downloading' | 'verifying' | 'ready' | 'error';

interface UpdateDownloadState {
  phase: DownloadPhase;
  version: string | null;
  filename: string | null;
  bytesDownloaded: number;
  totalBytes: number | null;
  filePath: string | null;
  error: string | null;
}

const POLL_MS = 500;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

interface Props {
  /** The version on offer, so a stale state cannot be shown for another. */
  latestVersion: string;
  browserUrl: string;
  filename: string;
}

export function VerifiedUpdateDownload({ latestVersion, browserUrl, filename }: Props) {
  const [state, setState] = useState<UpdateDownloadState | null>(null);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/updates/download/status');
      if (!res.ok) return;
      const next = (await res.json()) as UpdateDownloadState;
      setState(next);
      if (next.phase === 'ready' || next.phase === 'error' || next.phase === 'idle') {
        stopPolling();
      }
    } catch {
      stopPolling();
    }
  }, [stopPolling]);

  // Read once on mount: a download may already be running from a
  // previous visit to this panel, and showing "Download" over the top of
  // it would start a second one.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/updates/download/status');
        if (!res.ok) return;
        const current = (await res.json()) as UpdateDownloadState;
        setState(current);
        if (current.phase === 'downloading' || current.phase === 'verifying') {
          pollRef.current = setInterval(poll, POLL_MS);
        }
      } catch { /* backend may still be booting */ }
    })();
    return stopPolling;
  }, [poll, stopPolling]);

  const start = async () => {
    setStarting(true);
    try {
      await fetch('/api/updates/download', { method: 'POST' });
      // The POST resolves when the download finishes, but polling from
      // the moment it starts is what makes progress visible.
      await poll();
    } finally {
      setStarting(false);
    }
    if (!pollRef.current) pollRef.current = setInterval(poll, POLL_MS);
  };

  const cancel = async () => {
    await fetch('/api/updates/download/cancel', { method: 'POST' }).catch(() => {});
    await poll();
  };

  const reveal = async () => {
    const api = (window as { electronAPI?: { revealUpdateDownload?: () => Promise<string | null> } }).electronAPI;
    if (api?.revealUpdateDownload) await api.revealUpdateDownload().catch(() => null);
  };

  // A state left over from a different release must not render as
  // progress for this one — the service records the version for exactly
  // this reason.
  const forThisVersion = state && state.version === latestVersion;
  const phase: DownloadPhase = forThisVersion ? state.phase : 'idle';
  const inFlight = phase === 'downloading' || phase === 'verifying';

  const pct =
    forThisVersion && state.totalBytes && state.totalBytes > 0
      ? Math.min(100, Math.round((state.bytesDownloaded / state.totalBytes) * 100))
      : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {phase === 'ready' ? (
          <button
            onClick={reveal}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium rounded-lg bg-green-500/15 border border-green-500/40 text-green-300 hover:bg-green-500/25 transition-colors"
          >
            <FolderOpen size={12} />
            Show in folder
          </button>
        ) : (
          <button
            onClick={start}
            disabled={starting || inFlight}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium rounded-lg bg-accent/20 border border-accent/50 text-accent hover:bg-accent/30 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Download size={12} />
            {inFlight ? 'Downloading…' : `Download ${filename}`}
          </button>
        )}

        {inFlight && (
          <button
            onClick={cancel}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] rounded-lg text-foreground-muted hover:text-foreground hover:bg-white/[0.04] transition-colors"
          >
            <X size={11} />
            Cancel
          </button>
        )}
      </div>

      {inFlight && (
        <div className="space-y-1">
          <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full bg-accent/70 transition-[width] duration-200"
              style={{ width: pct !== null ? `${pct}%` : '40%' }}
            />
          </div>
          <div className="text-[10.5px] text-foreground-subtle font-mono">
            {phase === 'verifying'
              ? 'Checking the signature…'
              : pct !== null
                ? `${pct}% · ${formatBytes(state!.bytesDownloaded)} of ${formatBytes(state!.totalBytes!)}`
                : formatBytes(state!.bytesDownloaded)}
          </div>
        </div>
      )}

      {phase === 'ready' && (
        <div className="flex items-start gap-1.5 text-[10.5px] text-green-300/80 leading-snug">
          <ShieldCheck size={12} className="shrink-0 mt-px" />
          {/* Precisely what the service proves, and no more. */}
          <span>
            Verified against the release's signed manifest — these are the
            bytes it published. CodeTrellis does not install updates; open
            the file to apply it.
          </span>
        </div>
      )}

      {phase === 'error' && (
        <div className="flex items-start gap-1.5 text-[10.5px] text-amber-300/90 leading-snug">
          <AlertCircle size={12} className="shrink-0 mt-px" />
          <span>
            {state?.error || 'The download could not be verified.'} You can
            still fetch it in your browser below.
          </span>
        </div>
      )}

      {/* Always available, and labelled for what it is. A release
          published without a signed manifest is refused above by design,
          and that refusal must not become a dead end. */}
      <a
        href={browserUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center gap-1 text-[10.5px] text-foreground-subtle hover:text-foreground-muted transition-colors"
      >
        Download in your browser instead (unverified)
        <ExternalLink size={10} />
      </a>
    </div>
  );
}
