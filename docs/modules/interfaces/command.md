---
doc: docs/modules/interfaces/command.md
audience: engineers, product
holds: the `pomade-agents` command, the session-data format skill, and the build check that keeps both installable
kind: reference
---

# The command, the format skill and the build check

The app's surface for agents and scripts: a command that prints one session, a skill that teaches an
agent to read the session files and the command, and the check that makes the build folder
installable. The user-facing description is [For agents and
scripts](../../user-guide/agents-and-scripts.md).

## The `pomade-agents` command

Contract (arguments, output, exit statuses): [CONTRACTS "Command"](../../CONTRACTS.md#command).

- **Source and build.** `src/command/`: `main.ts` (the entry: connects as role `command` through the
  kit's `connectSocket`, reads `POMADE_TAB_ID`, `resolveWorkspace`), `cli.ts` (`runCli`, arguments,
  `SUB_COMMANDS`, failures, `EXIT`), `session-text.ts` (the text form). `vite.command.config.ts`
  bundles it, `pomade-kit` included, into `dist/cli/pomade-agents.mjs`, the path the manifest's
  `commands` names; `npm run build` runs it after the UI and backend builds. Pomade's shim runs the
  built module; the command has no `node_modules`.
- **It reads nothing itself.** Every answer comes from the backend through `apps.call` to the app's own
  API; the only other call is `project.list`, to name projects in the text form (a failure there
  leaves ids). `runCli` takes its streams, the tab id, the workspace and the connection as
  `CommandDeps`, so the unit tests drive it with no process.
- **Target.** `--session <id>` calls `sessions.get`; without it the tab in `POMADE_TAB_ID` calls
  `sessions.ofTab`. With neither, it fails before connecting, so a terminal outside Pomade fails the
  same with Pomade open or closed.
- **Output.** `--json` prints the `Session` exactly as `sessions.get` answers it, `work` included.
  Without it, `sessionText` prints the name and `label  value` lines in UTC, one line per message,
  no colour: status, `work session` (`yes — it counts`, or `no — left out of every count and sum`
  from `Session.work`), live, agent, project, and the rest ([CONTRACTS "Command"](../../CONTRACTS.md#command), Text).
- **Exit statuses** (`EXIT` in `cli.ts`; one line on stderr, nothing on stdout): 0 printed, 1 failed
  (Pomade refused the command, no app identity because it was not started through Pomade's shim, an
  answer that fails its guard), 2 usage, 3 Pomade not running (the line names the records folder), 4
  the backend not answering (`app-absent`, `app-not-responding`; 5 s per call), 5 no `--session` and no
  `POMADE_TAB_ID`, 6 the tab has no session, 7 unknown session.
- **No write path.** There is no sub-command that sets a status; an unknown command is usage.

## The format skill

`public/skills/pomade-agents-sessions/SKILL.md` is the master copy. The manifest's `skills` lists its
folder; the UI build copies `public/` into `dist/`, so it ships at `skills/pomade-agents-sessions/` in
the build folder, and Pomade reports the installed folder in `host.info`'s `skills`. Pomade links it
nowhere: giving it to an agent is the user's step ([user
guide](../../user-guide/agents-and-scripts.md#give-the-skill-to-an-agent)).

It teaches an agent with no other doc to read the record files (where, every key, the status values,
reading rules), to apply the work-session rule (every session counts unless its status is
`done-skip`; from `show --json` read `work`, from the files test `status != "done-skip"`; a window
is the reader's), to use `pomade-agents show` and to read its exit statuses. A worked example lists
Done sessions with their names from the files alone.

`src/command/skill.test.ts` holds its tables and rules to the code: the record keys
(`SESSION_RECORD_KEYS`) in the files' order, the statuses (`SESSION_STATUSES`), the work-session
rule as `isWorkSession` has it (every status counts but `done-skip`, and the `"work": true` field in
the JSON example), every `EXIT` status, the records folder (`RECORDS_FOLDER`) and the command's usage
line.

## The build check

`npm run build` ends with `scripts/check-build.ts`, which fails the build when `dist/` is not an
installable folder (`buildFolderProblems`, `scripts/build-folder.ts`): the manifest parses, every file
it names exists (UI entry, icon, backend, each command's entry), and each skill folder holds a
`SKILL.md` whose frontmatter `name` is the folder's name and whose `description` is present and at most
1024 characters (`skillProblems`). `src/shared/manifest.test.ts` applies `skillProblems` to the master
copy, checks the manifest's `commands` and `skills` entries, and checks that `vite.command.config.ts`
builds `src/command/main.ts` into `dist/cli/pomade-agents.mjs`.

## Invariants

- The command answers only from the backend; it opens no record, transcript or store file.
- The skill's tables equal the code's record keys, statuses, work-session rule and exit statuses
  (`skill.test.ts`).
- The skill's `description` stays within 1024 characters (`skillProblems`, in the build check and
  the manifest test).

## Tests

`src/command/cli.test.ts` (arguments, targets, every exit status against a stub link),
`session-text.test.ts` (the text form, the `work session` line), `skill.test.ts` (the skill against
the code); `src/shared/manifest.test.ts` (the manifest's command and skill entries). End to end:
`e2e/command.spec.ts` (the built command as a child process against the fake Pomade); inside a real
Pomade: `e2e/pomade/command.spec.ts` ([testing](../core/testing.md#the-pomade-smoke)).

Tickets: T-016, T-019, T-027, T-033.
