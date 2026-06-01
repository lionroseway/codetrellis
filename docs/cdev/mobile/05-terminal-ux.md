# Terminal UX on Mobile

The terminal is the highest-impact mobile feature after plan
browsing. This doc covers the UX decisions.

## The use case

Developer is on the couch. Claude Code is running on the desktop.
The agent hits an ambiguity and asks a question. The developer
glances at their phone, sees the question, types "use the existing
parser", hits send. The agent continues.

This is not "run vim on your phone." It's **read-mostly, type when
needed.** The phone is a window into a terminal that's running on a
real computer.

## Rendering approach

Two options:

### Option A: Native RN terminal component

Build a custom React Native component that renders terminal output
as styled `<Text>` elements. Handle ANSI codes manually.

**Pros:** fully native, fast scrolling, no WebView overhead.
**Cons:** ANSI parsing is non-trivial (colours, cursor movement,
alternate screen buffer). Would need to build or find a library.

### Option B: xterm.js in a small WebView

Use the battle-tested xterm.js library in a WebView, same as the
desktop. Terminal output streams via the bridge.

**Pros:** correct rendering of everything (ANSI, cursor, alternate
screen). Same renderer as desktop — pixel-identical output.
**Cons:** WebView adds memory overhead. Bridge latency for high-
throughput output.

### Decision: Option B (xterm.js WebView) for v1

Correct rendering matters more than native feel for a terminal. A
WebView for one screen is fine. Can revisit with a native component
later if performance is an issue.

## Input UX

The phone keyboard is a poor terminal input device. Optimise for
the common case:

1. **Single-line input bar** at the bottom (like a chat app).
   User types, hits Send. A newline is appended automatically.

2. **Quick-reply suggestions** for common responses:
   - "yes" / "no" / "y" / "n" (detected from agent prompts)
   - "continue" / "skip" / "abort"
   - Custom suggestions from `await_user_input` options

3. **Special keys** row above the keyboard:
   - Tab, Escape, Ctrl+C, Ctrl+D, Up arrow, Down arrow
   - Configurable (user can add keys they use often)

4. **Paste** support — paste a path, a command, a code snippet.

What we do NOT build:
- Full terminal interaction (cursor movement, vi keybindings)
- Interactive TUI apps (they need a real keyboard)
- Resizing (fixed reasonable size, e.g. 80x24)

## Scrollback

When the user opens a terminal, the subscribe response includes the
last N lines of scrollback (e.g. 500 lines). This lets the user see
what happened before they opened the terminal, without streaming the
entire history.

New output appends at the bottom. The view auto-scrolls unless the
user has scrolled up (same as desktop behaviour).

## Multiple terminals

The terminal list shows all active terminals. The user taps one to
view it. Only one terminal is subscribed at a time (to save
bandwidth). Navigating away unsubscribes.

Badge on the terminal card shows "activity" if output arrived while
not viewing.
