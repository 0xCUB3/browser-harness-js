---
name: x
description: Browse, search and interact with X through the user's logged-in browser session.
---

# X

X requires a logged-in browser session for most useful actions.

## Canonical URLs

- Home: `https://x.com/home`
- Search: `https://x.com/search?q={encoded-query}&src=typed_query`
- Latest search: `https://x.com/search?q={encoded-query}&src=typed_query&f=live`
- Profile: `https://x.com/{handle}`
- Post: `https://x.com/{handle}/status/{postId}`
- Notifications: `https://x.com/notifications`
- Messages: `https://x.com/messages`

Search supports operators such as `from:user`, `to:user`, `since:YYYY-MM-DD`, `until:YYYY-MM-DD`, `filter:links` and quoted phrases.

## Browse and read

Open a canonical URL with `browser_open` and inspect it with `browser_snapshot`. Open a post before summarizing a thread, then read visible replies in context. Use `browser_tabs` for external links.

If X shows a login wall, stop and tell the user login is required. Do not attempt to bypass it or extract credentials.

## Interactions

Before composing, verify the active account from the visible profile menu. Use `browser_click` to open the composer and `browser_type` for text. Snapshot the final draft and audience context.

Always ask for confirmation immediately before posting, replying, sending a direct message, following, reposting or deleting. Likes and bookmarks also change account state, so perform them only when explicitly requested. Do not spam, bulk-follow or repeat an action because the UI response is delayed.

After a confirmed action, click once and re-snapshot to verify the resulting state.

A bash `browser-harness-js` snippet may inspect rendered posts in the attached tab when snapshots are cumbersome. It must interact through the page and must not call private X interfaces.
