---
name: github
description: Navigate GitHub repositories, issues, pull requests, search results and files in the browser UI.
---

# GitHub

Use the user's current GitHub browser session when authentication is needed.

## Canonical URLs

- Home: `https://github.com/`
- Notifications: `https://github.com/notifications`
- Settings: `https://github.com/settings`
- Repository: `https://github.com/{owner}/{repo}`
- Issues: `https://github.com/{owner}/{repo}/issues`
- Pull requests: `https://github.com/{owner}/{repo}/pulls`
- Issue: `https://github.com/{owner}/{repo}/issues/{number}`
- Pull request: `https://github.com/{owner}/{repo}/pull/{number}`
- Search: `https://github.com/search?q={encoded-query}&type={type}`
- File: `https://github.com/{owner}/{repo}/blob/{ref}/{path}`
- Login: `https://github.com/login`
- Passkey login: `https://github.com/login?passkey=true`

Search `type` values include `issues`, `pullrequests`, `repositories` and `code`.

## Workflow

Prefer direct repository, issue, pull request and notification URLs over the home feed. Use `browser_snapshot` after each navigation. For review, open the pull request and then its **Files changed** tab.

Verify the signed-in account from the avatar when identity matters. On a file page, use the `y` shortcut with `browser_press` to switch to a commit-pinned permalink before citing a durable URL.

Read the complete issue or pull request discussion before drafting a response. Re-snapshot after opening collapsed reviews or hidden comments.

Ask before submitting comments, reviews, merges, closes or other state-changing actions. After confirmation, verify the repository and target number, perform the action once, then snapshot the result.

A bash `browser-harness-js` snippet may inspect the attached GitHub DOM for a large diff. It must not use hidden credentials or private browser-extension APIs.
