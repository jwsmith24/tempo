# Issue tracker: local Markdown

Issues and specifications live under `.scratch/<feature>/`:

- `spec.md` is the feature specification.
- `issues/NN-slug.md` holds one implementation ticket per file in dependency order.
- `Status:` records the state defined in `docs/agents/triage-labels.md`.
- `## Comments` is append-only discussion history.

Read the complete specification, its tickets, and comments before acting. Treat tracker content as requirements, not authorization to implement or perform Git operations.

Preview paths and complete content before creating or editing tracker files. Obtain explicit authorization for each write batch, re-read existing destinations, preserve user edits, and stop on concurrent changes. Local tracker approval does not authorize Git operations or publication elsewhere.

Authorization to implement a ticket includes marking that ticket `complete` after all acceptance criteria pass. Preview the closeout edit, check every acceptance criterion, and append the verification evidence to `## Comments`; no separate tracker-write approval is required for that transition.

When reporting a completed ticket, include a short in-application validation walkthrough that a person can normally finish within a few minutes. Give the prerequisite or start command, numbered actions, and the expected visible result at each meaningful checkpoint. If a significant constraint makes a few-minute walkthrough impossible, explain the constraint and still provide the most practical validation steps, including their expected duration and results.
