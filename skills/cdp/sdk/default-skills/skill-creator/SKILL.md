---
name: skill-creator
description: Create or update reusable browser-harness-js skills owned and editable by the user.
---

# Skill Creator

Create user-owned skills only under:

`~/.browser-harness-js/skills/{name}/SKILL.md`

Never write skills to `~/.pi/agent/skills` or `~/.agents/skills`.

## Frontmatter

Every skill starts with YAML frontmatter containing exactly the discovery fields it needs:

```yaml
---
name: my-skill
description: Use when the user needs a clear, specific browser workflow.
---
```

The frontmatter `name` must match the folder name. Use lowercase hyphen-case and keep the description focused on when the skill should load.

## Creation workflow

1. Identify the reusable behavior and its trigger.
2. Choose a short lowercase hyphen-case name.
3. Check whether `~/.browser-harness-js/skills/{name}/SKILL.md` already exists.
4. Read an existing file before updating it and preserve user-authored instructions unless the user asks to replace them.
5. Create or edit only the requested skill folder.
6. Re-read the finished file and verify its frontmatter.

Use normal file tools for creation. Do not edit the bundled `default-skills` copies when the goal is a personal customization; edit the seeded user copy instead.

A durable site trap should become a user skill in `~/.browser-harness-js/skills`, not only a chat note. Create or update the relevant skill as soon as you discover repeatable wrong-field typing, rich-editor behavior, a confirmation boundary or duplicate identically labeled controls.

## Body guidance

Write concise procedural instructions for a future sidepanel Pi. Name canonical URLs and the supported browser tools when useful: `browser_open`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_press`, `browser_tabs` and `browser_eval`. Mention bash `browser-harness-js` only when a persistent harness snippet materially helps.

Do not document APIs that do not exist. Do not include icons, branding fields, activation YAML, setup history or changelogs. Keep secrets and account-specific identifiers out of durable skills.

Do not overwrite a user-edited skill without first reading it and limiting the change to the user's request.
