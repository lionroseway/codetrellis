# Codex Prompt — Visual Overhaul for CodeTrellis Graph

## Context

CodeTrellis is a codebase architecture visualization tool built with React 19, TypeScript, Tailwind CSS 4, and @xyflow/react (ReactFlow v12). It shows how files in a project connect through imports/dependencies.

The graph currently works functionally but looks like a basic wireframe — flat rectangular nodes with text labels connected by thin straight lines. We need it to look and feel like a professional product — think **codeviz.ai**, **Palantir Foundry**, or a **flight radar/mission control** aesthetic.

## Research First

Before coding, research these for visual inspiration and technical approaches:
- **codeviz.ai** — their interactive call graph and architecture diagram UX
- **Palantir Foundry** graph visualization — how they render entity networks
- **Sourcetrail** (discontinued) — their cross-reference navigation UI
- **Linear app** dark mode — their glassmorphic design language
- **Vercel dashboard** — their dark theme and subtle animations
- **ReactFlow examples gallery** — especially custom nodes and animated edges
- **D3.js force-directed graph examples** — for edge animation techniques (flow dots)
- **SVG animated edges** — how to create flowing/pulsing edge animations

## What Needs to Change

### 1. Custom Node Components

Replace the current flat node rendering with rich, layered, glassmorphic nodes.

**Files to modify:**
- `src/frontend/components/graph/nodes/FileNode.tsx` — main file node
- `src/frontend/components/graph/nodes/PackageNode.tsx` — cluster/package node
- `src/frontend/components/graph/nodes/SymbolNode.tsx` — function/class node
- `src/frontend/components/graph/nodes/DirectoryNode.tsx` — directory node

**Current node data interface (FileNode):**
```typescript
interface FileNodeData {
  label: string;           // filename (e.g. "server.ts")
  fullPath?: string;       // relative path (e.g. "src/backend/server.ts")
  language?: string;       // "typescript", "javascript", "python", etc.
  symbolCount?: number;    // number of functions/classes in file
  connectionCount?: number; // total inbound + outbound connections
  isHub?: boolean;         // true if this is an architecturally important file (3+ connections)
  isFocused?: boolean;     // true if this is the currently focused/centered file
  direction?: 'inbound' | 'outbound'; // relationship to the focused file
  exports?: string[];      // top exported symbol names
  changeStatus?: string;   // 'added', 'modified', 'removed', 'planned_add', 'planned_modify', etc.
  ghost?: boolean;         // true for planned-but-not-yet-created files
  taskDescription?: string; // description of the plan task affecting this file
  taskNumber?: number;     // plan task number
  done?: boolean;          // task completed
  frozen?: boolean;        // snapshot/baseline view (muted)
  onToggle?: () => void;   // click handler
}
```

**Design requirements per node type:**

**Focused node (isFocused=true) — LARGE, center of attention:**
- ~260x100px
- Glassmorphic card: `backdrop-blur-xl`, semi-transparent bg, subtle border with language-color glow
- Large file icon with language badge (TS blue, JS yellow, Python green, etc.)
- Filename in bold, full path below in monospace
- List of exported symbols inside the card (scrollable if many)
- Connection count as a prominent badge
- Animated glow ring pulsing softly
- Drop shadow with language-matched color

**Hub node (isHub=true) — MEDIUM, important file:**
- ~220x60px
- Same glassmorphic style but slightly smaller
- File icon + name + connection count badge
- Top 3-4 exports listed in small text below name
- Subtle glow matching language color

**Regular node — COMPACT:**
- ~160x40px
- File icon + name only
- Language color accent on left border
- Connection count as small badge

**Ghost node (ghost=true) — planned but doesn't exist yet:**
- Dashed border, green-tinted background
- Reduced opacity (70%)
- "NEW" badge or "+" indicator
- Task description shown below in italics

**Direction indicators (when in focus view):**
- Outbound nodes (files this imports): blue arrow indicator
- Inbound nodes (files that import this): amber arrow indicator

**Change status visual effects:**
- `added` / `planned_add`: green glow ring
- `modified` / `planned_modify`: orange glow ring
- `removed` / `planned_remove`: red glow, reduced opacity, line-through on name
- `in_progress_task`: pulsing blue ring animation
- `active`: brief pulse animation (5 seconds)

### 2. Custom Edge Component

**File to create:**
- `src/frontend/components/graph/edges/ImportEdge.tsx`

**Requirements:**
- Curved bezier path (not straight or stepped)
- Animated flow dots moving along the path showing import direction
- Edge label showing imported symbols (e.g. `{ broadcast, startServer }`)
- Label appears on hover or always for focused node's edges
- Color coding:
  - Regular import: semi-transparent blue (`rgba(59, 130, 246, 0.3)`)
  - Planned new import: dashed green with glow
  - Planned removal: thin red dashed
  - Active/in-progress: pulsing blue
- Thickness varies by number of imported symbols (1-4px range)
- Glow effect on hover

**Edge data interface:**
```typescript
// Edges currently use these style props:
{
  type: 'smoothstep',
  animated: true,
  style: { stroke: 'rgba(59, 130, 246, 0.3)', strokeWidth: 1.5 },
  label: 'broadcast, startServer',
  labelStyle: { fontSize: 9, fill: '#8b8b98' },
}
```

Replace `type: 'smoothstep'` with `type: 'importEdge'` and register the custom edge.

**SVG animation for flow dots:**
```svg
<circle r="3" fill="#3b82f6">
  <animateMotion dur="2s" repeatCount="indefinite">
    <mpath href="#edge-path" />
  </animateMotion>
</circle>
```

### 3. Register Custom Edge in MainCanvas

**File to modify:**
- `src/frontend/components/layout/MainCanvas.tsx`

Add edge type registration:
```typescript
const edgeTypes = {
  importEdge: ImportEdge,
};

// In ReactFlow component:
<ReactFlow edgeTypes={edgeTypes} ... />
```

### 4. Update Graph Builder Edge Creation

**File to modify:**
- `src/frontend/lib/graph-builder.ts`

Change all edge creation to use `type: 'importEdge'` instead of `type: 'smoothstep'`.

### 5. CSS Animations

**File to modify:**
- `src/frontend/styles/globals.css`

Add:
```css
/* Node glow animations */
@keyframes glow-pulse {
  0%, 100% { box-shadow: 0 0 8px var(--glow-color, rgba(59,130,246,0.2)); }
  50% { box-shadow: 0 0 20px var(--glow-color, rgba(59,130,246,0.4)); }
}

/* Edge flow animation */
@keyframes flow-dots {
  from { stroke-dashoffset: 20; }
  to { stroke-dashoffset: 0; }
}
```

## Visual Reference

**Target aesthetic:**
- Dark background (#0a0b10) with subtle dot grid pattern
- Nodes float in space with soft colored shadows
- Connections are curved lines with animated flowing dots
- Selected/focused elements glow brighter
- Non-focused elements dim slightly (depth of field effect)
- Everything feels "alive" — subtle animations, glows, pulses
- Professional quality — not a developer prototype

**Color palette:**
- Background: #0a0b10
- Surface: rgba(255, 255, 255, 0.03) with backdrop-blur
- Border: rgba(255, 255, 255, 0.08)
- TypeScript: blue (#3b82f6)
- JavaScript: yellow (#eab308)
- Python: green (#22c55e)
- Rust: orange (#f97316)
- Accent: #3b82f6 (blue)
- Success: #22c55e (green)
- Warning: #f59e0b (amber)
- Danger: #ef4444 (red)

## Technical Constraints

- Must use @xyflow/react v12 (ReactFlow) — NOT raw SVG
- Custom nodes are React components receiving `NodeProps` from ReactFlow
- Custom edges are React components receiving `EdgeProps` from ReactFlow
- Use `Handle` components from ReactFlow for connection points
- Wrap node components in `React.memo()` for performance
- Use Lucide React icons (`lucide-react` already installed)
- Use Tailwind CSS 4 for styling (already configured)
- The graph can have 5-40 visible nodes at a time

## Files for Reference

Read these files to understand the current implementation:
- `src/frontend/components/graph/nodes/FileNode.tsx` — current file node (rewrite this)
- `src/frontend/components/graph/nodes/PackageNode.tsx` — current package node
- `src/frontend/components/graph/nodes/SymbolNode.tsx` — current symbol node
- `src/frontend/lib/graph-builder.ts` — where nodes/edges are created (update edge types)
- `src/frontend/components/layout/MainCanvas.tsx` — where ReactFlow is rendered (register edge types)
- `src/frontend/styles/globals.css` — global styles and animations
- `docs/RESEARCH-NOTES.md` — research on visualization approaches
- `docs/GAP-ANALYSIS.md` — known visual issues

## Deliverables

1. Rewritten `FileNode.tsx` with glassmorphic styling, variable sizing, rich content
2. Rewritten `PackageNode.tsx` matching the same aesthetic
3. Updated `SymbolNode.tsx` matching the same aesthetic
4. New `ImportEdge.tsx` with curved paths, flow dots, and labels
5. Updated `MainCanvas.tsx` with edge type registration
6. Updated `graph-builder.ts` with `type: 'importEdge'` on all edges
7. Updated `globals.css` with new animations
8. The graph should look like it belongs in a professional product, not a hackathon demo
