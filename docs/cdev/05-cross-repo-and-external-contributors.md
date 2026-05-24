# Cross-Repo Work and External Contributors

Two real-world scenarios stress-test the state model: work that spans multiple repositories, and work done by people who do not have full access to the team's materials. Both fit cleanly into the model with two small additions — a scope field on plans and an explicit "external" state for pantry references.

## Cross-repo work

A product that consists of a frontend, a backend, and an infrastructure repository represents one piece of work — adding a feature, for example — across all three. The plan describing that work belongs in one home repository, with pointers from the others.

### Plan scope

Every plan carries an explicit scope field listing the repositories it touches:

```yaml
id: plan-abc123
title: Add Apple Pay support
scope:
  - org/frontend-app
  - org/payment-service
  - org/infra
home: org/payment-service
```

The home repository is the canonical location of the plan. Other repositories listed in the scope each contain a small pointer file at `.codetrellis/external/<plan-id>.json` referencing the home.

### Stitched view

When the application is opened in any repository in the scope, and the user has the home repository cloned locally, the full plan is shown. The user can take actions on the plan, but those actions land as commits to the home repository through normal git flows.

When the home repository is not present locally, the user sees a placeholder describing what they would need to clone to see the full picture. Nothing is broken; the user is simply told what is missing.

### Stable identifiers

Plans and their referenced entities use stable identifiers that are independent of titles, file paths, or repository names. This means a plan can be renamed, moved between repositories, or its repository can be renamed entirely, and pointers in other repositories continue to resolve through a lightweight redirect mechanism.

## External contributors

External contributors — agencies, contractors, open-source collaborators — work in forks or in long-lived branches with scoped access. Their work needs to come back into the project through the same mechanism their code does: a pull request.

### Plan edits travel through pull requests

Because the manifest is just files in the repository, edits to plans by external contributors travel back through pull requests in exactly the same way code does. Their commits carry their git identity; the team reviews their plan changes alongside their code changes. No separate review system is required.

### Asymmetric pantry

External contributors do not have access to the team's pantry (private screenshots, internal transcripts). They see manifest references to those items with an "external — request from team" placeholder. They can request access, or they can work without it.

Conversely, anything an external contributor produces lives in their pantry by default. When they want to contribute working material — an architecture diagram, a walkthrough video — they mark it for inclusion in the pull request, and it ships alongside their plan edits.

### Forking from a prepared state

In situations where the team does not want to share the full plan history with an external contributor, the contractor forks from a specific commit or a prepared branch rather than from the bleeding-edge state. This is a standard git operation; the application requires no special mechanism for it.

### Signed commits and audit

In environments where audit is important, git's existing signed-commit mechanism provides cryptographic attribution. The application surfaces signature verification status in the UI alongside the author name. No additional identity system is required.

## What these scenarios add to the model

Two additions to the base model serve both scenarios:

| Addition | Why |
|---|---|
| Plans carry a **scope field** and a **stable identifier** | Cross-repo pointers must survive renames, moves, and refactors. |
| Pantry references have an **"external / missing" state** in the UI | Cross-repo viewers and external contributors see graceful placeholders rather than broken links. |

These are small additions, but they are essential to include from the start of the implementation rather than retrofitted later. Both are inexpensive when built in; both are painful to add after the data model has been in use.
