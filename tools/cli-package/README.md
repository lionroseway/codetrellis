# codetrellis

The command line for [CodeTrellis](https://codetrellis.dev): CodeTrellis for agents, scripts and CI, without the desktop app.

```sh
npx codetrellis check          # does this change follow your rules?
npm install -g codetrellis     # or install the command for good
```

Needs Node 22 or later.

## What it does

- **Run CodeTrellis headless.** `codetrellis start`, `serve`, `stop`, `scan`, and `mcp`, the connector an agent's MCP config launches.
- **Keep an agent on track.** `next`, `claim`, `update`, `stuck`, `done`, `request`, `brief`, `awareness`.
- **Check the work.** `codetrellis check` runs your rulebook against a change and exits 3 when it breaks a rule, for any CI. It also writes SARIF, and runs your pipeline with `check --pipeline`.
- **Agent reviews.** `codetrellis review` has your own agent review a change. `review verify` checks its signed review in CI.
- **Get the desktop app.** `codetrellis desktop install` downloads the app for this computer and checks it against the release's signed checksums before opening it. `codetrellis desktop url` prints the link.

`codetrellis --help` lists every command and flag.

## Docs

- The CLI: [docs/claude/cli.md](https://github.com/lionroseway/codetrellis/blob/main/docs/claude/cli.md)
- Rules and checks: [docs/claude/rules.md](https://github.com/lionroseway/codetrellis/blob/main/docs/claude/rules.md)
- CI recipes: [docs/recipes](https://github.com/lionroseway/codetrellis/tree/main/docs/recipes)

Apache-2.0.
