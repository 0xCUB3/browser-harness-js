---
name: image-search
description: Find images through Google Images in the attached Chrome browser and inspect their source context.
---

# Image Search

Use Google Images through the logged-in browser UI.

## Canonical URL

`https://www.google.com/search?tbm=isch&q={encoded-query}`

Useful optional filters can be expressed with Google's `tbs` parameter, but prefer the visible Tools controls when exact values are uncertain.

## Workflow

1. Build a focused descriptive query and URL-encode it.
2. Open the canonical URL with `browser_open`.
3. Use `browser_snapshot` to inspect visible image titles and source sites.
4. Open a result with `browser_click`, then snapshot the preview pane.
5. Follow the source page when provenance, dimensions or usage rights matter.
6. Use `browser_tabs` to track any source page opened in a new tab.

Thumbnails are previews, not proof of the original asset or its license. Verify the source page before reuse and treat Google's license filter as a hint rather than legal permission.

## Query guidance

Include the subject and desired style or context. Add `site:` when the user names a publisher. Use Google's visible size, color, type, time and usage-rights filters instead of guessing query parameter values.

Do not parallel-bomb Google with image searches. Run them sequentially to avoid CAPTCHA, and stop if a challenge appears.

When a snapshot omits preview details, `browser_eval` may read visible DOM text or image attributes from the current page. A bash `browser-harness-js` snippet may inspect the attached results grid, but do not use hidden image-search services or download unrelated assets.
