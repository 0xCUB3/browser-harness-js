---
name: google-docs
description: Read or edit Google Docs through the logged-in browser UI using the correct account.
---

# Google Docs

Load `google-accounts` first. Never guess which Google account should open or edit a document.

## Canonical URL

`https://docs.google.com/document/u/{uid}/d/{id}/edit`

If given another Docs URL, preserve the document ID and construct the account-qualified URL. If access changes after doing so, verify the chosen account instead of cycling through accounts blindly.

## Read

1. Open the canonical URL with `browser_open`.
2. Wait for the editor to load and take a `browser_snapshot`.
3. Read visible document text from the snapshot.
4. For long documents, use the outline, Find with `browser_press` or controlled scrolling to reach the relevant section.
5. Use `browser_eval` only to inspect page text already rendered in the logged-in UI.

Do not invent a cookie API or fetch private document endpoints. A bash `browser-harness-js` snippet may inspect accessibility text or operate the editor when a harness snippet is clearer.

## Edit

Snapshot before editing and identify the exact insertion point or selection. Click into the document with `browser_click`, then use `browser_type` for text and `browser_press` for explicit keyboard operations. Re-snapshot after each meaningful edit.

Avoid replacing an entire document when a focused edit is enough. Preserve headings, links and surrounding formatting. Use Undo immediately if the snapshot shows text landed in the wrong place.

Ask before destructive edits or large replacements. If the user requested a specific edit, applying that edit is allowed, but verify the result before leaving the document.

## Account and collaboration safety

Check the title and account before changing content. Do not alter sharing settings unless requested. Comments and suggestions are visible communications, so confirm their wording and target before posting when the user's instruction was only to draft or review.
