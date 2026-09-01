---
name: slack
description: Read or post in the user's logged-in Slack workspaces through the browser UI.
---

# Slack

Use the logged-in Slack UI at `https://app.slack.com/`.

## Workspace and conversation selection

1. Open Slack with `browser_open` and take a `browser_snapshot`.
2. If several workspaces are available, identify the requested one from the workspace switcher. Ask when context is ambiguous.
3. Use Slack's visible search to find a channel, person or phrase.
4. Open the conversation and snapshot recent messages before acting.
5. Use `browser_tabs` if Slack opens a link outside the app.

Canonical workspace URLs commonly use `https://app.slack.com/client/{teamId}/{channelId}`. Reuse an observed URL, but do not invent team or channel IDs.

## Reading

Read enough surrounding messages to understand thread context and timestamps. Open thread panes with `browser_click`, then re-snapshot because Slack updates panels in place. Do not treat search snippets as the full conversation.

## Writing

Before drafting, inspect recent messages written by the user to that person or channel and match their tone without impersonating habits that are not evident. Keep the message appropriate to the conversation's level of formality.

Use `browser_click` to focus the composer and `browser_type` to enter text. Snapshot the draft and verify the destination, thread context and body.

Always ask for confirmation immediately before posting, replying, editing or deleting a Slack message. After confirmation, click Send once and verify that the message appears. Do not send a test message or placeholder.

Use `browser_press` only when composer focus is certain because Enter may post. For careful page inspection, bash `browser-harness-js` can operate the attached tab, but it must not extract credentials or invoke Slack APIs.
