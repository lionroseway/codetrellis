/**
 * CDev Phase 1.4 — Channel panel (MVP).
 *
 * Per-plan peer-to-peer event log. Both humans (the local user, posting
 * via this panel) and agents (via MCP) can post events; both can
 * respond. Six event types in scope long-term; this MVP surfaces the
 * three highest-value ones — `stuck`, `steer`, `weigh-in` — and renders
 * the rest read-only when they arrive from MCP.
 *
 * State lives in channels-store; live updates from the WS hook.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  MessageCircle, AlertTriangle, ArrowRight, Lightbulb,
  HelpCircle, ArrowRightLeft, CheckCheck, X, Reply, RefreshCw,
  Link as LinkIcon,
} from 'lucide-react';
import { useChannelsStore } from '../../../stores/channels-store';
import { usePlanItemsStore } from '../../../stores/plan-items-store';
import type { ChannelEvent, ChannelEventStatus, ChannelEventType } from '@shared/types';

// All six types are now composable from the UI (Phase 2.1).
const ASK_TYPES: ChannelEventType[] = ['stuck', 'need-decision', 'need-context'];
const OFFER_TYPES: ChannelEventType[] = ['steer', 'weigh-in', 'handing-off'];

const EVENT_META: Record<ChannelEventType, {
  Icon: typeof AlertTriangle;
  tint: string;
  border: string;
  label: string;
  helper: string;
}> = {
  'stuck': {
    Icon: AlertTriangle, tint: 'text-amber-300', border: 'border-l-amber-400/60',
    label: 'Stuck', helper: 'Failing repeatedly; need help.',
  },
  'need-decision': {
    Icon: HelpCircle, tint: 'text-violet-300', border: 'border-l-violet-400/60',
    label: 'Decision', helper: 'Choice that can\'t be made alone.',
  },
  'need-context': {
    Icon: MessageCircle, tint: 'text-sky-300', border: 'border-l-sky-400/60',
    label: 'Context', helper: 'Missing knowledge to proceed.',
  },
  'handing-off': {
    Icon: ArrowRightLeft, tint: 'text-cyan-300', border: 'border-l-cyan-400/60',
    label: 'Handoff', helper: 'Another actor should take over.',
  },
  'steer': {
    Icon: ArrowRight, tint: 'text-emerald-300', border: 'border-l-emerald-400/60',
    label: 'Steer', helper: 'Direction in response to a stuck or decision.',
  },
  'weigh-in': {
    Icon: Lightbulb, tint: 'text-fuchsia-300', border: 'border-l-fuchsia-400/60',
    label: 'Weigh-in', helper: 'Thinking aloud — what do others see?',
  },
};

const STATUS_META: Record<ChannelEventStatus, { label: string; tint: string }> = {
  open: { label: 'Open', tint: 'text-amber-300' },
  resolved: { label: 'Resolved', tint: 'text-emerald-300' },
  dismissed: { label: 'Dismissed', tint: 'text-foreground-subtle' },
};

export function ChannelPanel({ planUid }: { planUid: string }) {
  const hydrate = useChannelsStore((s) => s.hydrate);
  const loading = useChannelsStore((s) => s.loading);
  const orderedUids = useChannelsStore((s) => s.orderedUids);
  const eventsByUid = useChannelsStore((s) => s.eventsByUid);
  const toggleDrawer = useChannelsStore((s) => s.toggleDrawer);
  const drawerOpen = useChannelsStore((s) => s.drawerOpen);

  useEffect(() => {
    hydrate(planUid).catch(() => {});
  }, [planUid, hydrate]);

  // Thread structure: roots are events with respondsTo == null;
  // each root has chronologically-ordered descendants.
  const threads = useMemo(() => {
    const roots: ChannelEvent[] = [];
    const childrenByParent: Record<string, ChannelEvent[]> = {};
    for (const uid of orderedUids) {
      const ev = eventsByUid[uid];
      if (!ev) continue;
      if (ev.respondsTo) {
        (childrenByParent[ev.respondsTo] ??= []).push(ev);
      } else {
        roots.push(ev);
      }
    }
    // Newest threads first based on the most recent activity in each thread.
    return roots
      .map((root) => ({
        root,
        descendants: collectDescendants(root.uid, childrenByParent),
      }))
      .sort((a, b) => {
        const aLatest = Math.max(a.root.createdAt, ...a.descendants.map((d) => d.createdAt));
        const bLatest = Math.max(b.root.createdAt, ...b.descendants.map((d) => d.createdAt));
        return bLatest - aLatest;
      });
  }, [orderedUids, eventsByUid]);

  if (!drawerOpen) {
    return (
      <div className="h-full w-8 border-l border-white/[0.06] bg-[#080915] flex flex-col items-center py-3">
        <button
          onClick={toggleDrawer}
          className="p-1.5 rounded hover:bg-white/[0.05] text-foreground-subtle hover:text-foreground"
          title="Open channel"
        >
          <MessageCircle size={13} />
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col border-l border-white/[0.06] bg-[#080915] min-w-0">
      <Header
        loading={loading}
        onRefresh={() => hydrate(planUid).catch(() => {})}
        onClose={toggleDrawer}
        eventCount={orderedUids.length}
      />
      <Composer />
      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        {threads.length === 0 && !loading && (
          <div className="text-[12px] text-foreground-subtle px-2 py-4">
            Channels are empty. Post a stuck / steer / weigh-in below to start the conversation, or wait for an agent to post.
          </div>
        )}
        {threads.map(({ root, descendants }) => (
          <ThreadCard key={root.uid} root={root} descendants={descendants} />
        ))}
      </div>
    </div>
  );
}

function Header({ loading, onRefresh, onClose, eventCount }: {
  loading: boolean;
  onRefresh: () => void;
  onClose: () => void;
  eventCount: number;
}) {
  return (
    <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/[0.06]">
      <MessageCircle size={13} className="text-accent" />
      <span className="text-[12px] font-medium text-foreground">Channel</span>
      {eventCount > 0 && (
        <span className="text-[10.5px] opacity-60 text-foreground-subtle">({eventCount})</span>
      )}
      <div className="flex-1" />
      <button
        onClick={onRefresh}
        className={`p-1 rounded hover:bg-white/[0.05] text-foreground-subtle hover:text-foreground ${loading ? 'animate-spin' : ''}`}
        title="Refresh"
      >
        <RefreshCw size={11} />
      </button>
      <button
        onClick={onClose}
        className="p-1 rounded hover:bg-white/[0.05] text-foreground-subtle hover:text-foreground"
        title="Close"
      >
        <X size={11} />
      </button>
    </div>
  );
}

function Composer() {
  const post = useChannelsStore((s) => s.post);
  const posting = useChannelsStore((s) => s.posting);
  const itemsByUid = usePlanItemsStore((s) => s.itemsByUid);
  const [type, setType] = useState<ChannelEventType>('weigh-in');
  const [message, setMessage] = useState('');
  const [attemptedText, setAttemptedText] = useState('');
  const [optionsText, setOptionsText] = useState('');
  const [anchorUid, setAnchorUid] = useState<string>('');

  const canSubmit = message.trim().length > 0 && !posting;

  const showAttempted = type === 'stuck' || type === 'handing-off';
  const showOptions = type === 'need-decision';

  const items = useMemo(
    () => Object.values(itemsByUid).sort((a, b) => a.sortOrder - b.sortOrder),
    [itemsByUid],
  );

  const submit = async () => {
    if (!canSubmit) return;
    const attempted = showAttempted
      ? attemptedText.split('\n').map((l) => l.trim()).filter(Boolean)
      : undefined;
    const options = showOptions
      ? optionsText.split('\n').map((l) => l.trim()).filter(Boolean)
      : undefined;
    const created = await post({
      eventType: type,
      message: message.trim(),
      attempted,
      options,
      itemUid: anchorUid || null,
    });
    if (created) {
      setMessage('');
      setAttemptedText('');
      setOptionsText('');
      // Keep type + anchor — common to post several events of the same shape.
    }
  };

  return (
    <div className="px-2 py-2 border-b border-white/[0.06] bg-[#0a0b14]/40">
      <div className="flex flex-col gap-1 mb-1.5">
        <TabRow types={ASK_TYPES} active={type} onSelect={setType} label="Ask" />
        <TabRow types={OFFER_TYPES} active={type} onSelect={setType} label="Offer" />
      </div>
      {items.length > 0 && (
        <div className="flex items-center gap-1.5 mb-1.5">
          <LinkIcon size={10} className="text-foreground-subtle" />
          <select
            value={anchorUid}
            onChange={(e) => setAnchorUid(e.target.value)}
            className="flex-1 bg-[#070810] border border-white/[0.06] rounded px-1.5 py-1 text-[11px] text-foreground focus:border-accent/40 focus:outline-none"
            title="Optional — anchor this event to a plan item"
          >
            <option value="">No anchor</option>
            {items.map((it) => (
              <option key={it.uid} value={it.uid}>
                {it.kind === 'action' ? '⚙' : '◆'} {it.title || '(untitled)'}
              </option>
            ))}
          </select>
        </div>
      )}
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={EVENT_META[type].helper}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        rows={3}
        className="w-full bg-[#070810] border border-white/[0.06] rounded px-2 py-1.5 text-[12px] text-foreground placeholder:text-foreground-subtle focus:border-accent/40 focus:outline-none resize-none"
      />
      {showAttempted && (
        <textarea
          value={attemptedText}
          onChange={(e) => setAttemptedText(e.target.value)}
          placeholder={'What was tried (one per line)\nparse as utf-8\nparse as latin-1'}
          rows={2}
          className="mt-1 w-full bg-[#070810] border border-white/[0.06] rounded px-2 py-1.5 text-[11.5px] text-foreground placeholder:text-foreground-subtle focus:border-accent/40 focus:outline-none resize-none"
        />
      )}
      {showOptions && (
        <textarea
          value={optionsText}
          onChange={(e) => setOptionsText(e.target.value)}
          placeholder={'Alternatives (one per line)\nUse FastAPI\nUse Flask\nStay with raw asgi'}
          rows={2}
          className="mt-1 w-full bg-[#070810] border border-white/[0.06] rounded px-2 py-1.5 text-[11.5px] text-foreground placeholder:text-foreground-subtle focus:border-accent/40 focus:outline-none resize-none"
        />
      )}
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[10.5px] text-foreground-subtle">⌘+Enter to post</span>
        <button
          onClick={submit}
          disabled={!canSubmit}
          className={`px-2.5 py-1 text-[11px] rounded transition-colors ${
            canSubmit
              ? 'bg-accent/20 text-accent hover:bg-accent/30 border border-accent/30'
              : 'bg-white/[0.03] text-foreground-subtle border border-white/[0.04] cursor-not-allowed'
          }`}
        >
          {posting ? 'Posting…' : 'Post'}
        </button>
      </div>
    </div>
  );
}

function TabRow({
  types, active, onSelect, label,
}: {
  types: ChannelEventType[];
  active: ChannelEventType;
  onSelect: (t: ChannelEventType) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[9px] uppercase tracking-wider text-foreground-subtle/70 w-8 shrink-0">{label}</span>
      {types.map((t) => {
        const meta = EVENT_META[t];
        const Icon = meta.Icon;
        const isActive = active === t;
        return (
          <button
            key={t}
            onClick={() => onSelect(t)}
            title={meta.helper}
            className={`flex items-center gap-1 px-1.5 py-0.5 text-[11px] rounded transition-colors ${
              isActive
                ? 'bg-white/[0.08] text-foreground font-medium'
                : 'text-foreground-subtle hover:text-foreground hover:bg-white/[0.04]'
            }`}
          >
            <Icon size={11} className={isActive ? meta.tint : ''} />
            {meta.label}
          </button>
        );
      })}
    </div>
  );
}

function ThreadCard({ root, descendants }: { root: ChannelEvent; descendants: ChannelEvent[] }) {
  return (
    <div className="space-y-1">
      <EventCard event={root} isRoot />
      {descendants.length > 0 && (
        <div className="ml-3 pl-2 border-l border-white/[0.06] space-y-1">
          {descendants.map((d) => (
            <EventCard key={d.uid} event={d} isRoot={false} />
          ))}
        </div>
      )}
      {root.status === 'open' && <ReplyShortcut rootUid={root.uid} />}
    </div>
  );
}

function EventCard({ event, isRoot }: { event: ChannelEvent; isRoot: boolean }) {
  const setStatus = useChannelsStore((s) => s.setStatus);
  const meta = EVENT_META[event.eventType] ?? EVENT_META['weigh-in'];
  const Icon = meta.Icon;
  const statusMeta = STATUS_META[event.status];

  return (
    <div className={`rounded border border-white/[0.06] border-l-2 ${meta.border} bg-[#06070d] px-2 py-1.5`}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={11} className={meta.tint} />
        <span className={`text-[10.5px] uppercase tracking-wide font-medium ${meta.tint}`}>
          {meta.label}
        </span>
        <span className="text-[10.5px] text-foreground-subtle">·</span>
        <span className="text-[10.5px] text-foreground-subtle truncate min-w-0">
          {renderAuthor(event)}
        </span>
        <div className="flex-1" />
        {isRoot && (
          <span className={`text-[10px] ${statusMeta.tint}`}>{statusMeta.label}</span>
        )}
        {isRoot && event.status === 'open' && (
          <>
            <button
              onClick={() => setStatus(event.uid, 'resolved').catch(() => {})}
              className="p-0.5 rounded hover:bg-white/[0.05] text-emerald-300/70 hover:text-emerald-300"
              title="Mark resolved"
            >
              <CheckCheck size={10} />
            </button>
            <button
              onClick={() => setStatus(event.uid, 'dismissed').catch(() => {})}
              className="p-0.5 rounded hover:bg-white/[0.05] text-foreground-subtle hover:text-foreground"
              title="Dismiss"
            >
              <X size={10} />
            </button>
          </>
        )}
      </div>
      <div className="text-[12.5px] text-foreground whitespace-pre-wrap">{event.payload.message}</div>
      {Array.isArray(event.payload.attempted) && event.payload.attempted.length > 0 && (
        <ul className="mt-1 ml-2 text-[11px] text-foreground-subtle list-disc list-inside space-y-0.5">
          {event.payload.attempted.map((line, i) => (<li key={i}>{line}</li>))}
        </ul>
      )}
      {Array.isArray(event.payload.options) && event.payload.options.length > 0 && (
        <ul className="mt-1 ml-2 text-[11px] text-foreground-subtle list-decimal list-inside space-y-0.5">
          {event.payload.options.map((line, i) => (<li key={i}>{line}</li>))}
        </ul>
      )}
      <div className="text-[10px] text-foreground-subtle mt-1">{formatTimestamp(event.createdAt)}</div>
    </div>
  );
}

function ReplyShortcut({ rootUid }: { rootUid: string }) {
  const post = useChannelsStore((s) => s.post);
  const posting = useChannelsStore((s) => s.posting);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="ml-3 text-[10.5px] text-foreground-subtle hover:text-foreground flex items-center gap-1"
      >
        <Reply size={10} />
        Reply
      </button>
    );
  }

  const submit = async () => {
    if (!text.trim()) return;
    const created = await post({
      eventType: 'steer',
      message: text.trim(),
      respondsTo: rootUid,
    });
    if (created) {
      setText('');
      setOpen(false);
    }
  };

  return (
    <div className="ml-3 mt-1 flex gap-1">
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); submit(); }
          if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
        }}
        placeholder="Reply with a steer…"
        autoFocus
        className="flex-1 bg-[#070810] border border-white/[0.06] rounded px-2 py-1 text-[11.5px] text-foreground placeholder:text-foreground-subtle focus:border-accent/40 focus:outline-none"
      />
      <button
        onClick={submit}
        disabled={!text.trim() || posting}
        className="px-2 py-0.5 text-[10.5px] rounded bg-accent/20 text-accent border border-accent/30 disabled:opacity-40"
      >
        Post
      </button>
      <button
        onClick={() => setOpen(false)}
        className="px-1.5 py-0.5 text-[10.5px] rounded text-foreground-subtle hover:bg-white/[0.05]"
      >
        Cancel
      </button>
    </div>
  );
}

// --- helpers ---

function collectDescendants(rootUid: string, childrenByParent: Record<string, ChannelEvent[]>): ChannelEvent[] {
  const out: ChannelEvent[] = [];
  const stack = [...(childrenByParent[rootUid] ?? [])];
  while (stack.length > 0) {
    const ev = stack.shift()!;
    out.push(ev);
    const grandchildren = childrenByParent[ev.uid];
    if (grandchildren) stack.push(...grandchildren);
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

function renderAuthor(event: ChannelEvent): string {
  if (event.authorType && event.authorType !== 'human') {
    const model = event.agentModel ? ` (${event.agentModel})` : '';
    return `${event.author}'s ${event.authorType}${model}`;
  }
  return event.author;
}

function formatTimestamp(ms: number): string {
  const now = Date.now();
  const delta = Math.floor((now - ms) / 1000);
  if (delta < 60) return 'just now';
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86_400) return `${Math.floor(delta / 3600)}h ago`;
  return new Date(ms).toLocaleString();
}
