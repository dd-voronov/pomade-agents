// Which `user` records are the user's own messages, and their text. Transcripts carry a lot under the
// user role that nobody typed: tool results, skill bodies, system reminders, command caveats and
// outputs, background-task notifications, interrupt markers, compaction summaries, IDE context,
// and the file-context prompt Pomade submits when it starts an agent on a document.

type Shape = Record<string, unknown>;

const isObject = (v: unknown): v is Shape => typeof v === "object" && v !== null && !Array.isArray(v);

/** Pomade's file-context prompt: `Read <path>` on one line, the path ending in a file extension. */
const POMADE_FILE_CONTEXT_RE = /^Read [^\n]*\.[A-Za-z0-9]{1,10}$/;

/** A slash command as Claude Code records it: `<command-name>/x</command-name>` (+ `<command-args>`). */
const COMMAND_NAME_RE = /<command-name>\s*(\/?[^<\s]+)\s*<\/command-name>/;
const COMMAND_ARGS_RE = /<command-args>([\s\S]*?)<\/command-args>/;

/** Text a client injected at the start of a user record: an XML-ish tag (`<system-reminder>`,
 *  `<local-command-stdout>`, `<task-notification>`, …), an interrupt marker, an old-style caveat. */
const INJECTED_START_RE = /^(<[a-zA-Z][\w-]*>|\[Request interrupted|Caveat:)/;

function isPomadeFileContext(text: string): boolean {
  return POMADE_FILE_CONTEXT_RE.test(text);
}

/** The text parts of a message's content, joined; tool results and images count as no text. */
function contentText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const part of content) {
    if (!isObject(part)) continue;
    if (part.type === "tool_result") return null;
    if (part.type === "text" && typeof part.text === "string") parts.push(part.text);
  }
  return parts.join("\n");
}

/** A slash command the user typed, as they typed it: `/name args`. */
function commandAsTyped(text: string): string | null {
  const name = COMMAND_NAME_RE.exec(text)?.[1];
  if (name === undefined) return null;
  const args = COMMAND_ARGS_RE.exec(text)?.[1]?.trim() ?? "";
  const command = name.startsWith("/") ? name : `/${name}`;
  return args === "" ? command : `${command} ${args}`;
}

/**
 * The user's message in a Claude Code `user` record, or `null` when the record is not one.
 *
 * Current Claude Code marks every prompt's origin: `origin.kind` is `human` for what he submitted
 * (typed, pasted, a queued prompt, an accepted suggestion, a skill command) and something else for
 * peers, task notifications and auto-continuations. Records without `origin` (older versions, local
 * commands, injected context) count only when they are plain text that no client injected.
 */
export function claudePrompt(record: Shape): string | null {
  if (record.isMeta === true || record.isCompactSummary === true || record.isVisibleInTranscriptOnly === true) return null;
  const message = record.message;
  if (!isObject(message)) return null;
  const raw = contentText(message.content);
  if (raw === null) return null;
  const text = raw.trim();
  if (text === "") return null;

  const origin = record.origin;
  if (isObject(origin)) {
    if (origin.kind !== "human") return null;
    if (text.startsWith("<command-")) return commandAsTyped(text);
    return isPomadeFileContext(text) ? null : text;
  }
  if (record.promptSource === "system") return null;
  if (INJECTED_START_RE.test(text) || isPomadeFileContext(text)) return null;
  return text;
}

/** The marker Codex's desktop app puts before the request it wraps in its own context headers. */
const CODEX_REQUEST_MARKER_RE = /^## My request for Codex:[ \t]*\n/m;

/**
 * The user's message in a Codex `user_message` event, or `null` when it holds none. The event carries
 * what he submitted; Codex's own context (`AGENTS.md`, environment) goes into other records. The
 * desktop app prefixes its context headers (`# In app browser:`, `# Files mentioned by the user:`)
 * and marks where the request starts.
 */
export function codexPrompt(message: unknown): string | null {
  if (typeof message !== "string") return null;
  const marker = CODEX_REQUEST_MARKER_RE.exec(message);
  const text = (marker ? message.slice(marker.index + marker[0].length) : message).trim();
  if (text === "" || isPomadeFileContext(text)) return null;
  return text;
}

/** Codex's own context in a user `response_item`: `<environment_context>` and the like, `AGENTS.md`. */
const CODEX_CONTEXT_RE = /^(<[a-zA-Z][\w-]*>|# AGENTS\.md instructions)/;

/**
 * The user's message in the text of a Codex user `response_item` (the model's input), or `null`.
 * Rollouts written without `user_message` events hold his messages only there, beside the
 * context Codex adds.
 */
export function codexInputPrompt(text: string): string | null {
  return CODEX_CONTEXT_RE.test(text.trimStart()) ? null : codexPrompt(text);
}
