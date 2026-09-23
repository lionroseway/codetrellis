/**
 * What CodeTrellis does, as a reference a person can browse.
 *
 * Content lives here as data, not JSX, for two reasons. It is long and it
 * will keep growing — this branch alone added budgets, ticket intake,
 * compare and playback, plan review and capability authorisation, none of
 * which any guide mentioned. And a test can walk data: `guide-content.test.ts`
 * asserts every tool named below is a tool that actually exists, which is
 * the failure the old MCP guide shipped with (it told people to call
 * `report_plan`, which has never existed).
 *
 * The `asks` are the point of the format. A guide that only describes a
 * feature leaves the reader to work out how to get it; a prompt they can
 * copy into their agent turns reading into doing, and it is how you
 * discover that the thing on the page is real.
 */

export interface GuideAsk {
  /** Paste-ready prompt for a connected agent. */
  prompt: string;
  /** Why this one is worth asking. */
  note?: string;
}

export interface GuideSection {
  id: string;
  /** Rail grouping. */
  group: string;
  /** Rail label — short. */
  label: string;
  title: string;
  /** One paragraph: what it is and why you would care. */
  blurb: string;
  points?: string[];
  asks?: GuideAsk[];
  /** MCP tools behind this surface. Checked against the real registry. */
  tools?: string[];
}

export const GUIDE_GROUPS = [
  'Getting started',
  'Seeing your codebase',
  'Planning and work',
  'Collaboration',
  'Governance',
  'Reach',
] as const;

export const GUIDE_SECTIONS: GuideSection[] = [
  // ── Getting started ──────────────────────────────────────────────
  {
    id: 'what-this-is',
    group: 'Getting started',
    label: 'What this is',
    title: 'A map of your codebase, and a record of what agents do to it',
    blurb:
      'CodeTrellis watches a project and draws how it hangs together — packages, files, symbols, and the '
      + 'HTTP and SQL couplings that imports never show. On top of that map it holds plans: what someone '
      + 'intends to change, item by item, anchored to real files. Agents connect over MCP, and everything '
      + 'they do shows up against the plan while they do it.',
    points: [
      'It does not host the agent. Claude Code, Codex, Cursor and Claude Desktop all connect to it; it is the surface they work against.',
      'Plans live in your repository under .codetrellis/, so they travel with the code and review like code.',
      'Nothing here needs a plan. Click + in the top bar to open any project on disk, leave it open, and code as normal — yours, an agent\'s, anyone\'s edits update the graph live. That is the lightest way to use it.',
    ],
    asks: [
      {
        prompt: 'Give me a tour of this project using CodeTrellis: what the main parts are, how they depend on each other, and where you would be careful.',
        note: 'A good first thing to try once an agent is connected — and it shows what these copy buttons are for.',
      },
    ],
  },
  {
    id: 'connect-agent',
    group: 'Getting started',
    label: 'Connect an agent',
    title: 'Point your coding agent at this desktop',
    blurb:
      'CodeTrellis runs a local MCP server. Copy the config into your agent, restart it, and it appears in '
      + 'the top bar. Any MCP-capable client works — there is nothing Claude-specific about it.',
    points: [
      'The copied config runs the CodeTrellis connector: a small local command your agent launches, which finds this app by itself. Nothing secret goes in the config, and it keeps working when CodeTrellis restarts.',
      'Claude Code: Settings → MCP Server → Copy Claude Code command. Claude Desktop: paste the JSON into claude_desktop_config.json under mcpServers and restart it. Cursor: ~/.cursor/mcp.json.',
      'Easiest: "Copy agent instructions" and paste them into your agent, and it sets itself up. They contain no secret.',
      'A direct connection (a URL plus this launch\'s token) is still in Settings for clients that can only take a URL. It stops working whenever CodeTrellis restarts.',
    ],
    asks: [
      {
        prompt: 'Read the CodeTrellis skill guide and tell me what it can do for this project.',
        note: 'The fastest way to check the connection works and to get the agent oriented.',
      },
    ],
    tools: ['register_session', 'get_app_guide'],
  },
  {
    id: 'agent-permissions',
    group: 'Getting started',
    label: 'What agents may do',
    title: 'Connecting an agent does not hand it everything',
    blurb:
      'Tools are authorised individually. Reading and editing plans, opening projects and reading plan files '
      + 'are on by default. Running commands, reading your screen or clipboard or microphone, and changing '
      + 'desktop settings are off until you turn them on in Settings → MCP Server.',
    points: [
      'A refused tool tells the agent which capability it needs, so it can ask you rather than retry.',
      'Grants are per installation, not per agent — one toggle covers every client on this machine.',
      'Tools that take a project path are limited to projects you have opened. That is not a sandbox: an agent can still open a project, but you will see the tab appear.',
    ],
    asks: [
      {
        prompt: 'What CodeTrellis capabilities do you currently hold, and what would you need me to enable to run commands?',
        note: 'Good first question — it tells you what your agent can actually reach.',
      },
    ],
  },

  // ── Seeing your codebase ─────────────────────────────────────────
  {
    id: 'graph',
    group: 'Seeing your codebase',
    label: 'The graph',
    title: 'Clusters, files, symbols',
    blurb:
      'The canvas draws your project at three depths. Clusters group related files into the things people '
      + 'actually talk about; Files shows the import graph; Symbols opens a focused file into its functions '
      + 'and types. Edges are real imports, resolved per language.',
    points: [
      'Eleven languages parse: TypeScript, JavaScript, Python, Rust, PHP, Java, Go, Ruby, C#, Kotlin and Swift.',
      'SQL is handled separately — table reads and writes are found in string literals in any language.',
      'Click a node to inspect it; the inspector shows dependencies both ways.',
    ],
    asks: [
      {
        prompt: 'Show me the architecture of this project — the main clusters and how they depend on each other.',
      },
      {
        prompt: 'What depends on the file I have open, and what does it depend on?',
        note: 'The question that decides whether a change is small or not.',
      },
    ],
    tools: ['check_architecture', 'search_symbols', 'get_dependencies', 'graph_focus', 'graph_set_depth'],
  },
  {
    id: 'cross-system',
    group: 'Seeing your codebase',
    label: 'Cross-system map',
    title: 'The couplings imports never show',
    blurb:
      'Services talk over HTTP and SQL, not imports, so a dependency graph misses the connections that break '
      + 'production. CodeTrellis extracts route declarations and outbound calls per language and pairs them '
      + 'across your whole estate — a Kotlin client calling a C# controller shows up as an edge.',
    points: [
      'Pairing is exact on METHOD and path. Two services that spell a route differently will not pair, and near misses are reported separately so you can see why.',
      'SQL table reads and writes are found the same way, giving you which services touch which tables.',
    ],
    asks: [
      {
        prompt: 'List the cross-system edges in this project — which services call which, and which tables they touch.',
      },
    ],
    tools: ['list_cross_system_edges', 'check_conformity'],
  },
  {
    id: 'trellis-modes',
    group: 'Seeing your codebase',
    label: 'Trellis modes',
    title: 'Live, Baseline, Planned, Diff',
    blurb:
      'Four views of the same map. Live is the working tree as it is now. Baseline is a point you pinned. '
      + 'Planned overlays what a plan intends to change. Diff shows the difference between any two points you '
      + 'pick — a checkpoint, a commit, the baseline, or the working tree.',
    points: [
      'Checkpoints are named moments you capture yourself, useful before a risky change.',
      'A commit contributes its file list only; comparing against a checkpoint also compares edges.',
    ],
    asks: [
      {
        prompt: 'Capture a checkpoint called "before refactor", then tell me what changes once I am done.',
      },
    ],
    tools: ['capture_checkpoint', 'list_comparands', 'compare_snapshots'],
  },
  {
    id: 'code-view',
    group: 'Seeing your codebase',
    label: 'Reading code',
    title: 'Code mode, and tracing a change back to why',
    blurb:
      'Code mode reads a file beside the file tree, with the graph unmounted so nothing is competing for the '
      + 'machine. Lines git sees as changed are marked in the gutter — green for added, amber for modified, '
      + 'the whole file green when it is new. Above the source, any plan item that declared this file says so '
      + 'and what it means to do to it.',
    points: [
      'The intent is named: new file, modify, rewrite or delete.',
      'Click that row and the plan item opens, so you can get from a line of code to the reason it is changing.',
      'Diff compares the file against any point in the project history; Timeline plays the project forward.',
    ],
    asks: [
      {
        prompt: 'Which plan items touch the file I am looking at, and what are they supposed to do to it?',
      },
    ],
  },

  // ── Planning and work ────────────────────────────────────────────
  {
    id: 'plans',
    group: 'Planning and work',
    label: 'Plans',
    title: 'Objects carry context, Actions carry work',
    blurb:
      'A plan is a tree of two kinds of thing. Objects are pages — background, decisions, acceptance criteria. '
      + 'Actions are work items with a status, anchored to files and symbols so the plan can be checked against '
      + 'what actually happened. They nest freely.',
    points: [
      'Plans are written to .codetrellis/ in your repo, so they commit, branch and review like code.',
      'Anchoring an Action to real files is what makes review possible later. An Action with no targets can only be marked done on trust.',
      'Templates scaffold the common shapes — feature, bug fix, migration, performance pass.',
      'Plans are not set in stone. Edit from the plan panel mid-flight, or ask the agent to revise it based on what you have both learned.',
      'Export writes the plan to <project>/.codetrellis/plans/<slug>/ as YAML and markdown. Commit it, pull on another machine, and CodeTrellis reads it back.',
    ],
    asks: [
      {
        prompt: 'Create a plan for the change we just discussed. Break it into actions and anchor each one to the files it will touch.',
        note: 'The main way plans get made — you describe, the agent structures it.',
      },
      {
        prompt: 'Suggest file and symbol anchors for the actions in this plan that do not have any.',
      },
      {
        prompt: 'Scope crept — revise this plan to match what we have actually decided, and tell me what you changed.',
        note: 'Plans are meant to be edited. A plan nobody updates stops describing the work.',
      },
    ],
    tools: ['create_plan', 'add_item', 'bulk_add_items', 'suggest_specs', 'list_plan_templates', 'create_plan_from_template'],
  },
  {
    id: 'working',
    group: 'Planning and work',
    label: 'Working a plan',
    title: 'Claim, progress, gates, handoff',
    blurb:
      'Agents take work rather than being assigned it. An agent asks for the next claimable Action, claims it, '
      + 'reports progress as it goes, and marks it done. Approval gates hold an item until a human clears it.',
    points: [
      'Claiming is atomic, so two agents on the same plan do not collide.',
      'Blocked items say why, which beats an agent stalling silently.',
      'Handoff serialises a plan or item into a prompt you can paste into a fresh agent when context runs out.',
      'Name the area in your prompt — "work the next task on the auth rework" — rather than leaving the agent to choose. It picks better work when you tell it where to look.',
      'When an agent\'s context fills, or you switch machines, clear the chat and tell it to re-read the plan. The plan is the memory, so it picks up where the last one stopped.',
    ],
    asks: [
      {
        prompt: 'Take the next item on this plan, do it, and report progress as you go.',
      },
      {
        prompt: 'Give me a handoff prompt for this plan so I can continue in a new session.',
        note: 'For when an agent runs out of context mid-plan.',
      },
      {
        prompt: 'Re-read the plan and tell me where we got to, then carry on from there.',
        note: 'What to say after clearing a full context, or on a different machine.',
      },
    ],
    tools: ['get_next_item', 'claim_item', 'update_item_progress', 'set_item_blocked', 'list_criteria', 'submit_criterion', 'copy_plan_as_prompt'],
  },
  {
    id: 'review',
    group: 'Planning and work',
    label: 'Review and PR',
    title: 'Did we do what we said we would?',
    blurb:
      'Review compares the plan against what actually changed, item by item: what landed, what is still missing, '
      + 'and which changed files no item ever claimed. The PR draft turns that into a description with the '
      + 'tickets and the review folded in.',
    points: [
      'Read-only. CodeTrellis never commits or opens the PR — your agent does that with its own credentials.',
      'Unclaimed changes are the interesting column: they are the work nobody planned.',
    ],
    asks: [
      {
        prompt: 'Review this plan against my working tree and tell me what is missing and what I changed that was not planned.',
      },
      {
        prompt: 'Write the PR description for this plan.',
      },
    ],
    tools: ['review_plan', 'get_pr_draft'],
  },
  {
    id: 'tickets',
    group: 'Planning and work',
    label: 'Tickets',
    title: 'Start from Jira, Linear or GitHub — and write back',
    blurb:
      'Import an epic and its children as a plan, keeping the ticket keys. As item statuses move, CodeTrellis '
      + 'tells you which tickets have drifted so your agent can write the transitions back with its own tracker '
      + 'tools.',
    points: [
      'Re-importing the same epic updates the plan rather than making a second one.',
      'Reading the sync state does not advance the watermark — an agent that read the list and then failed to write would otherwise lose those transitions silently.',
    ],
    asks: [
      {
        prompt: 'Import this epic from our tracker as a CodeTrellis plan, keeping the ticket keys.',
      },
      {
        prompt: 'Which tickets on this plan have moved since we last synced? Write the transitions back.',
      },
    ],
    tools: ['create_plan_from_external', 'get_external_sync_state', 'mark_external_synced', 'set_plan_external_ref'],
  },

  // ── Collaboration ────────────────────────────────────────────────
  {
    id: 'channels',
    group: 'Collaboration',
    label: 'Channels',
    title: 'Where an agent asks, and a human answers',
    blurb:
      'A channel is the conversation attached to a plan. An agent raises a question, a decision it needs made, '
      + 'or a blocker; you answer in the app or from your phone. Events can be anchored to a specific item, so '
      + 'the question arrives with its context.',
    points: [
      'Threads resolve, so a plan carries a record of what was decided and why.',
      'A stuck agent that posts a blocker is visible; one that silently retries is not.',
    ],
    asks: [
      {
        prompt: 'If you get stuck or need a decision from me, post it to the plan channel rather than guessing.',
        note: 'Worth saying up front — it changes how an agent behaves when it hits ambiguity.',
      },
    ],
    tools: ['post_channel_event', 'list_channel_events', 'get_channel_thread', 'resolve_channel_event'],
  },
  {
    id: 'system-docs',
    group: 'Collaboration',
    label: 'System docs',
    title: 'The written architecture, kept honest',
    blurb:
      'System docs are markdown that lives with the project and describes how something works. CodeTrellis '
      + 'tracks whether a doc has gone stale against the code it describes, so the architecture you wrote down '
      + 'and the architecture you have do not drift apart unnoticed.',
    points: [
      'Docs are verified against the files they claim to describe.',
      'Freshness is reported, not enforced — a stale doc is a prompt to look, not an error.',
    ],
    asks: [
      {
        prompt: 'Write a system doc for this service describing how it works and what it talks to.',
      },
      {
        prompt: 'Which system docs have gone stale against the code?',
      },
    ],
    tools: ['list_system_docs', 'read_system_doc', 'write_system_doc', 'check_doc_freshness', 'verify_system_doc'],
  },
  {
    id: 'presence',
    group: 'Collaboration',
    label: 'Presence',
    title: 'An agent showing you something, live',
    blurb:
      'An agent can put something in front of you and wait — a question, a choice, a walkthrough of what it is '
      + 'about to do. Useful when the agent needs a person before it goes further.',
    asks: [
      {
        prompt: 'Walk me through what you are about to change, and wait for me to confirm before you start.',
      },
    ],
    tools: ['present', 'await_ack', 'await_user_input', 'dismiss_presence'],
  },

  // ── Governance ───────────────────────────────────────────────────
  {
    id: 'budgets',
    group: 'Governance',
    label: 'Budgets',
    title: 'What this plan has cost so far',
    blurb:
      'CodeTrellis measures wall-clock time per turn and prices it when an agent reports a model it knows. '
      + 'Set a ceiling on a plan and an agent can check before starting more work.',
    points: [
      'Advisory. Nothing halts an agent — pretending otherwise would be worse than honest advice.',
      'Unknown cost stays unknown rather than becoming a confident zero: an agent that never reported a model has no price.',
      'The figure says which price table produced it, so an old number cannot read as a fresh one.',
    ],
    asks: [
      {
        prompt: 'Set a budget of 2 hours on this plan, and check it before you start each item.',
      },
      {
        prompt: 'What has this plan cost so far, and what is the forecast to finish?',
      },
    ],
    tools: ['set_budget', 'check_budget', 'get_budget'],
  },
  {
    id: 'drift',
    group: 'Governance',
    label: 'Drift and freezes',
    title: 'When reality moves away from the plan',
    blurb:
      'Drift is the gap between what a plan said and what the code does. CodeTrellis reports it rather than '
      + 'blocking on it. A freeze locks a repository during a release, with per-plan exemptions.',
    asks: [
      {
        prompt: 'Where has this project drifted from its plans?',
      },
    ],
    tools: ['get_drift_report', 'get_deviations', 'detect_deviations', 'get_freeze_status', 'set_freeze'],
  },
  {
    id: 'history',
    group: 'Governance',
    label: 'History',
    title: 'Plans are in git, so they have a history',
    blurb:
      'Because plans live in the repository, you can read a plan as it stood at any commit, diff a plan between '
      + 'two commits, and see who changed which plans. Merge conflicts in a plan can be resolved field by field '
      + 'rather than by hand-editing YAML.',
    asks: [
      {
        prompt: 'How has this plan changed over the last week, and who changed it?',
      },
    ],
    tools: ['get_plan_history', 'get_plan_at_commit', 'diff_plan_between_commits', 'get_team_activity', 'detect_conflicts', 'resolve_conflict'],
  },

  // ── Reach ────────────────────────────────────────────────────────
  {
    id: 'terminals',
    group: 'Reach',
    label: 'Terminals',
    title: 'Agent-driven shells you can watch',
    blurb:
      'An agent can create a terminal, type into it and read the output back, with you watching it happen. '
      + 'This needs the terminal capability, which is off until you turn it on.',
    points: [
      'Scrollback is command output and routinely holds secrets, so reading a terminal needs the same grant as driving one.',
    ],
    asks: [
      {
        prompt: 'Run the test suite in a CodeTrellis terminal so I can watch it, and tell me what fails.',
      },
    ],
    tools: ['terminal_create', 'terminal_write', 'terminal_read', 'terminal_kill'],
  },
  {
    id: 'mobile',
    group: 'Reach',
    label: 'Phone',
    title: 'Steer from your phone',
    blurb:
      'The desktop pairs with a companion app over a direct peer connection — no server in the middle. Review a '
      + 'plan, answer an agent that is waiting on you, or watch a terminal from wherever you are.',
    points: [
      'Pairing is a deliberate act with a confirmation code, and a paired device gets its own capabilities.',
      'Remote access is off by default and is a separate switch from discovery.',
    ],
    asks: [
      {
        prompt: 'Show the plan review on my phone.',
      },
    ],
    tools: ['list_paired_devices', 'get_peer_status', 'mobile_present', 'mobile_navigate'],
  },
];
