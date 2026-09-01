# Memory Taxonomy

## Invariants
- Browser Harness memory lives under `memory/`.
- Semantic and episodic memory are the source of truth. L1 (`MEMORY.md`, `USER.md`) is derived from them.
- L1 files must stay small enough for prompt loading.
- Semantic pages use YAML title frontmatter followed by `## Current` and `## History`.
- Episodic memory lives under `episodic/` and uses append-only raw markdown entries grouped by date.
- Read-time retrieval must not depend on this file.
- Each semantic write must have one primary home.
- Episodic references use `sessions.get("<panelSessionId>")`.
- Semantic History evidence points back to the backing episodic markdown path.

## L1 Root Files

### `MEMORY.md`
Store globally reusable operating rules, durable default behavior and workflow conventions that matter on many tasks. Keep detailed world knowledge, site-specific quirks and one-off task context out.

### `USER.md`
Store stable user profile details, preferences and long-running context worth loading every session. Keep detailed site workflows and ephemeral session notes out.

## Directory Rules

### `users/`
The canonical profile page for the current user and durable user facts.

### `agent/`
Durable operating memory, long-lived workflow rules and stable constraints for Browser Harness.

### `people/`
Durable facts and History about other specific people, never the current user's profile.

### `companies/`
Organization knowledge and durable company context.

### `sites/`
Browser knowledge for a site: UI behavior, workflow procedures and durable quirks.

### `projects/`
Active work with durable project decisions and long-running threads.

### `concepts/`
Reusable frameworks and generalized lessons that apply across projects or sites.

### `routines/`
Recurring workflow memory and durable notes useful for later runs of the same routine.

### `episodic/`
Date-grouped observations, external events and sparse evidence that is not yet ready for a semantic page. It is not a home for L1 summaries or synthetic subject briefings.

## Write Routing Decision Tree
1. If information is not durable beyond the current session, keep it out of memory.
2. If it is sparse, event-like or uncertain, append it to `episodic/YYYY-MM-DD.md`.
3. If it changes stable understanding, update the primary semantic page during dreaming.
4. Prefer an existing semantic page over creating a duplicate.
5. Before creating a page, check its slug, title and aliases.
6. Append `History` evidence first; rewrite `Current` only when stable understanding changed.
7. Refresh `MEMORY.md` or `USER.md` only when the change matters broadly at session start.
8. If no category fits cleanly, use the closest durable home and note resolver friction here.

## Promotion Rules
- Promote to `USER.md` only when a user change is stable, high-value and broadly useful.
- Promote to `MEMORY.md` only when a change affects default agent behavior across many tasks.
- Promote episodic evidence into semantic pages when repeated observations or strong evidence establish durable understanding.
- Do not promote one-off incidents, narrow site quirks or uncertain facts into L1.
- Sparse evidence may remain episodic.

## Semantic Write Shape

```markdown
---
title: Example
---

## Current
Stable understanding now.

## History
- YYYY-MM-DD: Evidence that changed or supported the understanding. Source: memory/episodic/YYYY-MM-DD.md
```

## Resolver Evolution
Clarify recurring ambiguities. Add a directory only when many durable items lack a clean primary home, while preserving the Current and History invariants.
