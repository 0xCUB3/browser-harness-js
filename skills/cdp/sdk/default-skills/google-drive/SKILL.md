---
name: google-drive
description: Navigate and search the signed-in Google Drive UI with account-safe canonical URLs.
---

# Google Drive

Load `google-accounts` first and select the correct `uid`.

## Canonical URLs

- My Drive: `https://drive.google.com/drive/u/{uid}/my-drive`
- Shared with me: `https://drive.google.com/drive/u/{uid}/shared-with-me`
- Recent: `https://drive.google.com/drive/u/{uid}/recent`
- Starred: `https://drive.google.com/drive/u/{uid}/starred`
- Trash: `https://drive.google.com/drive/u/{uid}/trash`
- Search: `https://drive.google.com/drive/u/{uid}/search?q={encoded-query}`
- Folder: `https://drive.google.com/drive/u/{uid}/folders/{folderId}`
- File: `https://drive.google.com/drive/file/d/{fileId}/view?authuser={uid}`

Prefer search, folder links and direct file links over browsing from the home surface.

## Reading results

1. Open the narrowest canonical URL with `browser_open`.
2. Snapshot the result list and distinguish file names from surrounding controls.
3. A single click often selects a result; use the UI's open action or double-click behavior when needed.
4. Snapshot after opening because files frequently appear in a preview dialog.
5. Close previews with the visible close control or `browser_press` using `Escape`, then snapshot again.

Use `browser_tabs` when a Docs or Sheets file opens in another tab. Keep account context consistent and verify any `authuser` redirect.

## Caution

Reading or downloading a requested file is non-destructive. Ask before moving, renaming, sharing or deleting. Confirm the target folder and active account before uploads or moves. Never assume a selected row has opened.

Drive heavily re-renders after open, close, share and move actions, so stale snapshot references should not be reused. Take a fresh snapshot after each transition.

A bash `browser-harness-js` snippet can inspect several visible rows when snapshots are unwieldy. It must interact with the attached Drive page and must not call private file APIs.
