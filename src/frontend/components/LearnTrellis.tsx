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
  Eye,
  ClipboardList,
  PenLine,
  GitBranch,
  Plug,
  Sparkles,
  Layers,
  Wrench,
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
    heading: 'A few ways people use CodeTrellis. Pick what fits.',
    body:
      "There's no one right way. Some people just want to watch the codebase change as they work. Others build out detailed plans and hand them off to AI. Most do both, depending on the day. We'll walk through eight common workflows — skip any that aren't relevant.",
    bullets: [
      "Everything's local — your code never leaves your machine, and the AI cost stays on your existing AI usage",
      'Works with or without an AI agent — Claude Code, Codex, Cursor, aider, anything that speaks MCP',
      'Dots above are clickable — jump to whichever step matters most',
    ],
    hint: 'About 4 minutes total. Skip whenever — come back via the Learn button in the TopBar.',
  },
  {
    Icon: Eye,
    eyebrow: 'Watching live',
    heading: "Just want to see what's changing? You don't need a plan.",
    body:
      "Click the + in the top-left of the TopBar to open any project on disk. Leave it open and code as normal — yours, an AI's, anyone's edits update the graph live as files change. This is the lightest way to use CodeTrellis.",
    bullets: [
      'New / modified / deleted files glow as they change',
      'Cross-system edges (e.g. a TS fetch ↔ a Python route) update automatically',
      'Click any node to drill in — file, symbol, or whole package',
    ],
    hint: "Live mode is the default. The next step shows the other three lenses.",
  },
  {
    Icon: Layers,
    eyebrow: 'The four modes',
    heading: 'Live / Baseline / Planned / Diff — when each one earns its keep.',
    body:
      'Four buttons in the TopBar swap your view of the same graph. Same nodes, different lens. You\'ll spend most of your agent-watching time in Diff.',
    bullets: [
      "Live — disk right now. Default. Just shows what's there.",
      'Baseline — a pinned snapshot (e.g. `git main`). What "before" looked like.',
      "Planned — what the active plan says SHOULD be there once it's done.",
      'Diff — Live vs Baseline (or vs Planned). Where the green/orange/red glow shows up.',
    ],
    hint: 'Open Diff mode when an agent is mid-flight to see drift in real time.',
  },
  {
    Icon: ClipboardList,
    eyebrow: 'Building a plan',
    heading: 'Plans give you more control. AI can help build them.',
    body:
      'Pick one of five templates (mass refactor, new feature, bug fix, library migration, perf pass) or start blank. The deeper your plan, the less drift you\'ll see when an agent runs it later.',
    bullets: [
      'Spec docs are markdown — paste in requirements, designs, ADRs, anything',
      'Phases give you scope, prereqs, acceptance criteria — first-class checkpoints',
      'Ask an AI to draft a plan: "Build me a plan to migrate X to Y" — it\'ll seed phases + tasks via MCP',
    ],
    hint: "You're always the editor — the AI proposes, you approve.",
  },
  {
    Icon: PenLine,
    eyebrow: 'Adjusting',
    heading: "Plans aren't set in stone. Edit anytime.",
    body:
      "Mid-flight you'll realise a phase is wrong, a task is missing, or scope crept. Edit from the plan panel directly, or ask the AI to revise based on what's been learned.",
    bullets: [
      'Drag tasks between phases, edit acceptance criteria, add docs as you learn',
      "Reject drift by editing the plan; accept it by adding the surprise file to a task",
      'Every change broadcasts to connected agents — they pick up the latest on the next tool call',
    ],
    hint: "If the AI sees the plan changed, it'll usually re-read before continuing. You don't have to remind it.",
  },
  {
    Icon: GitBranch,
    eyebrow: 'Sharing',
    heading: 'Plans live in your repo. Commit them like code.',
    body:
      'Click Export and the plan lands at `<project>/.codetrellis/plans/<slug>/` as YAML + markdown. Commit it. Pull on another device and CodeTrellis reads it back in automatically.',
    bullets: [
      'Auto-sync runs both directions — DB edits write to disk, file edits read back',
      'YAML conflict markers from a bad merge get a clear in-app banner',
      'Templates work the same way — share team templates via `<project>/.codetrellis/templates/`',
    ],
    hint: '`git diff` on the plans dir is a really nice PR review surface.',
  },
  {
    Icon: Plug,
    eyebrow: 'Pointing agents',
    heading: 'Tell agents which phase or task to take.',
    body:
      'Connect the agent over MCP — Model Context Protocol, the open standard agents use to call tools (same way Claude Code, Cursor, and Codex talk to anything else). Then in your prompt, name the area: "work the next task on the auth-refactor plan, phase 2" or "focus only on the API phase." The agent calls `get_next_task` and goes.',
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
    bullets: [
      'First time connecting? Open the prompt with: "Read `codetrellis://skill/quickstart` and confirm available tools." Saves a lot of trial.',
      'Different agents can own different phases (Claude does the refactor, Codex does the tests)',
      "Tasks auto-claim — two agents won't pick up the same one",
      'Every tool call shows up in the timeline attributed to the right agent',
    ],
    hint: 'Click the MCP pill in the TopBar to copy this snippet straight to clipboard.',
  },
  {
    Icon: Wrench,
    eyebrow: 'The agent toolbox',
    heading: 'What the agent can actually do — and how to write good prompts.',
    body:
      'The MCP server exposes 30+ tools the agent can call. Knowing what\'s available means you can ask for it directly ("get the drift report") instead of guessing. There are also skill resources that let an agent self-onboard — point a fresh agent at one and it learns the patterns automatically.',
    bullets: [
      'Browse the codebase: `search_symbols`, `get_dependencies`, `check_architecture`, `list_cross_system_edges`',
      'Plans + tasks: `list_plans`, `get_plan`, `claim_task`, `update_task`, `get_next_task`',
      'Drift + verification: `get_drift_report`, `list_proposed_changes`',
      'Skill resources for the agent to read: `codetrellis://skill` (overview), `…/quickstart` (first time), `…/power-user` (deep usage)',
    ],
    hint: 'Try this prompt: "Read `codetrellis://skill/quickstart`, then summarise the active plan and propose what to work on next."',
  },
  {
    Icon: Sparkles,
    eyebrow: 'Refreshing context',
    heading: 'Agent context full? Just have it re-read the plan.',
    body:
      "When an agent's context fills, you switch machines, or you pause and resume — clear the chat and tell the agent: \"read the active plan.\" It pulls everything (overview, phase docs, current tasks, drift status) via MCP.",
    bullets: [
      'Tools the agent calls: `list_plans`, `get_plan`, `list_plan_documents`, `get_drift_report`',
      'Skill resources walk it through: `codetrellis://skill/quickstart`',
      'Multi-device: just `git pull` and the agent on the new machine re-reads from disk',
    ],
    hint: 'If the agent loses track mid-task, ask it to call `get_drift_report` for an instant catch-up.',
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
          {STEPS.map((s, i) => (
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
              title={`${i + 1}. ${s.eyebrow}`}
              aria-label={`Step ${i + 1}: ${s.eyebrow}`}
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
