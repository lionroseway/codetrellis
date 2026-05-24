# AI in Collaboration

This document describes the layer where AI agents become participants in human conversation about the work — not just executors of it. The foundation pieces exist today; the meeting-aware extensions are the target.

## Why this layer exists

Three converging arguments shape this layer.

**AI accountability through presence.** If AI agents are writing meaningful percentages of the code, they cannot be invisible during the conversations that shape what gets built. They have to be in the room — attributed, auditable, occasionally consulted — for the team to know what is being decided and why. AI presence is the mechanism through which AI work becomes trustworthy.

**Learning which models suit which decisions.** Teams cannot develop intuition for model selection if the models are always backstage. Bringing them into conversations makes their reasoning legible. Over time, the team learns "the bigger model is worth it for system-design discussions, the faster one for routine clarifications" — empirically, not by guesswork.

**Removing dual-maintenance friction.** Today, talking through an architecture with a teammate and then separately writing it down in CodeTrellis is two acts of the same work. With AI present in the conversation, the talking and the writing-down can collapse: the agent captures decisions, drafts plan updates, proposes documentation changes — all subject to human review before anything is committed.

## What exists today (foundation)

The collaboration layer already has the pieces needed for AI presence in front of one user:

- **The Presence Pane** ([08 — Agent Collaboration](08-agent-collaboration.md)): floating overlay with markdown narration cards, TTS via the system speech engine, text reply via `await_user_input`, optional acknowledgment gates. Already built, already used.
- **UI navigation tools** ([10 — Integration Model](10-integration-model.md)): the agent can drive the graph (`graph_focus`, `graph_set_mode`, `graph_select`), open plans and items (`select_item`, `open_plan`), take screenshots, control the terminal — all in service of walking the user through what it's explaining.
- **AI-led walkthroughs**, demonstrated and working: the agent narrates in the Presence Pane while using UI tools to focus the graph, highlight files, and step through a subsystem. The audience watches the screen or a synced view and follows along.

This is the in-front-of-one-user case, working today. The team and meeting extensions build on the same foundation.

## What the target adds

The target extension adds **audio context** so the agent can participate in conversations beyond a single user typing into the Presence Pane.

| Capability | What it does |
|---|---|
| **Audio capture** | CodeTrellis captures audio from the system microphone *and* from a system-audio loopback (so audio from Zoom, Meet, Teams, or any other conference platform flows in through the same pipeline). One mechanism for in-person and remote meetings. |
| **Rolling buffer in memory** | The most recent N seconds of audio are held in memory so when the user prompts the AI, the agent has the immediate context. The buffer never persists. |
| **Prompt-on-invocation** | The user invokes the AI explicitly — button or hotkey. No wake word, no always-on transcription. The agent listens and responds only when called. |
| **Audio routed to the user's AI via MCP** | When the user invokes the agent, the recent audio chunk plus the user's prompt is delivered to the user's chosen AI runtime via MCP. The agent (multi-modal models can take audio directly) handles transcription and understanding itself. CodeTrellis never transcribes. |
| **Response surfaces in the Presence Pane** | The agent's response appears as a Presence Pane card with TTS — same surface as today's walkthroughs. The agent can use UI navigation tools mid-response to walk through what it's explaining. |

The user experience is: someone in the meeting asks "can you show us how the payment service is structured?", the user presses the hotkey and asks the agent, the agent receives the last N seconds of audio plus the question, responds via the Presence Pane (often with a walkthrough using the graph), and the conversation moves on.

## What gets recorded

**Nothing from the meeting is durable by default.** The audio buffer never persists. Presence Pane cards are ephemeral. The agent's responses live for the moment.

What becomes durable is **what the human explicitly asks the agent to record**. If the team reaches a decision and someone says "agent, add that as a decision on the auth-refactor plan," the agent uses the existing MCP tools (`add_item`, `add_item_comment`, `post_decision` in target form, `propose_doc_update`) to act on the manifest. Those actions follow the normal CodeTrellis flow — attributed, reviewable, committable.

This is the move that keeps meeting AI ethically clean. The conversation isn't recorded. The decisions are.

## Speaker recognition

Knowing who said what is genuinely useful — it makes attributions correct and helps the team learn from each conversation. But speaker diarization is real ML, and CodeTrellis doesn't host ML.

Two paths for getting speaker labels, both BYO:

- **Multi-modal AI handles it.** Modern multi-modal models can sometimes infer the speaker from audio characteristics. Quality varies; this is a path that improves with the models, without us building anything.
- **External tool via MCP.** A user with a transcription / diarization service already running locally (Whisper-based or similar) pipes labelled transcripts to CodeTrellis via MCP. We consume the labels, we don't generate them.

For v1, the capability ships without explicit speaker labels and the agent does its best with the raw audio. If quality is insufficient, a BYO path is added later.

## Privacy and trust posture

The defaults are conservative:

- **Audio is captured only when meeting mode is on.** A clear UI indicator shows when the microphone or system audio is being captured. The OS permission prompt is the user's first confirmation.
- **The buffer never persists.** Even crash recovery does not preserve audio.
- **Audio leaves the machine only when the user invokes the agent.** When the user presses the hotkey, the buffered audio is sent to the user's chosen AI runtime — under their existing subscription, with their existing data-handling terms.
- **No audio is sent to CodeTrellis servers.** CodeTrellis is the capture and routing layer; the AI is somewhere else (the user's runtime). We do not see or store the audio.
- **Secrets the user reads aloud are at the same risk level as in any meeting.** This is a meeting tool; users should not read passwords or credentials into any meeting tool. We surface no audio storage, so the risk is bounded to what the user's AI vendor sees and stores.

## How AI invocation works

For v1: a **push-to-talk button or hotkey**. The user presses, optionally types a prompt (or speaks one, captured in the same buffer), and releases. The agent receives the buffered context and the prompt, responds.

A future "raise hand" mode (silent UI signal, never an audible interjection) could let the agent indicate it has noticed something worth surfacing. The user decides whether to pull on that thread. This is deferred — explicit invocation is the v1 mode.

## How AI presence shapes the room

When AI is present in a conversation rather than reading the transcript afterwards, three things change:

- **The reasoning is legible.** The team hears why the agent thinks what it thinks, can push back in real time, and can decide whether to accept the agent's framing.
- **The decision lands cleanly.** Instead of "the agent did X, then in the next meeting we discussed it," the meeting is where the decision is made, with the agent's input as one voice among the team's.
- **Trust accumulates per-model.** The team learns which models give useful input and which don't, in which kinds of conversations. Model selection becomes empirical.

This is the audit-through-presence argument made concrete. The room is the audit trail. The Presence Pane card is the receipt.

## Level 7 in adoption

This layer is **Level 7** in the [Levels of Adoption](01-overview.md#levels-of-adoption). It's optional like every other level — teams running AI agents on coding work but not bringing them into meetings just don't enable it. Teams that do enable it get a new mode of working without changing anything about how the foundation behaves.

It builds directly on Levels 4 (agent collaboration), 6 (programmatic agent integration), and the Presence Pane infrastructure shipped at lower levels. The meeting-aware capabilities are the new pieces; everything else is reuse.
