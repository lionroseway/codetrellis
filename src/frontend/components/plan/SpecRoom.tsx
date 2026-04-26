import { useMemo, useState } from 'react';
import { Plus, FileText, Search } from 'lucide-react';
import { usePlanStore } from '../../stores/plan-store';
import { getSpecDocTypeMeta, SPEC_DOC_TYPES } from '../../lib/spec-doc-types';
import { SpecDocViewer } from './SpecDocViewer';
import { SpecDocCreateModal } from './SpecDocCreateModal';

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
            {filtered.map((doc) => {
              const meta = getSpecDocTypeMeta(doc.docType);
              return (
                <button
                  key={doc.uid}
                  onClick={() => setSelectedDoc(doc.uid)}
                  className="w-full text-left p-2 rounded-lg border border-white/[0.05] bg-white/[0.015] hover:bg-white/[0.04] hover:border-accent/25 transition-all"
                >
                  <div className="flex items-center gap-2">
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
            })}
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
