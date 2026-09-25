import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Plus, X, FileText, Folder, Hash, ArrowRight, Link2, Image as ImageIcon, Video,
  Code, ChevronDown, ChevronRight, 
} from 'lucide-react';
import { usePlanItemsStore } from '../../../stores/plan-items-store';
import { PantryPlaceholder } from './PantryPlaceholder';
import { useProjectStore } from '../../../stores/project-store';
import { useToastStore } from '../../../stores/toast-store';
import {
  classifyAttachment, fileToBase64, isInlinePreviewable, attachmentSrcUrl,
  relativeIfPossible,
} from '../../../lib/attachment-helpers';
import { CodeBlockPicker } from './CodeBlockPicker';
import { AnchorPicker, type AnchorSelection } from './AnchorPicker';
import type {
  PlanItem, FileSpec, FileSpecAction, SymbolSpec, PlanItemEdge, TaskAttachment,
  AttachmentKind,
} from '@shared/types';

/**
 * Phase 15 §15.D — Unified Context Rail (Notion-grade sizing).
 *
 * One rail to rule them all. Code targets, graph edges, and reference
 * attachments live in a single list, type-tagged.
 *
 * Code anchors (file / folder / symbol) come in via the in-app
 * AnchorPicker — browse the project tree on the left, see symbols on
 * the right, or type to search across both. The OS file dialog only
 * shows up for stuff that may live outside the project (image / video
 * uploads).
 *
 * Storage stays where it lives today: code targets write to the
 * PlanItem's `fileSpecs` / `symbolSpecs` / `newConnections` /
 * `removedConnections`; references write to the `attachments` table.
 *
 * Sizing follows Option B: body text ~14px, headers 12px small-caps,
 * chips ~12.5px. Wider line-height than the old 11px-everywhere rail.
 */
export function ContextRail({
  item,
  attachments,
}: {
  item: PlanItem;
  attachments: TaskAttachment[];
}) {
  const updateItem = usePlanItemsStore((s) => s.updateItem);
  const addItemAttachment = usePlanItemsStore((s) => s.addItemAttachment);
  const projectRoot = useProjectStore((s) => s.root);
  const addToast = useToastStore((s) => s.addToast);

  const isAction = item.kind === 'action';
  const fileSpecs = item.fileSpecs ?? [];
  const symbolSpecs = item.symbolSpecs ?? [];
  const newConnections = item.newConnections ?? [];
  const removedConnections = item.removedConnections ?? [];

  const totalRows =
    fileSpecs.length + symbolSpecs.length +
    newConnections.length + removedConnections.length +
    attachments.length;

  // +Add popover state and the in-app AnchorPicker modal state.
  const [addOpen, setAddOpen] = useState(false);
  const [pending, setPending] = useState<PendingAddKind | null>(null);
  const [pickerMode, setPickerMode] = useState<PickerMode | null>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (!addOpen) return;
    const handler = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setAddOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [addOpen]);

  const setFileSpecs = (next: FileSpec[]) => updateItem(item.uid, { fileSpecs: next });
  const setSymbolSpecs = (next: SymbolSpec[]) => updateItem(item.uid, { symbolSpecs: next });
  const setNewConnections = (next: PlanItemEdge[]) => updateItem(item.uid, { newConnections: next });
  const setRemovedConnections = (next: PlanItemEdge[]) => updateItem(item.uid, { removedConnections: next });

  // Convert an AnchorPicker selection into the right write — either a
  // FileSpec (target) or an attachment (reference), depending on
  // pickerMode.
  const handleAnchorPick = async (sel: AnchorSelection) => {
    if (!pickerMode) return;
    const role = pickerMode.role;
    setPickerMode(null);

    if (role === 'target') {
      if (sel.kind === 'file') {
        setFileSpecs([...fileSpecs, { path: sel.value, action: 'modify', edits: [] }]);
      } else if (sel.kind === 'folder') {
        const path = sel.value.endsWith('/') ? sel.value : `${sel.value}/`;
        setFileSpecs([...fileSpecs, { path, action: 'modify', isDir: true }]);
      } else if (sel.kind === 'symbol') {
        // Coerce backend kind into our SymbolSpec kind union; default
        // to 'function' if it's something we don't have a row for.
        const kind = (['class', 'function', 'method', 'interface', 'type', 'enum'] as const)
          .includes(sel.symbolKind as any) ? (sel.symbolKind as SymbolSpec['kind']) : 'function';
        setSymbolSpecs([...symbolSpecs, {
          name: sel.value,
          kind,
          action: 'modify',
          description: sel.filePath ? `In ${sel.filePath}` : undefined,
        }]);
      }
    } else {
      // role === 'reference'
      if (sel.kind === 'file') {
        await addItemAttachment(item.uid, { kind: 'file_ref', value: sel.value, label: sel.label });
      } else if (sel.kind === 'folder') {
        const v = sel.value.endsWith('/') ? sel.value : `${sel.value}/`;
        await addItemAttachment(item.uid, { kind: 'file_ref', value: v, label: sel.label });
      } else if (sel.kind === 'symbol') {
        // Symbols-as-reference: store as code_block placeholder so the
        // user knows it points at a symbol; could be richer later.
        await addItemAttachment(item.uid, {
          kind: 'file_ref',
          value: sel.filePath ?? '',
          label: `${sel.label} (${sel.symbolKind ?? 'symbol'})`,
        });
      }
    }
  };

  // ---- Reference / attachment writers (drag-drop + clipboard paste) ----
  const electronApi = (window as unknown as { electronAPI?: Window['electronAPI'] }).electronAPI;

  const uploadFromAbsPath = async (abs: string) => {
    const kind = classifyAttachment({ path: abs });
    const value = relativeIfPossible(abs, projectRoot ?? undefined);
    const label = abs.split('/').pop() ?? abs;
    await addItemAttachment(item.uid, { kind, value, label });
  };

  const uploadFromFileObject = async (file: File) => {
    const kind = classifyAttachment({ path: file.name, mime: file.type, size: file.size });
    if (kind === 'image' || kind === 'video') {
      const dataBase64 = await fileToBase64(file);
      const res = await fetch(`/api/items/${item.uid}/attachments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind, value: file.name, label: file.name,
          contentType: file.type || undefined,
          dataBase64, projectRoot: projectRoot ?? undefined,
        }),
      });
      if (!res.ok) addToast({ type: 'error', title: 'Upload failed', message: file.name });
    } else {
      await addItemAttachment(item.uid, { kind: 'file_ref', value: file.name, label: file.name });
    }
  };

  const onPickImageOrVideo = async () => {
    setAddOpen(false);
    if (electronApi?.openFilePicker) {
      const paths = await electronApi.openFilePicker({
        multiSelect: true,
        allowFolders: false,
        defaultPath: projectRoot ?? undefined,
        title: 'Pick image / video',
      });
      if (!paths || paths.length === 0) return;
      for (const p of paths) await uploadFromAbsPath(p);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/*,video/*';
    input.onchange = async () => {
      if (!input.files) return;
      for (const f of Array.from(input.files)) await uploadFromFileObject(f);
    };
    input.click();
  };

  // Drag-drop on the rail (folder-aware via webkitGetAsEntry).
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const items = Array.from(e.dataTransfer.items ?? []);
    const files = Array.from(e.dataTransfer.files ?? []);
    let handledViaItems = false;
    if (items.length > 0 && typeof items[0].webkitGetAsEntry === 'function') {
      for (const it of items) {
        const entry = it.webkitGetAsEntry?.();
        if (entry?.isDirectory) {
          handledViaItems = true;
          await addItemAttachment(item.uid, {
            kind: 'file_ref', value: `${entry.name}/`, label: `${entry.name}/`,
          });
        } else if (entry?.isFile) {
          handledViaItems = true;
          const f = it.getAsFile();
          if (f) await uploadFromFileObject(f);
        }
      }
    }
    if (!handledViaItems) for (const f of files) await uploadFromFileObject(f);
  };

  const openPicker = (mode: PickerMode) => {
    setPickerMode(mode);
    setAddOpen(false);
  };

  // Progressive disclosure: when empty and no pending form, collapse
  // to a single "+ Add context" button instead of rendering a full section.
  const isEmpty = totalRows === 0 && pending === null && pickerMode === null;

  if (isEmpty && !addOpen) {
    return (
      <section>
        <div className="relative" ref={addMenuRef}>
          <button
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] rounded-md border border-dashed border-white/[0.1] text-foreground-subtle hover:text-foreground hover:border-accent/30 hover:bg-accent/5 transition-colors"
          >
            <Plus size={12} /> Add context
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={`rounded-xl border ${
        dragOver ? 'border-accent ring-1 ring-accent/30 bg-accent/5' : 'border-white/[0.06] bg-white/[0.015]'
      } px-5 py-4 space-y-3 transition-colors`}
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <h3 className="text-[12px] uppercase tracking-[0.1em] text-foreground-subtle font-semibold">
          Context {totalRows > 0 && <span className="opacity-60">· {totalRows}</span>}
        </h3>
        <div className="flex-1" />
        <div className="relative" ref={addMenuRef}>
          <button
            onClick={() => setAddOpen((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] rounded-md border border-white/[0.08] bg-white/[0.02] text-foreground-muted hover:text-foreground hover:bg-white/[0.04]"
          >
            <Plus size={13} /> Add <ChevronDown size={12} className="opacity-70" />
          </button>
          {addOpen && (
            <AddMenu
              isAction={isAction}
              onTargetFile={() => openPicker({ role: 'target', allow: { file: true, folder: true, symbol: true } })}
              onTargetFolder={() => openPicker({ role: 'target', allow: { folder: true } })}
              onTargetSymbol={() => openPicker({ role: 'target', allow: { symbol: true } })}
              onTargetEdge={() => { setAddOpen(false); setPending('edge'); }}
              onUrl={() => { setAddOpen(false); setPending('url'); }}
              onPickImageOrVideo={onPickImageOrVideo}
              onRefFile={() => openPicker({ role: 'reference', allow: { file: true, folder: true, symbol: true } })}
              onRefFolder={() => openPicker({ role: 'reference', allow: { folder: true } })}
              onCodeBlock={() => { setAddOpen(false); setPending('code_block'); }}
              onTranscript={() => { setAddOpen(false); setPending('transcript'); }}
            />
          )}
        </div>
      </div>

      {/* Rows */}
      <div className="space-y-2">
        {fileSpecs.map((fs, i) => (
          <FileRow
            key={`file-${i}`}
            spec={fs}
            onChange={(patch) => setFileSpecs(fileSpecs.map((s, ix) => ix === i ? { ...s, ...patch } : s))}
            onRemove={() => setFileSpecs(fileSpecs.filter((_, ix) => ix !== i))}
          />
        ))}
        {symbolSpecs.map((spec, i) => (
          <SymbolRow
            key={`symbol-${i}`}
            spec={spec}
            onChange={(patch) => setSymbolSpecs(symbolSpecs.map((s, ix) => ix === i ? { ...s, ...patch } : s))}
            onRemove={() => setSymbolSpecs(symbolSpecs.filter((_, ix) => ix !== i))}
          />
        ))}
        {newConnections.map((edge, i) => (
          <EdgeRow
            key={`edge-add-${i}`}
            edge={edge}
            verb="add"
            onRemove={() => setNewConnections(newConnections.filter((_, ix) => ix !== i))}
          />
        ))}
        {removedConnections.map((edge, i) => (
          <EdgeRow
            key={`edge-remove-${i}`}
            edge={edge}
            verb="remove"
            onRemove={() => setRemovedConnections(removedConnections.filter((_, ix) => ix !== i))}
          />
        ))}
        {[...attachments].sort((a, b) => a.createdAt - b.createdAt).map((a) => (
          <AttachmentRow key={a.uid} itemUid={item.uid} attachment={a} />
        ))}
      </div>

      {/* Inline forms */}
      {pending === 'edge' && (
        <EdgeDraft
          onAdd={(verb, edge) => {
            if (verb === 'add') setNewConnections([...newConnections, edge]);
            else setRemovedConnections([...removedConnections, edge]);
            setPending(null);
          }}
          onCancel={() => setPending(null)}
        />
      )}
      {(pending === 'url' || pending === 'transcript') && (
        <SimpleAttachmentDraft
          kind={pending}
          onAdd={async (value, label) => {
            await addItemAttachment(item.uid, { kind: pending, value, label });
            setPending(null);
          }}
          onCancel={() => setPending(null)}
        />
      )}
      {pending === 'code_block' && (
        <CodeBlockPicker itemUid={item.uid} onClose={() => setPending(null)} />
      )}

      {/* AnchorPicker modal — file / folder / symbol browse-or-search */}
      {pickerMode && (
        <AnchorPicker
          allow={pickerMode.allow}
          title={pickerMode.role === 'target' ? 'Pick target' : 'Pick reference'}
          planUid={item.planUid}
          onPick={handleAnchorPick}
          onClose={() => setPickerMode(null)}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Add menu
// ---------------------------------------------------------------------------

type PendingAddKind = 'edge' | 'url' | 'transcript' | 'code_block';

interface PickerMode {
  role: 'target' | 'reference';
  allow: { file?: boolean; folder?: boolean; symbol?: boolean };
}

function AddMenu({
  isAction,
  onTargetFile, onTargetEdge,
  onUrl, onPickImageOrVideo, onRefFile, onCodeBlock,
}: {
  isAction: boolean;
  onTargetFile: () => void;
  onTargetFolder: () => void;
  onTargetSymbol: () => void;
  onTargetEdge: () => void;
  onUrl: () => void;
  onPickImageOrVideo: () => void;
  onRefFile: () => void;
  onRefFolder: () => void;
  onCodeBlock: () => void;
  onTranscript: () => void;
}) {
  return (
    <div className="absolute top-full right-0 mt-1.5 z-30 w-[280px] rounded-xl border border-white/[0.1] bg-[#0d0e16] shadow-2xl shadow-black/60 p-2 text-[13px]">
      {/* For tasks: browse adds targets (drift-tracked). For pages: adds references. */}
      <MenuItem
        icon={FileText}
        label="Browse files / symbols"
        hint="Search the project tree"
        onClick={isAction ? onTargetFile : onRefFile}
      />
      {isAction && (
        <MenuItem icon={ArrowRight} label="Add graph edge" hint="Link nodes on the map" onClick={onTargetEdge} />
      )}
      <div className="my-1.5 border-t border-white/[0.06]" />
      <MenuItem icon={Link2} label="URL" hint="Paste a link" onClick={onUrl} />
      <MenuItem icon={ImageIcon} label="Image / video" hint="Upload from disk" onClick={onPickImageOrVideo} />
      <MenuItem icon={Code} label="Paste text" hint="Code snippet or transcript" onClick={onCodeBlock} />
    </div>
  );
}

function MenuItem({
  icon: Icon, label, hint, onClick,
}: {
  icon: typeof FileText;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left text-foreground-muted hover:text-foreground hover:bg-white/[0.04]"
    >
      <Icon size={14} className="text-foreground-subtle shrink-0" />
      <span className="flex-1 text-[13px]">{label}</span>
      {hint && <span className="text-[11.5px] text-foreground-subtle truncate max-w-[160px]">{hint}</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// File / folder row
// ---------------------------------------------------------------------------

const FILE_ACTIONS: FileSpecAction[] = ['create', 'modify', 'delete', 'move'];
const FILE_ACTION_TINT: Record<FileSpecAction, string> = {
  create: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  modify: 'bg-accent/10 text-accent border-accent/30',
  delete: 'bg-red-500/10 text-red-300 border-red-500/30',
  move: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
};

function FileRow({
  spec, onChange, onRemove,
}: {
  spec: FileSpec;
  onChange: (patch: Partial<FileSpec>) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isDir = !!spec.isDir;
  const Icon = isDir ? Folder : FileText;
  const iconTint = isDir ? 'text-amber-300' : 'text-foreground-subtle';

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] hover:border-white/[0.1] transition-colors">
      <div className="flex items-center gap-2.5 px-3 py-2">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="p-0.5 rounded text-foreground-subtle hover:text-foreground hover:bg-white/[0.04]"
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <Icon size={14} className={`${iconTint} shrink-0`} />
        <select
          value={spec.action}
          onChange={(e) => onChange({ action: e.target.value as FileSpecAction })}
          className={`px-2.5 py-1 text-[11.5px] rounded border font-medium uppercase tracking-wider ${FILE_ACTION_TINT[spec.action]}`}
        >
          {FILE_ACTIONS.map((a) => (
            <option key={a} value={a} className="bg-[#0d0e16] text-foreground">{a}</option>
          ))}
        </select>
        <input
          type="text"
          value={spec.path}
          onChange={(e) => onChange({ path: e.target.value })}
          className="flex-1 bg-transparent text-[13.5px] font-mono text-foreground focus:outline-none focus:bg-white/[0.04] rounded px-2 py-0.5"
        />
        {spec.action === 'move' && (
          <input
            type="text"
            value={spec.moveTo ?? ''}
            onChange={(e) => onChange({ moveTo: e.target.value })}
            placeholder="→ destination"
            className="w-52 bg-white/[0.02] border border-white/[0.08] rounded px-2.5 py-1 text-[13px] font-mono text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-accent/40"
          />
        )}
        <button
          onClick={onRemove}
          className="p-1.5 rounded text-foreground-subtle hover:text-red-300 hover:bg-red-500/10"
          title="Remove"
        >
          <X size={13} />
        </button>
      </div>

      {expanded && (
        <div className="border-t border-white/[0.06] px-3.5 py-2.5 space-y-2 bg-black/20">
          <textarea
            value={spec.description ?? ''}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder={isDir
              ? 'Why this folder is in scope (e.g. "refactor every file inside to use the new logger")…'
              : 'Why this file changes (agent-readable note)…'}
            className="w-full min-h-[52px] bg-transparent border border-white/[0.06] rounded-md px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-accent/30 resize-y leading-relaxed"
          />
          {!isDir && (
            <p className="text-[12px] text-foreground-subtle italic">
              Per-file edits (line range / symbol pin / instruction) — coming back next iteration.
            </p>
          )}
          {isDir && (
            <p className="text-[12px] text-foreground-subtle italic leading-relaxed">
              Folder targets apply the verb to every file the agent decides falls in scope. Add a description to constrain.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Symbol row
// ---------------------------------------------------------------------------

const SYMBOL_KINDS: SymbolSpec['kind'][] = ['class', 'function', 'method', 'interface', 'type', 'enum'];
const SYMBOL_ACTIONS: SymbolSpec['action'][] = ['add', 'modify', 'remove', 'move'];

function SymbolRow({
  spec, onChange, onRemove,
}: {
  spec: SymbolSpec;
  onChange: (patch: Partial<SymbolSpec>) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const supportsSignature = spec.kind === 'function' || spec.kind === 'method'
    || spec.kind === 'type' || spec.kind === 'enum' || spec.kind === 'interface';

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] hover:border-white/[0.1] transition-colors">
      <div className="flex items-center gap-2.5 px-3 py-2">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="p-0.5 rounded text-foreground-subtle hover:text-foreground hover:bg-white/[0.04]"
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <Hash size={14} className="text-cyan-300 shrink-0" />
        <select
          value={spec.action}
          onChange={(e) => onChange({ action: e.target.value as SymbolSpec['action'] })}
          className="px-2.5 py-1 text-[11.5px] rounded border border-white/[0.08] bg-white/[0.02] text-foreground-muted uppercase tracking-wider font-medium"
        >
          {SYMBOL_ACTIONS.map((a) => (
            <option key={a} value={a} className="bg-[#0d0e16] text-foreground">{a}</option>
          ))}
        </select>
        <select
          value={spec.kind}
          onChange={(e) => onChange({ kind: e.target.value as SymbolSpec['kind'] })}
          className="px-2.5 py-1 text-[11.5px] rounded border border-white/[0.08] bg-white/[0.02] text-foreground-muted"
        >
          {SYMBOL_KINDS.map((k) => (
            <option key={k} value={k} className="bg-[#0d0e16] text-foreground">{k}</option>
          ))}
        </select>
        <input
          type="text"
          value={spec.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="flex-1 bg-transparent text-[13.5px] font-mono text-foreground focus:outline-none focus:bg-white/[0.04] rounded px-2 py-0.5"
        />
        {spec.action === 'move' && (
          <input
            type="text"
            value={spec.moveTo ?? ''}
            onChange={(e) => onChange({ moveTo: e.target.value })}
            placeholder="→ target file"
            className="w-52 bg-white/[0.02] border border-white/[0.08] rounded px-2.5 py-1 text-[13px] font-mono text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-accent/40"
          />
        )}
        <button
          onClick={onRemove}
          className="p-1.5 rounded text-foreground-subtle hover:text-red-300 hover:bg-red-500/10"
        >
          <X size={13} />
        </button>
      </div>

      {expanded && (
        <div className="border-t border-white/[0.06] px-3.5 py-2.5 space-y-2 bg-black/20">
          {supportsSignature && (
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-foreground-subtle">
                {spec.kind === 'function' || spec.kind === 'method' ? 'Signature' :
                 spec.kind === 'enum' ? 'Variants' : 'Shape'}
              </span>
              <textarea
                value={spec.signature ?? ''}
                onChange={(e) => onChange({ signature: e.target.value })}
                placeholder={
                  spec.kind === 'function' || spec.kind === 'method'
                    ? 'validate(input: string): Result<T>'
                    : spec.kind === 'enum'
                    ? "'pending' | 'in_progress' | 'done'"
                    : '{ id: string; name: string }'
                }
                className="mt-1 w-full min-h-[40px] bg-white/[0.02] border border-white/[0.08] rounded-md px-2.5 py-1.5 text-[13px] font-mono text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-accent/40 resize-y leading-relaxed"
              />
            </label>
          )}
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-foreground-subtle">
              Description
            </span>
            <textarea
              value={spec.description ?? ''}
              onChange={(e) => onChange({ description: e.target.value })}
              placeholder="Why this symbol changes…"
              className="mt-1 w-full min-h-[40px] bg-transparent border border-white/[0.06] rounded-md px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-accent/30 resize-y leading-relaxed"
            />
          </label>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edge row + draft
// ---------------------------------------------------------------------------

function EdgeRow({
  edge, verb, onRemove,
}: {
  edge: PlanItemEdge;
  verb: 'add' | 'remove';
  onRemove: () => void;
}) {
  const tint = verb === 'add' ? 'border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-300' :
    'border-red-500/30 bg-red-500/[0.06] text-red-300';
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] hover:border-white/[0.1] transition-colors">
      <div className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-mono">
        <ArrowRight size={14} className="text-foreground-subtle shrink-0" />
        <span className={`px-2.5 py-0.5 text-[11.5px] uppercase tracking-wider rounded border ${tint}`}>
          {verb} edge
        </span>
        <span className="text-foreground-muted truncate flex-1">{edge.from}</span>
        <ArrowRight size={12} className="text-foreground-subtle shrink-0" />
        <span className="text-foreground-muted truncate flex-1">{edge.to}</span>
        <button
          onClick={onRemove}
          className="p-1.5 rounded text-foreground-subtle hover:text-red-300 hover:bg-red-500/10"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}

function EdgeDraft({
  onAdd, onCancel,
}: {
  onAdd: (verb: 'add' | 'remove', edge: PlanItemEdge) => void;
  onCancel: () => void;
}) {
  const [verb, setVerb] = useState<'add' | 'remove'>('add');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const submit = () => {
    if (!from.trim() || !to.trim()) return;
    onAdd(verb, { from: from.trim(), to: to.trim() });
  };
  return (
    <div className="rounded-lg border border-accent/20 bg-accent/[0.03] p-3 flex items-center gap-2 flex-wrap">
      <select
        value={verb}
        onChange={(e) => setVerb(e.target.value as 'add' | 'remove')}
        className="px-2.5 py-1.5 text-[12px] rounded border border-white/[0.08] bg-white/[0.02] text-foreground-muted uppercase tracking-wider"
      >
        <option value="add" className="bg-[#0d0e16] text-foreground">add</option>
        <option value="remove" className="bg-[#0d0e16] text-foreground">remove</option>
      </select>
      <input
        autoFocus
        type="text"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
        placeholder="from (file/symbol)"
        className="flex-1 min-w-[160px] bg-white/[0.02] border border-white/[0.08] rounded px-2.5 py-1.5 text-[13px] font-mono text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-accent/40"
      />
      <ArrowRight size={13} className="text-foreground-subtle shrink-0" />
      <input
        type="text"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder="to (file/symbol)"
        className="flex-1 min-w-[160px] bg-white/[0.02] border border-white/[0.08] rounded px-2.5 py-1.5 text-[13px] font-mono text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-accent/40"
      />
      <button
        onClick={submit}
        disabled={!from.trim() || !to.trim()}
        className="px-3 py-1.5 text-[12px] rounded bg-accent text-white hover:bg-accent-hover disabled:opacity-50"
      >
        Add
      </button>
      <button onClick={onCancel} className="p-1.5 rounded text-foreground-subtle hover:text-foreground hover:bg-white/[0.04]">
        <X size={13} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// URL / transcript draft
// ---------------------------------------------------------------------------

function SimpleAttachmentDraft({
  kind, onAdd, onCancel,
}: {
  kind: 'url' | 'transcript';
  onAdd: (value: string, label?: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  const [label, setLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    if (!value.trim()) return;
    setSubmitting(true);
    try { await onAdd(value.trim(), label.trim() || undefined); } finally { setSubmitting(false); }
  };
  return (
    <div className="rounded-lg border border-accent/20 bg-accent/[0.03] p-3 space-y-2">
      {kind === 'transcript' ? (
        <textarea
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Paste a transcript…"
          className="w-full min-h-[100px] bg-white/[0.02] border border-white/[0.08] rounded px-2.5 py-1.5 text-[13px] font-mono text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-accent/40 resize-y leading-relaxed"
        />
      ) : (
        <input
          autoFocus
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="https://…"
          className="w-full bg-white/[0.02] border border-white/[0.08] rounded px-2.5 py-1.5 text-[13px] font-mono text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-accent/40"
        />
      )}
      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Label (optional)"
        className="w-full bg-white/[0.02] border border-white/[0.08] rounded px-2.5 py-1.5 text-[12.5px] text-foreground placeholder:text-foreground-subtle focus:outline-none"
      />
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 text-[12px] rounded text-foreground-subtle hover:text-foreground hover:bg-white/[0.04]">
          Cancel
        </button>
        <button
          disabled={!value.trim() || submitting}
          onClick={submit}
          className="px-3 py-1.5 text-[12px] rounded bg-accent text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {submitting ? 'Pinning…' : 'Pin'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attachment row (lifted from old AttachmentsBlock)
// ---------------------------------------------------------------------------

const ATTACHMENT_ICON: Record<AttachmentKind, typeof Link2> = {
  url: Link2, image: ImageIcon, video: Video,
  file_ref: FileText, code_block: Code, transcript: FileText,
};

function AttachmentRow({ itemUid, attachment }: { itemUid: string; attachment: TaskAttachment }) {
  const removeItemAttachment = usePlanItemsStore((s) => s.removeItemAttachment);
  const projectRoot = useProjectStore((s) => s.root);
  const Icon = ATTACHMENT_ICON[attachment.kind];
  const previewable = isInlinePreviewable(attachment.kind);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  /**
   * Phase 29 §4.15 — what an unresolvable attachment looks like.
   *
   * `PantryPlaceholder` (Phase 7.1) was written for exactly this and
   * never imported, so until now a reference that does not resolve
   * rendered as a broken-image glyph. That is the worst possible answer
   * here: an external contributor cannot tell "you are not allowed to
   * see this" from "the app is broken", and the first is a normal,
   * expected state of a shared plan.
   *
   * `/api/pantry/resolve` is what knows the difference, and it was
   * unsurfaced too — it returns a reason per reference. Asked for only
   * once the media has actually failed, so the ordinary case costs
   * nothing.
   */
  const [failed, setFailed] = useState(false);
  const [reason, setReason] = useState<string | undefined>();

  const handleMediaError = useCallback(async () => {
    setFailed(true);
    if (!projectRoot) return;
    try {
      const res = await fetch(
        `/api/pantry/resolve?project=${encodeURIComponent(projectRoot)}`
        + `&refs=${encodeURIComponent(attachment.value)}`,
      );
      if (!res.ok) return;
      const data = await res.json() as { results?: Array<{ status: string; reason?: string }> };
      setReason(data.results?.[0]?.reason);
    } catch { /* a missing reason just means the placeholder says less */ }
  }, [projectRoot, attachment.value]);

  const isUploadedCopy =
    attachment.value.startsWith('.codetrellis/attachments/') ||
    attachment.value.startsWith('userdata://');
  const isFolder = attachment.kind === 'file_ref' && attachment.value.endsWith('/');

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    const noun = isUploadedCopy ? 'uploaded copy' : 'reference';
    // Removing an attachment removes the row only. The copy on disk stays —
    // this used to promise it would be deleted, and it never was. Deleting
    // it would mean deleting a path an attachment names, which for an
    // imported plan is a path someone else wrote; it is not worth that.
    if (!confirm(`Remove this ${attachment.kind} ${noun}?${isUploadedCopy ? '\n\nThe copy on disk is kept — delete it yourself if you no longer need it.' : ''}`)) return;
    removeItemAttachment(itemUid, attachment.uid);
  };

  return (
    <>
      <div className="group relative rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.1] overflow-hidden transition-colors">
        <button
          onClick={handleRemove}
          className="absolute top-2 right-2 z-10 p-1.5 rounded-md bg-black/40 backdrop-blur-sm text-foreground-subtle hover:text-red-300 hover:bg-red-500/20 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Remove"
        >
          <X size={13} />
        </button>

        {previewable && failed && (
          <div className="p-2">
            <PantryPlaceholder
              reference={attachment.value}
              reason={reason}
              author={attachment.author ?? undefined}
            />
          </div>
        )}
        {previewable && !failed && (
          <button
            onClick={() => setLightboxOpen(true)}
            className="block w-full bg-black/40 hover:bg-black/30 transition-colors"
            title="Open full-size"
          >
            {attachment.kind === 'image' ? (
              <img
                src={attachmentSrcUrl(attachment.uid)}
                alt={attachment.label || 'attachment'}
                className="w-full max-h-56 object-contain"
                loading="lazy"
                onError={handleMediaError}
              />
            ) : (
              <video
                src={attachmentSrcUrl(attachment.uid)}
                className="w-full max-h-56 object-contain"
                preload="metadata"
                muted
                playsInline
                onError={handleMediaError}
              />
            )}
          </button>
        )}
        <div className="px-3.5 py-2.5">
          <div className="flex items-start gap-2.5">
            {isFolder
              ? <Folder size={14} className="text-amber-300 shrink-0 mt-0.5" />
              : <Icon size={14} className="text-foreground-subtle shrink-0 mt-0.5" />}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                {attachment.label && (
                  <div className="text-[13.5px] font-medium text-foreground truncate">{attachment.label}</div>
                )}
                {attachment.role && (
                  <span
                    data-testid="artefact-role"
                    className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 bg-white/[0.04] text-foreground-subtle border border-white/[0.08]"
                    title={
                      attachment.role === 'material' ? 'Material — something this work was given to use'
                        : attachment.role === 'output' ? 'Output — something this work produced'
                        : 'Evidence — captured to prove a point'
                    }
                  >
                    {attachment.role}
                  </span>
                )}
                {attachment.role && attachment.sha256 === null && (
                  <span className="text-[10px] text-amber-300 shrink-0" title="The file is missing, or has become a link — it cannot be read">
                    ⚠ missing
                  </span>
                )}
                {(attachment.kind === 'image' || attachment.kind === 'video' || attachment.kind === 'file_ref') && (
                  <span
                    className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${
                      isUploadedCopy
                        ? 'bg-cyan-500/[0.1] text-cyan-300 border border-cyan-500/20'
                        : 'bg-white/[0.04] text-foreground-subtle border border-white/[0.08]'
                    }`}
                    title={isUploadedCopy
                      ? 'A copy of the bytes is stored — the attachment owns the file'
                      : 'Path reference — the file lives at the location shown below'}
                  >
                    {isUploadedCopy ? 'copy' : 'linked'}
                  </span>
                )}
              </div>
              {attachment.kind === 'url' ? (
                <a
                  href={attachment.value}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[12.5px] font-mono text-accent hover:text-accent-hover truncate block"
                >
                  {attachment.value}
                </a>
              ) : attachment.kind === 'code_block' ? (
                <details className="cursor-pointer">
                  <summary className="text-[12.5px] font-mono text-foreground-muted hover:text-foreground select-none">
                    {attachment.label || 'snippet'} — click to expand
                  </summary>
                  <pre className="mt-2 text-[12.5px] font-mono whitespace-pre overflow-x-auto bg-black/40 rounded p-3 max-h-[320px] overflow-y-auto leading-relaxed">
                    {attachment.value}
                  </pre>
                </details>
              ) : attachment.kind === 'transcript' ? (
                <details className="cursor-pointer">
                  <summary className="text-[12.5px] text-foreground-muted hover:text-foreground select-none">
                    {attachment.label || 'transcript'} — click to expand
                  </summary>
                  <pre className="mt-2 text-[12.5px] whitespace-pre-wrap text-foreground-muted bg-black/30 rounded p-3 max-h-[320px] overflow-y-auto leading-relaxed">
                    {attachment.value}
                  </pre>
                </details>
              ) : (
                <div className="text-[12.5px] font-mono text-foreground-muted truncate">
                  {attachment.value}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {lightboxOpen && previewable && (
        <div
          onClick={() => setLightboxOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/90 backdrop-blur-md cursor-zoom-out"
        >
          {attachment.kind === 'image' ? (
            <img
              src={attachmentSrcUrl(attachment.uid)}
              alt={attachment.label || 'attachment'}
              className="max-w-full max-h-full"
            />
          ) : (
            <video
              src={attachmentSrcUrl(attachment.uid)}
              className="max-w-full max-h-full"
              controls
              autoPlay
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
      )}
    </>
  );
}
