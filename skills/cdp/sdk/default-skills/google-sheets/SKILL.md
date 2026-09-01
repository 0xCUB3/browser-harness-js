---
name: google-sheets
description: Read and edit Google Sheets through the logged-in browser UI with the correct account.
---

# Google Sheets

Load `google-accounts` first and identify the intended `uid`.

## Canonical URLs

- Spreadsheet: `https://docs.google.com/spreadsheets/u/{uid}/d/{id}/edit`
- Sheet tab: `https://docs.google.com/spreadsheets/u/{uid}/d/{id}/edit#gid={gid}`
- Cell or range: append `&range={A1-notation}` after the `gid` fragment when supported by the current URL

Preserve the spreadsheet ID and known `gid` when qualifying a supplied URL with the account.

## Read cells

1. Open the account-qualified URL with `browser_open`.
2. Take a `browser_snapshot` and read the visible grid, row headers, column headers and formula bar.
3. Navigate to a named range or A1 address through the visible name box when needed.
4. Snapshot again after changing sheets or moving to another range.
5. Report only values that are visibly associated with the requested cells.

Large sheets virtualize their grid. Do not infer off-screen values from row counts or patterns. Use `browser_eval` only for text rendered in the current page. Do not invent cookie or spreadsheet APIs.

## Write cells

Confirm the target sheet and starting cell before typing. Use `browser_click` to select a cell, `browser_type` for a single value and tab-separated text for a deliberate rectangular paste. Use `browser_press` for Enter, Tab or Undo only when focus is clear.

Snapshot the edited range and formula bar afterward. Watch for values being interpreted as dates or formulas. Undo immediately if data shifts into the wrong range.

Ask before clearing ranges, deleting sheets, changing sharing or overwriting populated cells beyond the requested scope. A bash `browser-harness-js` snippet may operate the visible grid for a precise repetitive action, but it must not call private Sheets endpoints.
