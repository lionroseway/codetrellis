import { useMemo, useState } from 'react';
import { Plus, FileText, Search } from 'lucide-react';
import { usePlanStore } from '../../stores/plan-store';
import { getSpecDocTypeMeta, SPEC_DOC_TYPES } from '../../lib/spec-doc-types';
import { SpecDocViewer } from './SpecDocViewer';
import { SpecDocCreateModal } from './SpecDocCreateModal';
import type { PlanDocument } from '@shared/types';

/**
 * Spec Room — the structured context surface for a plan. Lists all docs
 * attached to the active plan grouped by type, with quick add and search.
 */
export function SpecRoom({ planUid }: { planUid: string }) {
  const docs = usePlanStore((s) => s.planDocs);
  const setSelectedDoc = usePlanStore((s) => s.setSelectedDoc);
  const selectedDocUid = usePlanStore((s) => s.selectedDocUid);
  const [showCreate, setShowCreate] = useState<{ defaultType?: string } | null>(null);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) return docs;
    const q = query.toLowerCase();
    return docs.filter(
      (d) => d.title.toLowerCase().includes(q) || d.body.toLowerCase().includes(q) || d.docType.toLowerCase().includes(q),
    );
  }, [docs, query]);

  // Doc-type chips that exist on the plan, sorted by canonical taxonomy order
  const presentTypes = useMemo(() => {
    const seen = new Set(docs.map((d) => d.docType));
    return SPEC_DOC_TYPES.filter((t) => seen.has(t.type)).map((t) => t.type);
  }, [docs]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[9px] text-foreground-subtle uppercase tracking-wider font-medium">
          Spec Room ({docs.length})
        </span>
        <div className="flex-1" />
        <button
          onClick={() => setShowCreate({})}
          className="flex items-center gap-1 text-[10px] text-accent hover:text-accent-hover transition-colors"
        >
          <Plus size={10} />
          Add doc
        </button>
      </div>

      {docs.length === 0 ? (
        <EmptyState onPick={(type) => setShowCreate({ defaultType: type })} />
      ) : (
        <>
          <div className="flex items-center gap-1.5 px-2 py-1 bg-white/[0.02] border border-white/[0.06] rounded-md">
            <Search size={10} className="text-foreground-subtle shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search spec docs..."
              className="w-full text-[10.5px] bg-transparent text-foreground placeholder:text-foreground-subtle focus:outline-none"
            />
          </div>

          {presentTypes.length > 1 && (
            <div className="flex flex-wrap gap-1">
              {presentTypes.map((type) => {
                const meta = getSpecDocTypeMeta(type);
                const count = docs.filter((d) => d.docType === type).length;
                return (
                  <span
                    key={type}
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] border ${meta.chipClass}`}
                    title={meta.description}
                  >
                    <meta.icon size={8} />
                    {meta.label}
                    <span className="opacity-70">{count}</span>
                  </span>
                );
              })}
            </div>
          )}

          <div className="space-y-1">
            {query.trim() ? (
              // Flat list while searching — nesting hides matches.
              filtered.map((doc) => (
                <DocRow
                  key={doc.uid}
                  doc={doc}
                  depth={0}
                  onClick={() => setSelectedDoc(doc.uid)}
                />
              ))
            ) : (
              <DocTree docs={filtered} onSelect={setSelectedDoc} />
            )}
            {filtered.length === 0 && query && (
              <div className="text-[10.5px] text-foreground-subtle text-center py-4">
                No docs match "{query}"
              </div>
            )}
          </div>
        </>
      )}

      {selectedDocUid && (
        <SpecDocViewer docUid={selectedDocUid} onClose={() => setSelectedDoc(null)} />
      )}
      {showCreate && (
        <SpecDocCreateModal
          planUid={planUid}
          defaultType={showCreate.defaultType}
          onClose={() => setShowCreate(null)}
        />
      )}
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (type: string) => void }) {
  // Show the first 6 canonical types as quick-start tiles
  const quickTypes = SPEC_DOC_TYPES.slice(0, 6);

  return (
    <div className="rounded-lg border border-dashed border-white/[0.08] bg-white/[0.015] p-3">
      <div className="flex items-center gap-2 mb-2">
        <FileText size={12} className="text-foreground-subtle" />
        <span className="text-[10.5px] text-foreground-muted">
          Attach structured context — patterns, security, tests, examples, research, etc. Agents fetch what they need via MCP.
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1">
        {quickTypes.map((meta) => (
          <button
            key={meta.type}
            onClick={() => onPick(meta.type)}
            className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md border text-left transition-all hover:scale-[1.02] ${meta.chipClass}`}
            title={meta.description}
          >
            <meta.icon size={10} />
            <span className="text-[10px] font-medium truncate">{meta.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function extractPreview(body: string): string {
  // Strip leading markdown noise for the preview
  return body
    .replace(/^#+\s+/gm, '')
    .replace(/[*_`]/g, '')
    .replace(/\n{2,}/g, ' · ')
    .trim()
    .slice(0, 200);
}

/**
 * Renders the spec docs as a tree using `parentDocUid`. The list arrives
 * already sorted by the backend (top-level first, then by orderHint, then
 * by type), so we walk it once and build parent → children buckets in
 * source order. Recursion handles arbitrary nesting depth.
 */
function DocTree({ docs, onSelect }: { docs: PlanDocument[]; onSelect: (uid: string) => void }) {
  // Index children by parent uid in arrival order — preserves the
  // backend's lex sort so we don't re-derive it client-side.
  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, PlanDocument[]>();
    for (const doc of docs) {
      const key = doc.parentDocUid ?? null;
      const bucket = map.get(key) ?? [];
      bucket.push(doc);
      map.set(key, bucket);
    }
    return map;
  }, [docs]);

  // Defensive: if a doc references a parent that isn't in this list
  // (e.g. parent was filtered out), promote it to the top level so it
  // doesn't disappear.
  const presentUids = useMemo(() => new Set(docs.map((d) => d.uid)), [docs]);
  const orphans = useMemo(
    () => docs.filter((d) => d.parentDocUid && !presentUids.has(d.parentDocUid)),
    [docs, presentUids]
  );

  const renderNode = (doc: PlanDocument, depth: number): React.ReactNode => {
    const children = childrenByParent.get(doc.uid) ?? [];
    return (
      <div key={doc.uid}>
        <DocRow doc={doc} depth={depth} onClick={() => onSelect(doc.uid)} />
        {children.length > 0 && (
          <div className="space-y-1 mt-1">
            {children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const topLevel = childrenByParent.get(null) ?? [];

  return (
    <>
      {topLevel.map((doc) => renderNode(doc, 0))}
      {orphans.map((doc) => renderNode(doc, 0))}
    </>
  );
}

function DocRow({
  doc,
  depth,
  onClick,
}: {
  doc: PlanDocument;
  depth: number;
  onClick: () => void;
}) {
  const meta = getSpecDocTypeMeta(doc.docType);
  return (
    <button
      onClick={onClick}
      style={{ marginLeft: depth > 0 ? `${depth * 12}px` : undefined }}
      className={`w-full text-left p-2 rounded-lg border bg-white/[0.015] hover:bg-white/[0.04] hover:border-accent/25 transition-all ${
        depth > 0 ? 'border-white/[0.04] border-l-accent/30' : 'border-white/[0.05]'
      }`}
    >
      <div className="flex items-center gap-2">
        {doc.orderHint && (
          <span className="text-[9px] font-mono text-foreground-subtle bg-white/[0.04] px-1 rounded shrink-0">
            {doc.orderHint}
          </span>
        )}
        <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] border ${meta.chipClass} shrink-0`}>
          <meta.icon size={8} />
          {meta.label}
        </span>
        <span className="text-[11px] font-medium text-foreground truncate flex-1">
          {doc.title}
        </span>
        <span className="text-[9px] text-foreground-subtle shrink-0">
          v{doc.version}
        </span>
      </div>
      <p className="text-[10px] text-foreground-muted mt-1 line-clamp-2 leading-relaxed">
        {extractPreview(doc.body)}
      </p>
    </button>
  );
}
