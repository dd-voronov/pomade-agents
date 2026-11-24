---
doc: docs/modules/stores/index.md
audience: engineers, product
holds: how the app reads Claude Code and Codex session stores — roots, watching, parsing, the parse index, tokens, context %, cost and the price table
kind: reference
---

# stores

Turns the agents' transcript files into one `SessionSummary` per session and keeps them current.
It is the only reader of the transcripts; the `sessions` module takes summaries from it and adds
records, attribution and live state. Code: `src/backend/stores/`. The summary's shape:
[CONTRACTS "Sessions"](../../CONTRACTS.md#sessions); the store's place in the backend:
[CONTRACTS "Backend"](../../CONTRACTS.md#backend).

## Read-only on the Owner's stores

The app never writes, renames or deletes anything under `~/.claude`, `~/.codex` or an agent
folder's `projects/`. Transcripts are opened for reading, read and closed within one call
(`transcript-file.ts`). The only file the module writes is the parse index in the app's own state
folder. Keep it so: a change that needs a transcript edited is a change to the product, not to this module.

## Where the stores are (`roots.ts`)

| Store | Root | Session file |
|---|---|---|
| built-in `claude` | `~/.claude/projects` | `<encoded-cwd>/<sessionId>.jsonl` |
| folder agent `<name>` | `<workspace>/Agents/<name>/projects` | same |
| built-in `codex` | `~/.codex/sessions` | `**/rollout-<launch time>-<sessionId>.jsonl` |

- A folder agent is a folder under `<workspace>/Agents/` holding a `CLAUDE.md`, not `_shared`, with
  no "template" in its name (`folderAgentNames`). The roster takes its folder agents from the same
  function, so the two never disagree. Which agent a store's sessions belong to is the roster's
  answer, not the folder's name ([session-data](../sessions/session-data.md) "A session's agent").
- Only regular `.jsonl` files at exactly those depths count. Claude's `memory/`, per-session folders
  and `<sessionId>/subagents/*.jsonl` sit one level deeper and are skipped; a Codex rollout whose
  `session_meta.source` names a `subagent` is excluded too (it is not a session of its own).
- The session's id is the file name's (Claude: the whole name; Codex: the trailing UUID) unless the
  Codex `session_meta` carries an `id`.

## Watching and reading (`session-store.ts`)

- **One recursive `fs.watch` per root.** On macOS that is one FSEvents stream per root, so
  hundreds of transcripts cost no descriptors. An event names a path; the path is stat'ed and read
  from its parsed offset, so a repeated or coalesced event costs a stat.
- **Walks.** A root is walked when its watch starts, and again 1 s later (`STREAM_START_MS`): the
  stream starts on its own thread and misses what changed before it runs. A transcript that changed
  is read once more 500 ms later (`RECHECK_MS`) because FSEvents can swallow a second change to a
  path that just changed.
- **2 s tick** (`TICK_MS`). Checks roots that do not exist yet (an agent that never ran, no
  Codex), roots that went away, and roster changes (a folder agent added or removed): the set of
  roots is recomputed each tick and the store follows it.
- **Reads** run four at a time (`CONCURRENCY`), events gather 40 ms before they are read
  (`SETTLE_MS`).
- **Revisions.** Every change bumps a revision. `answer(since)` returns the summaries that changed
  after `since.revision` plus the transcripts gone since, or everything when `since` is missing, from
  another `epoch` (one store run) or ahead of the store. `onChange` notices are coalesced to one per
  150 ms (`NOTIFY_MS`). `indexing` is true until the first walk of every root is parsed; `indexed` resolves then.
- **Startup log.** One line: sessions, transcripts, milliseconds, malformed lines.

## Parsing

`transcript-file.ts` reads a transcript from where the last parse stopped; `parser.ts` splits the
chunk into lines and hands each to the provider's record reader.

- **Offsets sit on a line boundary.** A last line without its newline is still being written and is
  left for the next read. A line longer than the 1 MiB read buffer grows the buffer.
- **A transcript only grows.** The previous state is reused only when the inode is the same, the
  size is not below the parsed offset, and the byte before the offset is a newline. Anything else is
  another file at the same path and is parsed from the start.
- **A line that is not JSON** is counted (`malformedLines`) and skipped; it never fails a read.
- **`SessionState`** (`session-state.ts`) is the plain-JSON accumulation per transcript: first
  `cwd` and `gitBranch`, time span, latest model and effort, usage per model and price tier,
  context, first and last user message, last answer. `summarize` turns it into the `SessionSummary`.
  Message texts are trimmed and cut at 4000 characters, ending in "…" (`MESSAGE_MAX_CHARS`).
- **Claude Code** (`claude.ts`): every record with a `timestamp` widens the time span; sidechain
  records (`isSidechain`) count for time only. One API message is written as several records that
  repeat `message.id` and its usage, so usage counts once per consecutive id. `<synthetic>` and
  API-error records are no turn. The last text block of an assistant record is the last answer.
- **Codex** (`codex.ts`): `session_meta` on line 0 gives id, `cwd`, branch and whether it is a
  sub-agent; later `session_meta` lines are not this session's (a sub-agent repeats its parent's, a
  resume in the desktop app writes it again). `turn_context` gives the model and effort of the
  turns after it. `token_count` carries cumulative totals; a turn's tokens are the difference
  between consecutive totals, billed at the model in force; a drop in a total means the counters
  restarted and the new total is that turn's share. Tokens before any `turn_context` are counted
  under the model key `unknown`, which is never in the price table.
- **What counts as the user's message** (`prompts.ts`): not tool results, skill bodies, system
  reminders, command caveats and output, task notifications, interrupt markers, compaction summaries,
  or Pomade's file-context prompt (`Read <file>`). A slash command the user typed is kept as typed.
  Claude Code records with `origin` count only when `origin.kind` is `human`; older records count
  as plain text no client injected. Codex: `user_message` events are the source; rollouts that carry
  none (seen from codex-tui 0.147 to 0.153) fall back to the user `response_item`s that are not
  Codex's own context, and the first `user_message` event drops what the items gave.

## Tokens, context %, cost (`usage.ts`, `prices.ts`)

- **Tokens** are kept per model and price tier, in five kinds: uncached input, output, cache read,
  cache write (5 min), cache write long (1 h). The summary's `tokens` sums them (`input` is uncached
  input; both cache writes are `cacheWrite`). Codex's `input_tokens` includes cached and cache-write
  tokens, so uncached input is the rest.
- **Context %** (`contextPercent` in `src/shared/sessions.ts`): the latest turn's input-side tokens
  over the window. Claude: `input + cache read + cache write` over the price table's window for the
  model. Codex: the latest request's input over `model_context_window` as the rollout records it,
  else the table's. No window, no context: the UI shows nothing, never a guess.
- **Cost** (`costOf`): dollars per million tokens by model, tier and kind, summed turn by turn, so a
  session that switched models or crossed a threshold is billed at what each turn ran at. It is
  `null` (shown "—") when any tokens ran on a model, tier or kind the table has no rate for.
- **Tiers.** `standard`; `long` when a request's whole prompt (all input, cached or not) exceeds the
  model's `longPrompt.above`; `fast` when the Claude record says `speed: "fast"`, every rate times
  `fastMultiplier` (a model without it has no fast rate, so no cost).
- **The price table** (`PRICE_TABLE`) is hand-kept: Anthropic and OpenAI models that occur in the
  stores, with the sources and the date checked in the file's header. Model ids resolve exactly, by a
  listed alias (a dated snapshot) or by a listed context variant (`claude-opus-4-8[1m]`). There is no
  prefix or fuzzy matching, so a new model shows "—" and no context % until a row is added. Claude's
  own `costUSD` in `cost-state` records agrees with these rates; compare there when updating. To
  add a model: a row, a test in `prices.test.ts`.

## The parse index (`index-file.ts`)

`<stateDir>/session-index.json` (`<userData>/app-state/pomade-agents/`) stores, per transcript, its
inode, parsed offset and `SessionState`, so a warm start reads only what grew. It is machine-local
and rebuildable: a missing, corrupt or stale file is a cold start, never an error.

- It is valid only for the parser and prices that wrote it: `PARSER_VERSION` and a fingerprint of
  the whole `PRICE_TABLE`. **Bump `PARSER_VERSION` on any change to `SessionState` or to how a
  record is read**; any edit to the price table invalidates the index by itself.
- Each entry is checked (`isSessionState`) before it is taken over; a file's first read takes its
  carried entry as the previous state and drops it from the carried set. The set is cleared once the
  first walk ends.
- Saved atomically (temp file, rename) at most every 5 s while summaries change (`SAVE_MS`), and on
  stop; it stays when the backend stops.

## Invariants

- Read-only on every store (above); the only write is the index.
- Offsets are always just after a newline; a half-written line is never parsed.
- No descriptor stays open between reads.
- A transcript that is not a session (`excluded`) keeps its parse state but has no summary.
- A model or tier missing from the price table gives no cost and no context, never an estimate.
- A change that alters what a state holds bumps `PARSER_VERSION`.

## Tests

Unit tests beside each file: `claude.test.ts`, `codex.test.ts`, `parser.test.ts`,
`transcript-file.test.ts` (appends, shrunk or replaced files, long lines, gone files),
`index-file.test.ts` (missing, corrupt and foreign indexes),
`prices.test.ts`, `roots.test.ts`, `session-store.test.ts` (first walk, growth and half-written lines, stores that appear or go away, warm and
corrupt-index starts). They
read the synthetic transcripts in `harness/fixtures/transcripts/` (invented text, the real stores'
record structure) through `test-helpers.ts`; the e2e sandbox seeds its stores from the same
fixtures (`e2e/transcripts.ts`, `harness/sandbox.ts`).

Tickets: T-003.
