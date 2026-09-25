# Next release — notes to carry

Material for the next version's release notes, written as outcomes. Fold it
into the notes when the release is cut (see the `codetrellis-release-notes`
skill), then delete this file.

## Fixed

- **Linux AppImage: agent connections now survive restarts.** The connector
  config CodeTrellis hands out now points at the `.AppImage` file itself
  instead of a temporary folder that changed every launch. Configs copied from
  0.1.16 or earlier on the AppImage point at that old folder: re-add
  CodeTrellis from **Settings → MCP Server** (Copy Claude Code command, Copy
  JSON, or Add to Claude Desktop…) once. If you move or rename the
  `.AppImage`, re-add it again.

## Anything they must do

- **AppImage users:** re-add CodeTrellis to your agents once, as above.

## Known limits (replace the 0.1.16 line about AppImage + portable)

- **Windows portable `.exe`:** an agent's connection starts only while
  CodeTrellis is open, and must be re-added after each update — the portable
  app runs from a temporary folder that exists only while it is open. Settings
  now says so where you copy the config. Use the Windows installer for agent
  work.
