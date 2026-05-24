# Deployment Shapes

The state model supports three deployment shapes. Organisations choose the shape that fits their size, structure, and oversight requirements. The same underlying machinery serves all three; migration between shapes is a git operation, not a product migration.

## Shape 1: In-repo

A `.codetrellis/` directory inside the code repository.

- **Best for:** single-repo teams, small projects, open-source projects, individual developers.
- **Setup:** zero. Clone the repo, open it in the application, the manifest is already there.
- **Properties:** completely self-contained. Everyone who can clone the code can see the plans. Plan changes ride on the same review process as code.

This is the default and the simplest. Most projects start here.

## Shape 2: Home-and-link

A plan lives in the repository where most of the work happens (its "home"). Other repositories carry pointers in their `.codetrellis/external/` that say "this work is part of plan X, hosted in repository Y."

- **Best for:** small teams working across a handful of repositories.
- **Setup:** designate a home for each cross-repo plan; create pointer files in the related repositories.
- **Properties:** each repository's `.codetrellis/` stays self-contained. Editing happens in the home repo. Viewing is stitched together by the application when the user has multiple repos cloned locally. When the home repo is not present, the user sees a placeholder.

This shape avoids distributed-edit chaos while still representing work that spans multiple codebases.

## Shape 3: Central oversight

A dedicated planning repository (for example, `org/cdev-plans`) holds plans for the entire organisation. Code repositories optionally carry lightweight pointers back.

- **Best for:** larger organisations, environments with formal oversight requirements, situations where leadership needs a single surface to see everything in flight.
- **Setup:** create the planning repository, configure repositories that should appear in it, set access controls.
- **Properties:** one location to read for organisation-wide visibility. Existing access controls on the planning repository serve as the permission model. The manifest is centralised; the pantry stays distributed, so leadership sees the structure of every plan without needing access to every team's private working materials.

The central-oversight shape provides a strong security and audit posture: the boundary between "what the organisation should see" and "what stays with the team" is enforced at the storage layer, not by application logic.

### Worked example

A four-repo setup using the same machinery that powers Shape 2:

```
org/cdev-plans            # planning repo (Shape 3 hub)
├── .codetrellis/
│   ├── config.json        ──┐  { "repoRole": "planning" }
│   └── plans/             ──┘  canonical plans, one dir per plan
│       ├── ship-2fa-<uid>/
│       │   ├── plan.yaml        # scope: [api-svc, web-app, mobile-app]
│       │   └── items/...

org/api-svc               # code repo
├── .codetrellis/
│   ├── config.json        ──┐  { "repoRole": "code" }
│   └── external/          ──┘  pointer files only
│       └── ship-2fa-<uid>.yaml  # planUid + homeRepo

org/web-app               # code repo
├── .codetrellis/
│   ├── config.json        ──┐  { "repoRole": "code" }
│   └── external/          ──┘
│       └── ship-2fa-<uid>.yaml

org/mobile-app            # code repo
├── .codetrellis/
│   ├── config.json        ──┐  { "repoRole": "code" }
│   └── external/          ──┘
│       └── ship-2fa-<uid>.yaml
```

**Setup steps (real commands):**

1. **Create the planning repo.** `git init org/cdev-plans` and commit a `.codetrellis/config.json` with `{"repoRole": "planning"}`.
2. **Open it in CodeTrellis** and author a plan — the plan picks up the planning repo's origin URL as its `homeRepo` automatically (Phase 3.3).
3. **Scope to the participating code repos.** From the planning side, call `add_plan_scope` for each code repo's origin URL, passing the local clone path as `pointer_project_root`. This writes the pointer file into each repo's `.codetrellis/external/`.
4. **Each code repo opts in.** In each `org/<code-repo>`, commit `.codetrellis/config.json` with `{"repoRole": "code"}`. This softens the "no plans here yet" copy in the app and signals to the team that plans live elsewhere.
5. **Commit and push.** The pointer files travel via normal PR review. Any teammate who clones a code repo sees the cross-repo plan in the stitched view as soon as they also clone (or have already cloned) the planning repo.

**Permission model:** access to the planning repo is access to the canonical plans. Access to a code repo carries only the pointer — title, status, the human-readable contribution note. A reviewer-only role can be granted to leadership by giving read access to `org/cdev-plans` without granting any code-repo access at all.

**Why this works without special-case code:** the central-oversight shape is what the Phase 3.3 + 3.5 mechanisms already produce when you compose them. No new transport. No new ACL layer. The hub is a normal CodeTrellis project that happens to have a `repoRole: "planning"` hint and no source code; the spokes are normal CodeTrellis projects that happen to have a `repoRole: "code"` hint and an `.codetrellis/external/` directory. The deployment shape is a documentation pattern over the existing primitives.

The `repoRole` hint is **advisory** — nothing is gated on it. Treat it as a label that helps the app and your teammates read the room. A repo with no hint behaves identically to one tagged `"mixed"`: plans and code coexist there.

## Choosing a shape

| Question | Suggests |
|---|---|
| Is everything in one repository? | In-repo |
| Are there a small number of repositories that touch each other frequently? | Home-and-link |
| Are there many teams and a need for organisation-wide visibility? | Central oversight |

A project can move between shapes as it grows. There is no architectural commitment when choosing one.

## Migrating between shapes

Migration is a git operation:

- **In-repo to home-and-link:** plans stay where they are; pointer files are added to related repositories.
- **In-repo or home-and-link to central oversight:** plans are moved (via `git mv` and a single commit per plan) into the planning repository; pointers in the original repositories replace them.

Because every entity has a stable identifier, references survive migration without rewriting.

## What stays the same across shapes

The user experience inside the application does not change between shapes. The list of plans, the channel view, the activity feed — all behave the same way regardless of where the underlying manifest is stored. The deployment shape is an organisational concern, not a user-experience one.
