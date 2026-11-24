---
name: pomade-agents-sessions
description: Read Pomade's agent-session data — the session records the Agents app keeps (name, status, note, project, transcript) in <workspace>/Apps/pomade-agents/sessions/, and the `pomade-agents show` command for one session's full data with tokens, cost, live state and whether it is a work session. Use when a script or an agent needs session names or statuses, counts or sums sessions (only work sessions count — every session but Done–skip), wants to label or filter sessions, or asks "which session is this / what is its name or status". Status is the user's alone; never edit the record files.
---

# Pomade agent sessions — records and the `pomade-agents` command

The Agents app (`pomade-agents`, hosted by Pomade) keeps one **session record** per agent session
(Claude Code or Codex) and answers questions about sessions through its **command**,
`pomade-agents`. Use the records to read many sessions at once (no Pomade needed); use the command
for one session's complete, current picture.

## Rules

- **Read only.** Only the app writes the records — through its UI, its API and its command. Never
  edit, create, rename or delete a record file: the app keeps tab titles and events in step with
  them, and a hand edit bypasses that.
- **Status is the user's.** Only the user sets it, in the Agents UI. There is no command or file
  edit that sets it — don't look for one.
- **Derived numbers are not in the files.** Tokens, ~$ cost, context fill, messages and live state
  come from the transcripts, through `pomade-agents show --json`.

## Where the records are

```
<workspace>/Apps/pomade-agents/sessions/<session-id>.yaml
```

- `<workspace>` — in a Pomade terminal, `$POMADE_WORKSPACE`. Elsewhere, the path in the file
  `$POMADE_HOME/workspace`, i.e. `~/.pomade/workspace` (stable Pomade) or `~/.pomade-dev/workspace`
  (dev Pomade).
- `<session-id>` — the provider's session id: Claude Code's transcript file name, Codex's rollout
  UUID — what `claude --resume` and `codex resume` take.
- Read only `*.yaml` files whose name does not start with `.` — the app writes a temporary
  `.<id>.yaml.<pid>.<n>.tmp` beside a record and renames it over the record.
- A record is written the first time the app sees a session and rewritten on every change. It stays
  when the transcript is deleted. A session started a moment ago may not have one yet; on the app's
  first run every session found is recorded as `done`.

## Record format

YAML, one flat mapping (`startedByRunner` is the one nested mapping). Example:

```yaml
id: 7b5c3451-0370-4bf9-b6fd-617d56545a78
provider: claude-code
agent: claude
name: G4 agents grill
status: on-hold
note: waiting for the v0.2.6 test round
project: V1StGXR8_Z5jdHi6B-myT
projectRoot: Projects/Pomade
launchedFrom: V1StGXR8_Z5jdHi6B-myT
transcript: /Users/me/.claude/projects/-Users-me-ws-Projects-Pomade/7b5c3451-0370-4bf9-b6fd-617d56545a78.jsonl
cwd: /Users/me/ws/Projects/Pomade
updated: 2026-11-09T14:32:00.000Z
```

| Key | Always there | Value | Absent means |
|---|---|---|---|
| `id` | yes | the session id; equals the file name without `.yaml` | — |
| `provider` | yes | `claude-code` or `codex` | — |
| `agent` | yes | the roster id of the agent that ran it: `claude`, `codex`, or a folder agent's name (`Agents/<name>/`) | — |
| `name` | no | the session's name, one line (also its Pomade tab's title) | unnamed |
| `status` | yes | `active`, `on-hold`, `done` or `done-skip` (below) | — |
| `note` | no | a one-line note the user attached to the status | no note |
| `project` | no | the stable id of the Pomade project the session belongs to (the first one, when several projects share its folder) | the Workspace — no project |
| `projectRoot` | no | that project's folder, relative to the workspace | no project |
| `projectOverride` | no | `true`: the user chose `project` (Move to project) | the app placed it |
| `launchedFrom` | no | the project of the Pomade tab the session was first seen in; `__workspace__` for a tab in the Workspace | never seen in a Pomade tab |
| `forkedFrom` | no | the id of the session it was forked from; the app does not fill it yet | — |
| `startedByRunner` | no | `{ job: <job name> }`: started by a Pomade Runner job | started by the user |
| `outsidePomade` | no | `true`: started outside Pomade and never bound to a Pomade tab | — |
| `transcript` | no | the transcript file, absolute | — |
| `cwd` | no | the folder the session started in, absolute | — |
| `updated` | no | when the app last wrote the record, ISO 8601 UTC | — |

Reading rules:

- **Parse it as YAML 1.2, or read every value as a string.** The app writes plain scalars:
  `note: on`, `name: yes` and `updated: 2026-11-09T14:32:00.000Z` are strings. A YAML 1.1 parser
  (PyYAML's default loaders, Ruby's Psych) turns them into booleans and dates — in Python use
  `yaml.load(text, Loader=yaml.BaseLoader)`, which keeps every value a string.
- A key with no value (`name:`), and `false` for `projectOverride` / `outsidePomade`, mean the same
  as the key being absent.
- Ignore keys not in the table: a person may have added them, and the app keeps them.
- A file that is not valid YAML, not a mapping, or whose `id` is not its file name's is not a usable
  record: skip it. The app leaves it alone too.

## Status

| Value | In the UI | Meaning |
|---|---|---|
| `active` | Active | being worked on. Every new session starts here; resuming a session in Pomade sets it back to Active |
| `on-hold` | On hold | paused; usually has a `note` saying why |
| `done` | Done | finished, and it counts |
| `done-skip` | Done–skip/Failed | finished but not worth counting: failed, abandoned, a throwaway |

- **Done–skip sessions are not work sessions** (below): they count nowhere.
- Nothing but the user (and a resume, which sets Active) changes a status. It is not the live state:
  whether an agent is running now (Working, Needs you, Idle, Closed) is detected, not recorded —
  `show` reports it.

## Work sessions — which sessions count

A **work session** is a session that counts. **Every session is a work session unless its status
is `done-skip`** — a session without a record yet counts too. Every count and sum the app shows
(cost totals, an agent's sessions this week or per project) is over work sessions only, and so
should yours: session statistics, reports, knowledge extraction — unless asked otherwise.

- From `pomade-agents show --json`, read the session's `work` field (`true` / `false`): the app's
  own answer, which follows the rule wherever it changes.
- From the record files, apply the rule yourself: `status != "done-skip"`.
- A time window ("this week", "the last 90 days") is your choice, not part of the rule.

## The command: `pomade-agents show`

In Pomade's terminals the command is on `PATH`. It asks the app's background part through Pomade,
so Pomade must be running.

```
pomade-agents show [--session <id>] [--json]
pomade-agents --help · pomade-agents show --help
```

- **Default target:** the session of the agent tab the terminal runs in (Pomade gives every
  terminal `$POMADE_TAB_ID`). An agent running in a Pomade tab gets its own session this way.
- `--session <id>` (or `--session=<id>`) — any session, by its id.
- `--json` — the session as one JSON document on stdout. Without it, a short text for people,
  whose layout may change: scripts use `--json`.

The JSON document (the app's `Session`):

```jsonc
{
  "id": "7b5c3451-…",
  "summary": {                      // from the transcript
    "id": "7b5c3451-…", "provider": "claude-code", "agent": "claude",
    "transcript": "/Users/me/.claude/projects/…/7b5c3451-….jsonl",
    "cwd": "/Users/me/ws/Projects/Pomade",   // start folder; null when not recorded
    "branch": "main",                        // git branch at the start; null when none
    "startedAt": "2026-11-09T13:02:11.000Z", "lastActiveAt": "2026-11-09T14:30:40.000Z",
    "model": "claude-opus-5-5", "effort": "high",   // the latest turn's; null when unknown
    "tokens": { "input": 1200, "output": 35000, "cacheRead": 900000, "cacheWrite": 40000 },
    "context": { "used": 84000, "window": 200000 },  // latest turn; null when unknown
    "costUsd": 4.21,                         // estimate; null when a model is not in the price table
    "firstMessage": { "text": "…", "at": "…" },     // the user's first and last messages; null when none
    "lastMessage": { "text": "…", "at": "…" },
    "lastAnswer": { "text": "…", "at": "…" },       // the agent's last text answer; null when none
    "malformedLines": 0
  },
  "record": { "id": "…", "provider": "…", "agent": "…", "name": "…", "status": "on-hold", "note": "…" },
                                    // the record file's keys as above; null when it has none yet or it cannot be read
  "recordProblem": null,            // why the record file cannot be read
  "attribution": { "projects": ["V1StGXR8_Z5jdHi6B-myT"], "by": "folder", "sharedFolder": false },
                                    // projects it shows in ([] = the Workspace); by: override · launched · folder · remembered · workspace
  "folderInProject": "",            // start folder relative to that project's folder; null when outside it
  "live": "idle",                   // working · needs-you · idle · closed
  "liveSince": "2026-11-09T14:30:41.000Z",  // null: closed and not seen running since the app started
  "tab": { "tabId": "…", "projectId": "…" },  // the Pomade agent tab bound to it; null when none
  "hidden": null,                   // "empty": it holds no message yet (the Sessions tab hides it)
  "work": true                      // a work session: it counts (every session but Done–skip)
}
```

Texts are trimmed and capped at 4000 characters. Times are ISO 8601.

### Errors and exit status

Every error is one line on stderr, starting `pomade-agents:`.

| Exit | Case |
|---|---|
| 0 | printed |
| 1 | anything else: Pomade refused the command, the command was not started through Pomade's command folder, an answer it could not read |
| 2 | usage: an unknown command or option, `--session` without an id |
| 3 | Pomade is not running — the line says where the record files are; read them instead |
| 4 | the Agents app's background part is not answering (try again in a moment) |
| 5 | not in a Pomade terminal (`$POMADE_TAB_ID` unset) and no `--session` |
| 6 | the terminal's tab has no session: it is not an agent tab, or its agent has not been prompted yet |
| 7 | no session with the `--session` id |

## Worked example — Done sessions with their names, from the files alone

Lists every Done session (Done–skip ones are another status, and no work sessions), newest record first, with its name or
"unnamed". It needs only the files and Python 3 with PyYAML (`pip install pyyaml`):

```python
#!/usr/bin/env python3
import os, pathlib, yaml

def workspace() -> pathlib.Path:
    if os.environ.get("POMADE_WORKSPACE"):
        return pathlib.Path(os.environ["POMADE_WORKSPACE"])
    home = os.environ.get("POMADE_HOME") or os.path.expanduser("~/.pomade")
    return pathlib.Path(pathlib.Path(home, "workspace").read_text().strip())

records = []
for path in (workspace() / "Apps/pomade-agents/sessions").glob("*.yaml"):
    if path.name.startswith("."):
        continue
    try:
        record = yaml.load(path.read_text(), Loader=yaml.BaseLoader)  # every value a string
    except yaml.YAMLError:
        continue
    if not isinstance(record, dict) or record.get("id") != path.stem:
        continue  # not a usable record
    records.append(record)

done = [r for r in records if r.get("status") == "done"]  # "done-skip" is left out
for r in sorted(done, key=lambda r: r.get("updated") or "", reverse=True):
    print(f'{r["id"]}  {r.get("name") or "unnamed"}')
```

For numbers (tokens, cost) per session, follow it with `pomade-agents show --session <id> --json`
for the sessions you need, while Pomade runs.
