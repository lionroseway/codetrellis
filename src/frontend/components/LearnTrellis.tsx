/**
 * Learn Trellis — first-run onboarding takeover.
 *
 * Six short steps that get a developer from "what is this?" to
 * "ready to open my own project" in under five minutes. Skippable
 * at every step; closes on Esc or backdrop click.
 *
 * Auto-shows once when the app launches with no projects opened
 * (`localStorage` flag `codetrellis:learn-trellis:seen`). After
 * that, the user can re-open it from the TopBar's `Learn` button
 * (or by clearing the flag in DevTools).
 *
 * Intentionally information-only for v1 — no UI element spotlighting
 * or interactive demos. Each step is a clean, focused screen with
 * a heading, body, and at most one CTA. The structure makes it
 * easy to layer spotlight/tour mechanics later without rewiring.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  ArrowRight,
  ArrowLeft,
  GraduationCap,
  Network,
  ClipboardList,
  Plug,
  Eye,
  CheckCircle2,
  Copy,
} from 'lucide-react';
import { useUiStore } from '../stores/ui-store';

export const LEARN_TRELLIS_SEEN_KEY = 'codetrellis:learn-trellis:seen';

interface Step {
  /** Lucide icon component for the hero block. */
  Icon: typeof GraduationCap;
  /** Caption above the heading — sets context. */
  eyebrow: string;
  heading: string;
  /** One short paragraph. Markdown-free; line breaks via blank lines. */
  body: string;
  /** Optional bullets under the body. */
  bullets?: string[];
  /** Optional code snippet rendered in a copyable mono box. */
  snippet?: { language: string; content: string };
  /** Optional bottom-row hint. */
  hint?: string;
}

const STEPS: Step[] = [
  {
    Icon: GraduationCap,
    eyebrow: 'Welcome',
    heading: 'Plan, watch, and keep AI agents on track.',
    body:
      'CodeTrellis sits next to your AI coding agent (Claude Code, Codex, Cursor, aider — any MCP client) and gives you a live picture of what it\'s doing to your codebase. Or use it solo to plan your own work.',
    bullets: [
      'See your codebase as a graph — packages, files, symbols, cross-system links.',
      'Author plans the agent can read via MCP.',
      'Watch drift the moment a file lands outside the plan.',
    ],
    hint: 'Takes about 2 minutes. You can skip any time.',
  },
  {
    Icon: Network,
    eyebrow: 'Step 1 of 5',
    heading: 'Open a project to see your architecture.',
    body:
      'Click the + in the top-left to open any folder on disk. CodeTrellis walks the tree, parses every source file (TS, JS, Python, Rust, PHP, Java), and renders a dependency graph with three depth levels.',
    bullets: [
      'Cmd+1 — Clusters (high-level packages)',
      'Cmd+2 — Files (one node per file, with import edges)',
      'Cmd+3 — Symbols (functions, classes, methods)',
    ],
    hint: 'Cross-system edges appear as dashed lines (e.g. a TS fetch() to a Python FastAPI route).',
  },
  {
    Icon: ClipboardList,
    eyebrow: 'Step 2 of 5',
    heading: 'Author a plan — alone or together with the agent.',
    body:
      'Plans live next to the graph. Pick one of five built-in templates (mass refactor, new feature, bug fix, library migration, perf pass) or start from scratch. Plans scale from a one-line "do this thing" to multi-phase migrations with spec docs.',
    bullets: [
      'Phases are first-class checkpoints with scope, prereqs, acceptance criteria.',
      'Spec docs live in a markdown spec room — agents read them as architectural intent.',
      'Plans round-trip to disk as YAML so they can be committed and shared.',
    ],
  },
  {
    Icon: Plug,
    eyebrow: 'Step 3 of 5',
    heading: 'Connect your AI agent over MCP.',
    body:
      'CodeTrellis runs a local MCP server. Any MCP-capable agent can read the plan, query architecture, and report what it\'s doing — all on your own machine, no data sent anywhere. Add this to the agent\'s MCP config:',
    snippet: {
      language: 'json',
      content: JSON.stringify(
        {
          codetrellis: {
            type: 'sse',
            url: 'http://127.0.0.1:19432/sse',
          },
        },
        null,
        2,
      ),
    },
    hint: 'Or click the "MCP :19432" pill in the TopBar to copy the snippet straight to your clipboard.',
  },
  {
    Icon: Eye,
    eyebrow: 'Step 4 of 5',
    heading: 'Watch the agent work in real time.',
    body:
      'When the agent starts editing, CodeTrellis shows you what\'s happening at three levels: the timeline (every tool call attributed to the right agent), the graph (files glow as they change, blast radius highlighted), and the plan (tasks auto-advance to in_progress when the agent edits an affectedFile).',
    bullets: [
      'Timeline shows every MCP tool call, not just file edits.',
      'Drift surfaces when the agent touches files outside the plan.',
      'The Verification panel reads "Ready to ship" when every change is satisfied.',
    ],
    hint: 'You stay in control — at any point you can pause, redirect, or run a different agent.',
  },
  {
    Icon: CheckCircle2,
    eyebrow: 'You\'re set up',
    heading: 'Open your first project and try it.',
    body:
      'Pick the smallest project you have so the graph isn\'t overwhelming on the first scan. The Getting Started checklist in the corner of the canvas walks you through the rest — open a project, connect an agent, build your first plan.',
    bullets: [
      'Need to come back here? Click "Learn" in the TopBar.',
      'Found something confusing? Open an issue on the public releases repo.',
    ],
    hint: 'No data leaves your machine. AI compute lives in your agent.',
  },
];

/**
 * Open + close are driven by `ui-store.learnTrellisOpen` so any
 * surface (TopBar trigger button, command palette, Settings →
 * About link) can open / re-open this without prop-drilling.
 *
 * First-launch auto-open is the App.tsx's responsibility — see the
 * `useEffect` that consults the seen-flag + tabs.length on mount.
 */
export function LearnTrellis() {
  const open = useUiStore((s) => s.learnTrellisOpen);
  const setOpen = useUiStore((s) => s.setLearnTrellisOpen);

  const [stepIndex, setStepIndex] = useState(0);

  const close = useCallback(() => {
    localStorage.setItem(LEARN_TRELLIS_SEEN_KEY, '1');
    setOpen(false);
    setStepIndex(0);
  }, [setOpen]);

  // Reset to step 0 every time the takeover opens — re-launching
  // from "Learn" should always start at the top, not where the
  // user left off last time.
  useEffect(() => {
    if (open) setStepIndex(0);
  }, [open]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'ArrowRight') {
        setStepIndex((i) => Math.min(STEPS.length - 1, i + 1));
      } else if (e.key === 'ArrowLeft') {
        setStepIndex((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const isLast = stepIndex === STEPS.length - 1;
  const step = STEPS[stepIndex];

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={(e) => {
        // Backdrop click closes; clicks inside the card don't.
        if (e.target === e.currentTarget) close();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Learn CodeTrellis"
    >
      <div className="relative w-full max-w-2xl mx-4 rounded-2xl border border-white/[0.08] bg-[#101013] shadow-2xl">
        {/* Skip button */}
        <button
          onClick={close}
          className="absolute top-4 right-4 inline-flex items-center gap-1 px-2 py-1 rounded-md text-foreground-subtle hover:text-foreground hover:bg-white/[0.04] text-[11px] transition-colors"
          aria-label="Skip onboarding"
        >
          <X size={12} />
          Skip
        </button>

        {/* Step indicator */}
        <div className="flex justify-center pt-7 pb-4 gap-1.5">
          {STEPS.map((_, i) => (
            <button
              key={i}
              onClick={() => setStepIndex(i)}
              className={`h-1.5 rounded-full transition-all ${
                i === stepIndex
                  ? 'w-8 bg-accent'
                  : i < stepIndex
                  ? 'w-2 bg-accent/50'
                  : 'w-2 bg-white/10'
              }`}
              aria-label={`Go to step ${i + 1}`}
            />
          ))}
        </div>

        {/* Hero */}
        <div className="px-10 pt-2 pb-8">
          <div className="flex items-center justify-center w-14 h-14 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-accent/20 to-accent/5 border border-accent/30">
            <step.Icon size={26} className="text-accent" strokeWidth={1.5} />
          </div>

          <p className="text-center text-[11px] uppercase tracking-[0.18em] text-foreground-subtle font-medium mb-3">
            {step.eyebrow}
          </p>

          <h2 className="text-center text-2xl md:text-3xl font-semibold text-foreground tracking-tight mb-4 leading-tight">
            {step.heading}
          </h2>

          <p className="text-center text-foreground-muted text-[14px] leading-relaxed max-w-lg mx-auto mb-6">
            {step.body}
          </p>

          {step.bullets && step.bullets.length > 0 && (
            <ul className="space-y-2 max-w-md mx-auto mb-6">
              {step.bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2.5 text-[13px] text-foreground-muted leading-relaxed">
                  <span className="mt-1.5 w-1 h-1 shrink-0 rounded-full bg-accent" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}

          {step.snippet && <CodeSnippet content={step.snippet.content} language={step.snippet.language} />}

          {step.hint && (
            <p className="text-center text-foreground-subtle text-[11px] mt-6 italic">
              {step.hint}
            </p>
          )}
        </div>

        {/* Footer / nav */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-white/[0.06]">
          <button
            onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
            disabled={stepIndex === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-foreground-muted hover:text-foreground hover:bg-white/[0.04] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ArrowLeft size={14} />
            Back
          </button>

          <span className="text-[11px] text-foreground-subtle font-mono">
            {stepIndex + 1} / {STEPS.length}
          </span>

          {isLast ? (
            <button
              onClick={close}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12px] font-medium bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 hover:border-accent/60 transition-colors"
            >
              Done
              <CheckCircle2 size={14} />
            </button>
          ) : (
            <button
              onClick={() => setStepIndex((i) => Math.min(STEPS.length - 1, i + 1))}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12px] font-medium bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 hover:border-accent/60 transition-colors"
            >
              Next
              <ArrowRight size={14} />
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CodeSnippet({ content }: { content: string; language: string }) {
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => content.split('\n'), [content]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — read-only browsers / locked-down sandboxes
    }
  };

  return (
    <div className="relative max-w-md mx-auto rounded-lg border border-white/[0.06] bg-black/30 overflow-hidden">
      <button
        onClick={onCopy}
        className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] text-foreground-subtle hover:text-foreground hover:bg-white/[0.04] transition-colors"
        aria-label="Copy snippet"
      >
        <Copy size={11} />
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre className="px-4 py-3 text-[12px] font-mono leading-relaxed text-foreground/80 overflow-x-auto">
        {lines.map((line, i) => (
          <div key={i}>{line || ' '}</div>
        ))}
      </pre>
    </div>
  );
}
