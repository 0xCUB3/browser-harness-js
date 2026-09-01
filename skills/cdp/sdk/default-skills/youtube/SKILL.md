---
name: youtube
description: Search YouTube and fetch video metadata, transcripts, transcript languages and comments through the youtube REPL helper.
---

# YouTube

Use the `youtube` global through `browser-harness-js`. It works against YouTube's HTTP responses in isolated background tabs, so it does not disturb the user's visible tab.

## Transcript and metadata

Fetch the transcript directly with `youtube.getTranscript(url)`. Do not use browser page controls, snapshots or DOM scraping to read transcripts. Never substitute the description or comments when captions are unavailable.

```js
const [metadata, transcript] = await Promise.all([
  youtube.getMetadata(url),
  youtube.getTranscript(url),
]);
```

Pass `{ includeTimestamp: true }` when the answer needs time ranges. Pass `{ lang: "es" }` to request an available language, and call `youtube.listTranscriptLanguages(url)` before choosing when the language is uncertain.

## Search and comments

Use `youtube.search(query, { limit, lang, region })` for discovery. Read comments with `youtube.getComments(url, { limit, continuation })`; use the returned continuation for another page when needed.

These helpers only read YouTube. Do not post a comment, subscribe, like or change a playlist through another browser path unless the user clearly asks for that public action and confirms the active identity.
