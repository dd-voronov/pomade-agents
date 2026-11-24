---
doc: docs/user-guide/agents-and-scripts.md
audience: users
holds: how an agent or a script reads session data — the `pomade-agents show` command, the work-session field, the record files, the `pomade-agents-sessions` skill and how to give it to an agent
kind: reference
---

# For agents and scripts

An agent you run in Pomade, or a script of yours, can ask the Agents app about sessions: a session's
name, status and note, whether it runs now, its project, tokens and estimated cost. There are two ways,
and the skill teaches an agent both.

## `pomade-agents show`

In every Pomade terminal the command `pomade-agents` is on `PATH`. Pomade must be running: the command
asks the Agents app through Pomade.

```
pomade-agents show                     # the session of the agent tab this terminal runs in
pomade-agents show --session <id>      # any session, by its id (what `claude --resume` takes)
pomade-agents show --json              # one JSON document instead of text
pomade-agents --help
```

- **An agent asking about itself** runs `pomade-agents show --json` in its own tab and gets its own
  session. It has none until its first prompt starts one (exit 6 before then).
- **Without `--json`** it prints the name, then lines for status and note, whether it is a work session
  (`work session  yes — it counts`, or `no — left out of every count and sum`), live state, agent,
  project, folder, times, messages, tokens, estimated cost and the transcript path. Times are UTC. The
  layout is for people and may change; scripts read `--json`.
- **`--json`** prints the session as the app has it, including `"work": true` or `false`: a script that
  counts or sums sessions takes the ones with `"work": true`.
- **Outside a Pomade terminal** name the session with `--session <id>`; the command still needs Pomade
  running.
- **There is no command that sets a status.** The status is yours, set in the Sessions tab.

The command prints one line on stderr when it cannot answer, and exits with:

| Exit | Meaning |
|---|---|
| 0 | printed |
| 1 | Pomade refused the command, or it was not started through Pomade's command folder |
| 2 | usage: an unknown command or option, `--session` without an id |
| 3 | Pomade is not running (the line says where the record files are) |
| 4 | the Agents app's background part is not answering; try again in a moment |
| 5 | not in a Pomade terminal and no `--session` |
| 6 | the terminal's tab has no session: not an agent tab, or the agent has not been prompted yet |
| 7 | no session with that id |

## The record files

Names, statuses and notes are also files you can read with Pomade closed:
`<workspace>/Apps/pomade-agents/sessions/<session-id>.yaml`, one per session. Read them, never edit
them: the app keeps tab titles and events in step with them. The skill below describes every key.

## Give the skill to an agent

The Agents app ships the skill `pomade-agents-sessions`. It tells an agent where the records are, what
each key and status means (Done–skip sessions are left out of statistics), and how to use the command.
Pomade does not link it into any agent; you do:

1. Find its folder: after installing the app it is `<Pomade user data>/apps/pomade-agents/skills/pomade-agents-sessions`
   (the install prints it as "Skill pomade-agents-sessions is at ...").
2. Copy or link that folder into the agent's skills folder (for a Claude Code agent, its `skills/`).
3. Ask the agent about a session ("which of my sessions are on hold, and why?"); it loads the skill
   when the question is about session names or statuses.
