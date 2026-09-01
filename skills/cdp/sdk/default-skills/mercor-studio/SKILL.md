---
name: mercor-studio
description: Fill and revise Mercor Studio annotator tasks (studio.mercor.com), including Lexical markdown answers and reviewer notes.
---

# Mercor Studio

Mercor Studio answers are Lexical contenteditables whose accessible name is always `editable markdown`. Do not choose one by its contenteditable index. Match it to the nearby heading, such as codebase overview, gaps, difficulty or notes.

Writer notes are beside the Resubmit control. A second `Notes for the reviewer` field in the review panel is not the writer notes box. Difficulty is often already focused, so use `browser_type` to real-click-focus the writer field and verify afterward that the notes changed while difficulty did not.

Never set editor content with `innerHTML`, `textContent` or Lexical internals. Use `browser_type` and `browser_press` after a real click-focus. Never click Resubmit unless the user explicitly asked to resubmit.
