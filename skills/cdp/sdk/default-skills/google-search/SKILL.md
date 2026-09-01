---
name: google-search
description: Search the web with Google in the attached logged-in Chrome profile when browser results are sufficient.
---

# Google Search

Prefer this skill over another search skill when Google in the attached browser is enough. The page automatically uses the Chrome profile's current cookies and preferences.

## Canonical URL

`https://www.google.com/search?q={encoded-query}`

Useful optional parameters:

- `start=10` for the second result page
- `hl=en` for interface language
- `gl=us` for country context
- `safe=active` for SafeSearch

## Workflow

1. Form one focused query and URL-encode it.
2. Open the canonical URL with `browser_open`.
3. Read results with `browser_snapshot`, including title, source and snippet.
4. Open promising results with `browser_click` and inspect the source page.
5. Refine the next query only after reviewing the current results.

Use standard Google operators when they reduce noise: quoted phrases, `site:`, `filetype:`, `intitle:`, `before:` and `after:`. Avoid over-constraining the first query.

## CAPTCHA caution

Do not run searches in parallel or fire a loop of speculative queries. Bursts can trigger CAPTCHA or bot protection. Search sequentially and let each result determine the next query. If Google presents a challenge, stop rather than attempting to bypass it.

Use `browser_tabs` to return from sources to results. `browser_eval` may extract visible result links when the accessibility snapshot is incomplete. A bash `browser-harness-js` snippet is suitable for structured inspection of the current results page, but it must use the attached browser page rather than an unofficial search API.
