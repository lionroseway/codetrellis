# Principles

The principles below cut across every part of the system. They are decision filters: when a feature is proposed, it is evaluated against these principles before any other consideration. Features that reinforce a principle proceed; features that weaken one are reconsidered.

## 1. CodeTrellis is an organising plane, not an AI runtime

CodeTrellis does not host inference, store agent working memory as a primitive, or provide a chatroom for agents. These belong to the runtime layer — the agent itself, hosted by whichever vendor the user chooses.

**In practice:**

- A feature proposal that requires CodeTrellis to perform inference is pushed back to the runtime.
- A feature proposal that asks CodeTrellis to provide a long-lived agent identity that accumulates state outside of git is pushed back to the runtime.
- Multi-agent chat, when wanted, is provided by an agent runtime; CodeTrellis observes and routes around it.

This principle keeps CodeTrellis agent-agnostic and prevents the product from becoming yet another opinionated agent runtime.

## 2. State lives in the user's git, not in CodeTrellis's walls

Every durable record — plans, decisions, specs, channel events, system documentation — is a file in the user's repository. CodeTrellis's database holds projection, cache, and personal working material, not the source of truth for collaborative state.

**In practice:**

- Anything that needs to be reviewed, audited, or shared with the team lives in the manifest.
- A new feature that introduces a new kind of durable record must define its place in the manifest before being built.
- Users can leave CodeTrellis at any time and retain everything that matters in a form they can already read.

This principle keeps lock-in low and makes the procurement story clean.

## 3. Customers bring their own AI

CodeTrellis does not resell inference, mark up tokens, or sit between the customer and their model provider. The customer's relationship with their model vendor is direct.

**In practice:**

- CodeTrellis never proxies an API call to a model vendor.
- The application configures access to the user's existing subscription rather than provisioning a new one.
- Pricing for CodeTrellis is independent of token usage.

This principle keeps cost control with the customer and avoids compliance churn around new AI vendor relationships.

## 4. Suppress context pressure at every layer

Every feature in CodeTrellis should reduce context pressure somewhere in the product loop: plan, inspect, or keep on track. Features that increase context pressure — adding new ambient signals an agent must attend to, expanding the scope of an agent's task, requiring an agent to hold more state — are rejected unless they replace something else that reduced more pressure.

**In practice:**

- Plans externalise intent so agents do not have to derive it.
- Channels externalise stuck conditions so the next agent inherits lean context.
- System documentation externalises architectural understanding so agents do not have to re-derive it from source.
- The product never accumulates "agent context" as a primitive that grows unboundedly.

This principle is the operationalisation of the core thesis.

## 5. Humans are first-class actors; agents are their tools — accountability is asymmetric, contribution is peer

Every action carries a human identity. Agents are attributed as the tool a specific human used. There is no notion of an autonomous agent with its own standing.

**Accountability rests with humans.** Agents acting on a human's behalf are recorded as such, never as the primary actor. Sign-off, approval, and decision authority all return to a named person.

**Contribution is peer.** In a [channel](08-agent-collaboration.md), both humans and agents can ask for help, weigh in on architecture decisions, and respond to others' requests. An agent that reads the dependency graph and offers a useful perspective is contributing substantively; a human providing direction is contributing substantively; both responses are first-class. The asymmetry is in *who is answerable for what ships*, not in *who is allowed to think alongside whom*.

This frame is what makes channels safe to use as a forum where teams (human + agent, equal contributors) work through hard problems and **arrive at architecturally sound decisions together**.

**In practice:**

- Every commit in the manifest has a named human author.
- Channel events carry the actor's identity in the foreground — whether the actor is a human or an agent — but decisions and approvals are recorded against the responsible human.
- Agents acting on a human's behalf are recorded as such, never as the primary actor.
- Multi-agent activity on a plan presents each contributor (human and agent) with their attribution, never collapses to "agents are doing things."

This principle makes audit trails sound, sign-off unambiguous, and the system legible to non-technical reviewers — while still allowing agents to participate as substantive contributors in the conversations that shape the work.

## 6. Adopt only what serves you; every layer is independently useful

CodeTrellis does not require users to commit to a single mode of working. Each layer of the product — visual observation, planning, system documentation, agent collaboration, team substrate, programmatic agent integration — is independently useful. Users adopt the layers that serve their current work and ignore the rest.

**In practice:**

- A user who only wants to see what is changing in their codebase can use CodeTrellis as a graph viewer without ever creating a plan.
- A user who plans extensively for large features but executes small changes by hand uses CodeTrellis only when the work warrants it.
- A team can adopt the planning workspace without the agent collaboration layer, or vice versa.
- A team can begin with the in-repo deployment shape and move to central oversight years later, without rewriting anything.
- Leaving CodeTrellis means keeping every artefact in a form already readable by other tools — git, markdown, JSON.

This principle is what makes adoption low-risk. The cost of trying CodeTrellis for one task is the cost of that one task; nothing escalates by default. The levels of adoption are described in [01 — Overview and Principles](01-overview.md#levels-of-adoption).

## Applying the principles

When a feature is being considered, the question is not "does this principle apply?" — the answer is always yes, all six apply. The question is whether the feature reinforces or weakens the principle, and what the user gains in exchange.

A feature that weakens one principle to strengthen another is sometimes the right call; a feature that weakens a principle without strengthening anything is not.

## A note on what is explicitly out of scope

The principles imply a set of non-goals. These are not capabilities the product is trying to grow into; they are deliberately excluded.

- Hosting inference, providing model access, or proxying calls to model vendors.
- Storing long-lived agent memory or "tribal knowledge" as a CodeTrellis-owned primitive.
- Acting as a chatroom for agent-to-agent free conversation.
- Operating as a walled-garden alternative to git for collaborative state.
- Performing autonomous actions that cross a human checkpoint without explicit configuration.

Each of these is a category of product. CodeTrellis is not that category. The product becomes weaker, not stronger, when it begins offering them as side features.
