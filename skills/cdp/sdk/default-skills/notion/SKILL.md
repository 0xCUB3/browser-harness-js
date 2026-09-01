---
name: notion
description: Navigate, read and edit the user's logged-in Notion workspaces through the browser UI.
---

# Notion

Use the logged-in UI at `https://www.notion.so/` or `https://www.notion.com/`. Preserve a supplied workspace page URL when one is available.

## Workspace selection

1. Open Notion with `browser_open` and take a `browser_snapshot`.
2. Inspect the workspace switcher when several workspaces are present.
3. Match the workspace from the user's request, page URL or visible account details.
4. Ask before choosing if two workspaces plausibly fit.
5. Verify the workspace again before creating or moving content.

Do not read session tokens or call private Notion APIs.

## Search and read

Use the visible search or Quick Find to locate pages. Open a result with `browser_click`, then snapshot the page title, breadcrumbs and relevant content. Search snippets are not a substitute for opening the page.

Notion pages load blocks lazily. Scroll or expand toggles as needed and re-snapshot after each view change. Use `browser_tabs` for external links.

## Edit

Click the exact block before typing. Use `browser_type` for text and `browser_press` for keyboard commands only when the caret location is clear. Re-snapshot after edits because slash menus and overlays can capture input.

Preserve block structure and avoid replacing a whole page for a narrow change. Verify the title, parent page and workspace before creating content.

Ask before deleting, moving, publishing or changing sharing. Also confirm before posting comments when the user's request was to draft or review rather than communicate.

A bash `browser-harness-js` snippet may inspect accessibility text or perform a precise sequence in the attached Notion tab. It must operate the visible UI and must not expose signed upload links or browser credentials.
