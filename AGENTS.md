## Agent skills

- Product scope: read `docs/PRODUCT-BRIEF.md` before planning or implementing product behavior. Treat it as authoritative; surface conflicts instead of silently resolving them.
- Domain language and architecture: read `CONTEXT.md` and applicable records in `docs/adr/` before changing terminology, domain behavior, data ownership, application boundaries, or coaching behavior. Follow `docs/agents/domain.md`.
- Local tracker: follow `docs/agents/issue-tracker.md` for specifications, tickets, status changes, and comments.
- Triage: use the states and meanings in `docs/agents/triage-labels.md`.
- Learning notes: when the user says "record this" or asks to preserve an explanation, update `docs/LEARNING-NOTES.md` with the concept, its project-specific rationale, one concise example, and links to relevant official documentation. If no official documentation is available, state that explicitly. Merge with existing entries rather than duplicating them.

## Worktrees

- Isolation: keep databases, imported files, test artifacts, build output, and server ports specific to the current worktree. Use `.tempo-local/` for manual runtime state and `.tempo-test/` for automated test state.
- Setup: Agent Manager worktrees are prepared by `.kilo/setup-script`. Shared `.venv` and `frontend/node_modules` links are valid only while their dependency manifests remain unchanged; replace a shared link with a worktree-local installation before changing dependencies.
- Runtime: use `.kilo/run-script` in Agent Manager so each worktree receives a deterministic loopback port and local application state.
- Parallel work: stabilize shared schemas, migrations, routes, and generated contracts before starting dependent worktrees. Treat each worktree branch as an isolated task and integrate it through Apply, merge, or a pull request.
- Git state: inspect and preserve concurrent work. Keep changes in the current worktree and use commits or branches for transfer; Git stashes are repository-wide and unsafe for worktree isolation.
