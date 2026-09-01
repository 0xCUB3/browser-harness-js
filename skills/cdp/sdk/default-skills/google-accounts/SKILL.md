---
name: google-accounts
description: Identify the correct signed-in Google account and /u/{uid}/ index before using any Google app.
---

# Google Accounts

Choose the account before opening Gmail, Calendar, Drive, Docs or Sheets. Never guess the `uid`; it is the numeric index used in Google URLs such as `/u/0/`.

## Account discovery

1. Open `https://accounts.google.com/AccountChooser` with `browser_open`.
2. Use `browser_snapshot` to read the listed names and email addresses.
3. Match the task to an account from the visible identity and user context.
4. If the intended account is unclear, ask the user instead of choosing by position.
5. Carry the chosen number into every Google app URL as `/u/{uid}/`.

An alternative is to open `https://mail.google.com/`, activate the Google account switcher and inspect it with `browser_snapshot`. The current Gmail URL can reveal the active `/u/{uid}/` index, while the switcher associates it with an address.

Use `browser_click` to open the account switcher when necessary. Re-snapshot after any menu opens because account details are often hidden until then.

## Rules

- Account positions can differ between browser profiles and can change after sign-in or sign-out.
- Do not infer `uid` from an email address.
- Do not expose account details unrelated to the task.
- If an app redirects to a different account, stop and identify the new active account before reading or writing.
- Keep the selected account consistent across links opened for the same task.

When the accessibility snapshot omits useful text, use `browser_eval` only to read visible DOM text. For a more involved inspection, use bash `browser-harness-js` against the attached browser session; do not attempt to read cookies or invent an account API.
