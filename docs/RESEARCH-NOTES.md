# Research Notes — Graph Visualization & Three-State Architecture

## ReactFlow Multi-State Rendering

### Approach: Single instance with mode switching
- ReactFlow supports custom node types — define `current`, `planned`, `live` variants
- Custom edges with SVG animations (`animateMotion`) for flow direction
- `hidden` property for conditional rendering (progressive disclosure)
- Sub-flows with `parentId` for group/compound nodes
- Performance: 60 FPS with proper memoization, drops to 2 FPS without

### Key performance rules (from ReactFlow docs):
1. Wrap custom nodes in `React.memo()`
2. Use `useCallback()` for event handlers
3. Don't store selection state in the nodes array — keep separate
4. Use Zustand with shallow comparison for stores

### Sources:
- https://reactflow.dev/learn/customization/custom-nodes
- https://reactflow.dev/learn/advanced-use/performance
- https://medium.com/@lukasz.jazwa_32493/the-ultimate-guide-to-optimize-react-flow-project-performance

---

## Graph Diff Visualization

### Industry standard color coding:
- **Added**: Green/Yellow
- **Removed**: Red
- **Modified**: Orange/Cyan
- **Affected** (blast radius): Purple/Violet

### GoJS Visual Differencer pattern:
- Side-by-side or overlay modes
- Nodes carry `changeStatus` property
- Edges show added/removed state independently

### ArchToCode (2025):
- Auto-clustering by layer/domain
- Before/after color coding
- "Architecture storytelling" — step-by-step narration
- Lazy loading for large projects

### Sources:
- https://gojs.net/extras/visualDiff.html
- https://peerpush.net/p/archtocode-visual-git-diff-and-architect

---

## Real-Time Graph Updates

### WebSocket → Graph update pattern:
```
WebSocket message
  → Batch accumulator (100ms window)
  → Incremental diff (what changed?)
  → Update only affected nodes in Zustand store
  → React.memo nodes re-render only if their data changed
```

### Key insight: Batch updates
- Don't re-render on every WebSocket message
- Batch to 5-10 updates/second max
- Humans can't perceive faster than that

### Incremental update algorithms:
- Maintain node positions separately from node data
- Only update what changed (immutable patterns)
- Don't rebuild entire graph — patch affected nodes

---

## Force-Directed Layout with Clustering

### d3-force clustering:
- `d3-force-cluster` module: force that pulls nodes toward cluster centers
- Combine with collision force to pack without overlap
- Standard forces: link attraction, charge repulsion, center gravity

### Clustering heuristics for code:
- By layer (controllers, services, utilities)
- By domain (user, order, payment)
- By change frequency (files that change together cluster)
- By import density (heavily connected files cluster)

### Semantic zoom:
- Zoom level 1: clusters as single aggregate nodes
- Zoom level 2: individual files within clusters
- Zoom level 3: symbols within files
- Use D3 zoom behavior with transform, not element resize

### Sources:
- https://www.npmjs.com/package/d3-force-cluster
- https://g6.antv.antgroup.com/en/manual/layout/d3-force-layout

---

## Architecture Visualization Tool Landscape (2025-2026)

### What works well:
- **Sourcetrail** (discontinued): cross-reference navigation, interactive code graphing
- **CodeSee**: auto-generated mental models, cross-repo dependencies
- **CodeScene**: behavioral data (git activity, change coupling)
- **Structure101**: interactive dependency graphs with refactoring suggestions

### Key pattern from leaders:
Tools that layer semantic metadata (ASTs, git history, test coverage) create "runtime-aware graphs" that reflect code intent, not just structure.

### What CodeTrellis adds that others don't:
- **Plan-driven** — not just viewing, but planning and executing changes
- **Agent-aware** — integrated with AI coding tools via MCP
- **Three-state comparison** — before/planned/live simultaneously
- **Drift detection** — continuous monitoring of agent conformity

### Sources:
- https://thectoclub.com/tools/best-code-visualization-tools/
- https://developex.com/blog/intelligent-codebase-tools/
- https://ones.com/blog/choose-best-component-dependency-graph-tool/

---

## Design Decisions

### Why single ReactFlow instance (not three)?
- Three instances = 3x memory, 3x layout computation
- Synchronizing zoom/pan across three instances is complex
- Mode switching is faster (swap data, keep positions)
- Overlay approach works for diff (proven in existing projection)

### Why snapshot as JSON blob (not relational)?
- Snapshots are immutable — write-once, read-many
- JSON blob is simple to store/retrieve
- No need to query individual files within a snapshot
- Relational would need 3 tables (snapshot → files, snapshot → edges, snapshot → symbols)
- JSON keeps it as one row per snapshot

### Why client-side diff (not server-side)?
- Immediate feedback when switching views
- Server-side diff is slower (requires re-parsing)
- Client has both snapshot data and live data in memory
- Server-side used for deeper analysis (symbol-level diff)

### Why auto-capture on plan approval (not manual)?
- Reduces friction — user doesn't think about snapshots
- Plan approval is the natural "before" moment
- Manual checkpoints still available via API/MCP
