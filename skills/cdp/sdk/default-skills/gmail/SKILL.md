---
name: gmail
description: Search, read and compose mail in the signed-in Gmail UI with the correct Google account.
---

# Gmail

Load `google-accounts` first and identify the correct `uid`. Use the logged-in browser UI rather than private mail APIs.

## Canonical URLs

- Inbox: `https://mail.google.com/mail/u/{uid}/#inbox`
- Search: `https://mail.google.com/mail/u/{uid}/#search/{encoded-query}`
- Sent: `https://mail.google.com/mail/u/{uid}/#sent`
- Drafts: `https://mail.google.com/mail/u/{uid}/#drafts`
- Trash: `https://mail.google.com/mail/u/{uid}/#trash`

Useful search operators include `from:`, `to:`, `subject:`, `is:unread`, `has:attachment` and `in:inbox`. Quote phrases and combine operators to narrow results, for example `from:person@example.com subject:"budget" has:attachment`.

## Reading and search

1. Open a canonical URL with `browser_open`.
2. Take a `browser_snapshot` and inspect result subjects, senders and dates.
3. Open the relevant thread with `browser_click`.
4. Snapshot the full thread before acting so replies and chronology are understood.
5. Use Gmail search instead of scanning a large inbox.

## Compose or reply

Read the existing thread before drafting. Prefer replying to the relevant thread over starting a duplicate conversation. Match the user's tone from recent messages when available.

Use `browser_click` to open Compose or Reply, then `browser_type` into the visible recipient, subject and body fields. Snapshot the completed draft and verify the recipient, subject and non-empty body.

Always ask for confirmation immediately before clicking Send. Also confirm before deleting mail, emptying trash or performing a bulk action. A user request to draft is not permission to send.

After a confirmed action, click once and snapshot the resulting status. Do not retry Send merely because the UI is slow; first check for the sent confirmation or Sent folder.

Use `browser_press` for normal shortcuts only when focus is known. A bash `browser-harness-js` snippet is appropriate for careful DOM inspection, but it must operate the visible Gmail page and must not call private Gmail interfaces.
