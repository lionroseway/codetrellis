# UI Design

## Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  TopBar: [Project Name] [Agent Status] [Depth: Pkg|File|Symbol] │
├────────┬─────────────────────────────────┬───────────────────────┤
│        │                                 │                       │
│  Side  │                                 │     Inspector         │
│  bar   │     Main Graph Canvas           │     Panel             │
│        │     (ReactFlow)                 │                       │
│  File  │                                 │  - Node details       │
│  Tree  │     Interactive mind-map        │  - Dependencies       │
│  +     │     of codebase architecture    │  - Code preview       │
│  Pkgs  │                                 │  - Symbol list        │
│        │                                 │                       │
│        ├─────────────────────────────────┤                       │
│        │  Agent Panel (collapsible)      │                       │
│        │  Plan | Timeline | Changes      │                       │
├────────┴─────────────────────────────────┴───────────────────────┤
│  StatusBar: [Scan Status] [Files: 234] [MCP: Connected] [Agent] │
└──────────────────────────────────────────────────────────────────┘
```

## Panels

### Sidebar (left, resizable, ~250px default)
- **Project tree**: Hierarchical file/package browser
- Package grouping for monorepos
- File icons by language
- Badges showing symbol count per file
- Click to focus node in graph
- Search/filter input at top

### Main Canvas (center)
- **ReactFlow** interactive graph
- Custom node types with distinct visual styles:
  - **Package**: Rounded rectangle, bold, shows dependency count
  - **File**: Rectangle with language icon, shows symbol count
  - **Class**: Blue-tinted, shows method count, expandable
  - **Function**: Green-tinted, shows signature on hover
  - **Interface/Type**: Purple-tinted, dashed border
- Edge styles:
  - **Import**: Dashed line, arrow
  - **Call**: Solid line, arrow
  - **Extends/Implements**: Dotted line, hollow arrow
  - **Package dependency**: Thick solid line
- Controls: Minimap, zoom buttons, fit-to-view, fullscreen
- Filter bar: language, change status, package scope

### Inspector Panel (right, resizable, ~300px default)
- Shows details of selected node
- **For files**: path, language, size, symbol list, imports/exports
- **For classes**: methods, properties, extends/implements
- **For functions**: signature, parameters, callers, callees
- Code preview (Monaco editor, read-only, syntax highlighted)
- Dependency list (what this node depends on / what depends on it)

### Agent Panel (bottom, collapsible, ~200px default)
Three tabs:
1. **Plan**: Shows current agent plan as a checklist with step status
2. **Timeline**: Chronological event log with timestamps
3. **Changes**: File change list with before/after indicators

### Top Bar
- Project name + path
- Agent connection status indicator (green dot = connected)
- Depth selector: Package | File | Symbol (radio group)
- Symbol search (global, uses FTS5)
- Settings gear

### Status Bar
- Scan progress/status
- File count + symbol count
- MCP server status (port, connected agents count)
- Active agent indicator

## Theme

### Dark Theme (default)
- Background: `#0a0a0b` (near black)
- Surface: `#141416` (panels)
- Border: `#27272a` (zinc-800)
- Text primary: `#fafafa` (zinc-50)
- Text secondary: `#a1a1aa` (zinc-400)
- Accent: `#3b82f6` (blue-500)
- Success: `#22c55e` (green-500, added nodes)
- Warning: `#f59e0b` (amber-500, modified nodes)
- Danger: `#ef4444` (red-500, removed nodes)
- Info: `#8b5cf6` (violet-500, agent activity)

### Node Colors (in graph)
- Package: `#1e40af` bg, `#3b82f6` border (blue)
- File: `#1c1c1e` bg, `#3f3f46` border (neutral)
- Class: `#1e3a5f` bg, `#60a5fa` border (light blue)
- Function: `#1a3a2a` bg, `#4ade80` border (green)
- Interface: `#2e1a4a` bg, `#a78bfa` border (purple)

### Agent Overlay Colors
- Active file pulse: `#8b5cf6` glow animation (violet)
- Added: `#22c55e` border + fill opacity
- Modified: `#f59e0b` border + fill opacity
- Removed: `#ef4444` border + strikethrough

## Interactions

- **Click node**: Select, show in inspector
- **Double-click node**: Expand/collapse children
- **Right-click node**: Context menu (focus, hide, show deps only)
- **Drag**: Pan canvas
- **Scroll**: Zoom
- **Cmd+F**: Global symbol search
- **Cmd+O**: Open project
- **Cmd+1/2/3**: Switch depth (package/file/symbol)
- **Escape**: Deselect, close panels

## Responsive Behavior
- Panels can be collapsed to maximize canvas
- Minimap auto-hides when graph fits in viewport
- Inspector shows condensed view when narrow
- Agent panel auto-expands when agent connects
