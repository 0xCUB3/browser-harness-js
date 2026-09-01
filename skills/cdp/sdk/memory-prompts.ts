export type MemoryMessage = { role: 'user' | 'assistant'; text: string };

function localTime(now: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(now);
}

export function extractionPrompt(options: {
  memoryRoot: string;
  sessionId: string;
  messages: MemoryMessage[];
  messageCount: number;
  now?: Date;
}): string {
  const now = options.now ?? new Date();
  const date = now.toISOString().slice(0, 10);
  const target = `${options.memoryRoot}/episodic/${date}.md`;
  const messages = options.messages.slice(-options.messageCount)
    .map(message => `<message role="${message.role}">\n${message.text}\n</message>`).join('\n\n');
  return `You are now acting as the memory extraction subagent.
You're running asynchronously to extract episodic memory from this conversation.

Analyze the most recent ~${options.messageCount} messages below and use them to update episodic memory. You MUST only use content from those last ${options.messageCount} messages.

Available tools conceptually: read, write, edit, memory_search, get_time, and read-only Bash. Use read, write, edit, and read-only bash commands only. All writes must stay under ${options.memoryRoot}.

<recent_messages>
${messages}
</recent_messages>

# Target

Append a complete markdown block to ${target} when there is durable signal. Create the file with a \`# ${date}\` heading if it does not exist.

# What to extract

Write episodic memory when you see:
- a durable site quirk or workflow learning
- wrong-field typing, rich-editor framework behavior (Lexical, ProseMirror, Draft.js or contenteditable), confirm-before-submit flows or duplicate identically labeled controls; these are durable signals, not one-off glitches
- a user preference surfaced in this turn
- an external event that may matter later
- a sparse observation that is too early to generalize yet

Do NOT extract:
- temporary task progress or session outcomes
- one-off glitches
- fragile selectors or transient DOM details
- restatements of the user's prompt with no future value
- secrets, passwords, or tokens unless the user explicitly said to remember them
- messages already extracted in the previous turn

# How to write

- Use a heading timestamp and concrete prose. One fact per paragraph.
- MECE; minimize duplicates while keeping important details. Make surgical edits.
- For new episodic entries, append the complete markdown block to episodic/${date}.md.
- Include \`Reference: sessions.get("${options.sessionId}")\`.
- Keep semantic pages, MEMORY.md, USER.md, and TAXONOMY.md untouched in extraction. Dreaming handles synthesis later.
- If there is no durable signal, make no file writes and respond exactly NONE.
- If you edited memory files, respond with one concise sentence summarizing what you added or changed, not DONE.

Be conservative. If in doubt, do not extract.
Today is: ${localTime(now)}`;
}

export function dreamingPrompt(options: {
  memoryRoot: string;
  memoryFiles: string[];
  preview: string;
}): string {
  return `Run a dreaming pass over the current memory store.
Memory root = ${options.memoryRoot}.

<memory_files>
${options.memoryFiles.map(path => `- ${path}`).join('\n')}
</memory_files>

Preview the last 14 days of episodic files plus existing semantic/L1 files:
<files_preview>
${options.preview}
</files_preview>

Steps:
1. Review the episodic window and the existing memory index.
2. Read any semantic file you may change.
3. For every durable observation worth promoting, add a \`## History\` evidence entry and update \`## Current\` only if stable understanding changed. Create a missing page only when needed. Semantic shape: YAML title frontmatter, ## Current, ## History with \`- YYYY-MM-DD: … Source: memory/episodic/YYYY-MM-DD.md\`.
4. If user profile/preferences or default agent behavior changed in a stable, broadly-useful way, refresh USER.md or MEMORY.md.
5. If a durable observation did not fit any existing category cleanly, record a short resolver-friction note in TAXONOMY.md.
6. Summarize what you changed in 1-2 sentences at the end.

Keep all reads and writes under ${options.memoryRoot}.`;
}
