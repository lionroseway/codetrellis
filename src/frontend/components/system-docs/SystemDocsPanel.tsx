/**
 * CDev Phase 3.4 — System documentation panel.
 *
 * Two-pane layout (left rail: doc list / search, right pane: rendered
 * markdown + freshness badge + edit affordance). The panel is opened
 * from the sidebar; it sits in the same surface region as the plan
 * canvas, mutually exclusive with the active plan view.
 *
 * The on-disk file (`<project>/.codetrellis/docs/<slug>.md`) is the
 * source of truth — edits round-trip through git. The store mirrors
 * the index for fast list / search; bodies are fetched lazily.
 */

import { useEffect, useMemo, useState } from 'react';
import { FileText, Plus, RefreshCw, Trash2, Edit3, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';
import { useSystemDocsStore } from '../../stores/system-docs-store';
import { useProjectStore } from '../../stores/project-store';
import { Markdown } from '../../lib/markdown';
import type { SystemDocFreshness } from '@shared/types';

export function SystemDocsPanel() {
  const projectPath = useProjectStore((s) => s.root);
  const ordered = useSystemDocsStore((s) => s.orderedUids);
  const byUid = useSystemDocsStore((s) => s.byUid);
  const fullByUid = useSystemDocsStore((s) => s.fullByUid);
  const freshnessByUid = useSystemDocsStore((s) => s.freshnessByUid);
  const selectedUid = useSystemDocsStore((s) => s.selectedUid);
  const searchQuery = useSystemDocsStore((s) => s.searchQuery);
  const loading = useSystemDocsStore((s) => s.loading);

  const hydrate = useSystemDocsStore((s) => s.hydrate);
  const setSearchQuery = useSystemDocsStore((s) => s.setSearchQuery);
  const selectDoc = useSystemDocsStore((s) => s.selectDoc);
  const createDoc = useSystemDocsStore((s) => s.createDoc);
  const deleteDoc = useSystemDocsStore((s) => s.deleteDoc);
  const verifyDoc = useSystemDocsStore((s) => s.verifyDoc);
  const reset = useSystemDocsStore((s) => s.reset);

  // Hydrate on project change.
  useEffect(() => {
    if (projectPath) {
      hydrate(projectPath);
    } else {
      reset();
    }
  }, [projectPath, hydrate, reset]);

  const selectedDoc = selectedUid ? fullByUid[selectedUid] : undefined;
  const selectedFreshness = selectedUid ? freshnessByUid[selectedUid] : undefined;

  const orderedDocs = useMemo(
    () => ordered.map((uid) => byUid[uid]).filter(Boolean),
    [ordered, byUid],
  );

  const handleCreate = async () => {
    if (!projectPath) return;
    const title = window.prompt('Doc title:');
    if (!title) return;
    await createDoc({
      projectPath,
      title,
      body: `# ${title}\n\nWrite something here.`,
    });
  };

  const handleDelete = async () => {
    if (!selectedUid) return;
    const doc = byUid[selectedUid];
    if (!doc) return;
    if (!window.confirm(`Delete "${doc.title}"? This removes the markdown file from disk.`)) return;
    await deleteDoc(selectedUid);
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left rail */}
      <div className="flex w-72 flex-col border-r border-border-subtle">
        <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
          <FileText size={14} className="text-foreground-muted" />
          <span className="text-[12px] font-semibold uppercase tracking-wide text-foreground-muted">
            System Docs
          </span>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!projectPath}
            className="ml-auto rounded-md p-1 text-foreground-muted hover:bg-white/[0.05] hover:text-foreground disabled:opacity-40"
            title="New doc"
          >
            <Plus size={14} />
          </button>
        </div>

        <div className="border-b border-border-subtle px-3 py-2">
          <input
            type="text"
            value={searchQuery}
            placeholder="Search title + body…"
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-md bg-white/[0.04] px-2 py-1 text-[12px] outline-none ring-0 placeholder:text-foreground-muted focus:bg-white/[0.06]"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && orderedDocs.length === 0 && (
            <div className="px-3 py-4 text-[12px] text-foreground-muted">Loading…</div>
          )}
          {!loading && orderedDocs.length === 0 && (
            <div className="px-3 py-4 text-[12px] text-foreground-muted">
              No docs yet. Click <Plus size={10} className="inline" /> to create the first one — it will live at
              <code className="ml-1 rounded bg-white/[0.06] px-1 py-0.5 text-[11px]">.codetrellis/docs/</code>.
            </div>
          )}
          {orderedDocs.map((doc) => {
            const isSelected = doc.uid === selectedUid;
            const freshness = freshnessByUid[doc.uid]?.status;
            return (
              <button
                type="button"
                key={doc.uid}
                onClick={() => selectDoc(doc.uid)}
                className={`block w-full border-b border-border-subtle px-3 py-2 text-left text-[12.5px] transition-colors ${
                  isSelected ? 'bg-white/[0.06] text-foreground' : 'text-foreground-muted hover:bg-white/[0.03] hover:text-foreground'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <FreshnessDot status={freshness} verified={!!doc.capturedAgainstCommit} />
                  <span className="truncate font-medium">{doc.title}</span>
                </div>
                <div className="mt-0.5 truncate text-[11px] text-foreground-muted">
                  {doc.owner ? `${doc.owner} · ` : ''}
                  {doc.slug}.md
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right pane */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {!selectedDoc && (
          <div className="flex h-full items-center justify-center px-8 text-center text-[13px] text-foreground-muted">
            <div>
              <FileText size={32} className="mx-auto mb-3 text-foreground-muted/60" />
              <p>Pick a doc on the left, or create a new one.</p>
              <p className="mt-2 text-[12px]">
                Docs describe how the system works — architecture, conventions, runbooks. They live as markdown
                in <code className="rounded bg-white/[0.06] px-1 py-0.5">.codetrellis/docs/</code> and travel through git.
              </p>
            </div>
          </div>
        )}
        {selectedDoc && (
          <DocView
            uid={selectedDoc.uid}
            title={selectedDoc.title}
            owner={selectedDoc.owner}
            body={selectedDoc.body}
            freshness={selectedFreshness}
            capturedAgainstCommit={selectedDoc.capturedAgainstCommit}
            lastVerifiedAt={selectedDoc.lastVerifiedAt}
            onVerify={() => verifyDoc(selectedDoc.uid)}
            onDelete={handleDelete}
          />
        )}
      </div>
    </div>
  );
}

interface DocViewProps {
  uid: string;
  title: string;
  owner: string | null;
  body: string;
  freshness?: { status: SystemDocFreshness; changedReferencedFiles: string[] };
  capturedAgainstCommit: string | null;
  lastVerifiedAt: number | null;
  onVerify: () => void;
  onDelete: () => void;
}

function DocView({
  uid, title, owner, body,
  freshness, capturedAgainstCommit, lastVerifiedAt,
  onVerify, onDelete,
}: DocViewProps) {
  const updateDoc = useSystemDocsStore((s) => s.updateDoc);
  const refreshFreshness = useSystemDocsStore((s) => s.refreshFreshness);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftBody, setDraftBody] = useState(body);

  // Keep draft state in sync when the user switches docs.
  useEffect(() => {
    setDraftTitle(title);
    setDraftBody(body);
    setEditing(false);
  }, [uid, title, body]);

  const handleSave = async () => {
    await updateDoc(uid, { title: draftTitle, body: draftBody } as any);
    setEditing(false);
  };

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-2">
        <FreshnessBadge
          status={freshness?.status}
          verified={!!capturedAgainstCommit}
          lastVerifiedAt={lastVerifiedAt}
          changedFiles={freshness?.changedReferencedFiles ?? []}
        />
        <div className="flex-1 truncate font-medium text-[13px]">{title}</div>
        {owner && (
          <div className="hidden text-[11px] text-foreground-muted md:block">owner · {owner}</div>
        )}
        <button
          type="button"
          onClick={() => refreshFreshness(uid)}
          className="rounded-md p-1 text-foreground-muted hover:bg-white/[0.05] hover:text-foreground"
          title="Re-check freshness"
        >
          <RefreshCw size={14} />
        </button>
        <button
          type="button"
          onClick={onVerify}
          className="rounded-md p-1 text-foreground-muted hover:bg-white/[0.05] hover:text-foreground"
          title="Mark as verified against current HEAD"
        >
          <CheckCircle2 size={14} />
        </button>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className={`rounded-md p-1 hover:bg-white/[0.05] ${editing ? 'text-accent' : 'text-foreground-muted hover:text-foreground'}`}
          title={editing ? 'Cancel edit' : 'Edit'}
        >
          <Edit3 size={14} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-md p-1 text-foreground-muted hover:bg-white/[0.05] hover:text-red-400"
          title="Delete doc"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {editing ? (
          <div className="space-y-3">
            <input
              type="text"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              className="w-full rounded-md bg-white/[0.04] px-3 py-2 text-[14px] font-medium outline-none focus:bg-white/[0.06]"
            />
            <textarea
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              rows={20}
              className="w-full rounded-md bg-white/[0.04] px-3 py-2 font-mono text-[12px] outline-none focus:bg-white/[0.06]"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSave}
                className="rounded-md bg-accent px-3 py-1 text-[12px] font-medium text-black hover:bg-accent/90"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => { setDraftTitle(title); setDraftBody(body); setEditing(false); }}
                className="rounded-md bg-white/[0.04] px-3 py-1 text-[12px] hover:bg-white/[0.08]"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <Markdown source={body} />
        )}
      </div>
    </>
  );
}

function FreshnessDot({ status, verified }: { status?: SystemDocFreshness; verified: boolean }) {
  if (!verified) {
    return <span className="inline-block h-2 w-2 rounded-full bg-foreground-muted/40" title="Unverified — never stamped against a commit" />;
  }
  const color = status === 'stale' ? 'bg-red-400'
    : status === 'moved' ? 'bg-amber-400'
    : 'bg-emerald-400';
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} title={status ?? 'current'} />;
}

interface FreshnessBadgeProps {
  status?: SystemDocFreshness;
  verified: boolean;
  lastVerifiedAt: number | null;
  changedFiles: string[];
}

function FreshnessBadge({ status, verified, lastVerifiedAt, changedFiles }: FreshnessBadgeProps) {
  if (!verified) {
    return (
      <div className="flex items-center gap-1.5 rounded-md bg-white/[0.04] px-2 py-1 text-[11px] text-foreground-muted">
        <Clock size={12} />
        <span>Unverified</span>
      </div>
    );
  }
  if (status === 'stale') {
    return (
      <div className="flex items-center gap-1.5 rounded-md bg-red-500/10 px-2 py-1 text-[11px] text-red-300" title={`Stale — ${changedFiles.length} referenced file(s) changed`}>
        <AlertTriangle size={12} />
        <span>Stale ({changedFiles.length})</span>
      </div>
    );
  }
  if (status === 'moved') {
    return (
      <div className="flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300" title="HEAD has moved past the captured commit, but no referenced file has actually changed">
        <Clock size={12} />
        <span>HEAD moved</span>
      </div>
    );
  }
  return (
    <div
      className="flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-300"
      title={lastVerifiedAt ? `Verified ${new Date(lastVerifiedAt).toLocaleString()}` : 'Verified'}
    >
      <CheckCircle2 size={12} />
      <span>Current</span>
    </div>
  );
}
