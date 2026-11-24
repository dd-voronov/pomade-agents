---
doc: docs/user-guide/sessions.md
audience: users
holds: how to find, read and organise sessions in the Sessions tab, task by task
kind: reference
---

# Sessions

The Sessions tab lists every agent session of a project, by status. Open it from the Agents icon's panel
(**Sessions** button), from the **Sessions | Roster** switch at the top of the Agents tab, or from Pomade's
History icon. Each project has its own tab; the Workspace's tab lists the sessions of every project.
An agent's page in the Roster has a **Sessions** tab of its own and an **Open in Sessions** button, which opens the
Workspace's Sessions tab already filtered to that agent (and to the project chosen there).
Shortcuts: [keyboard-shortcuts](keyboard-shortcuts.md).

## What you see

The header names the scope (**Workspace · all projects** in the Workspace's tab) and says
`3 work sessions · ~$4.20 est.` — the count and the estimated cost of the **work sessions**: every session
except those in **Done–skip/Failed**. Hidden sessions are never counted, and neither a search nor a filter
changes the header. `Indexing…` shows while the agents' stores are still being read for the first time.

Below the header, a search field and filters (**Project** — in the Workspace's tab —, **Agent**, **Folder**), then
four groups, each with its status, its count and the cost of its work sessions: **Active**, **On hold**,
**Done**, **Done–skip/Failed**. The count of a group is of its rows; the Done–skip/Failed group shows
`not in totals` instead of a cost. A group's chevron hides and shows its rows. A long Done or Done–skip/Failed group
shows its latest 10 with **Show all N**; **Show the latest 10 only** goes back.

Columns, left to right: **Name**, **Project** (Workspace's tab), **Agent**, **Model · effort**, **Context**,
**~$ est.**, **Last active**. A narrow tab drops them in this order: effort, model, ~$ est., context, agent.
Name and Last active always stay.

- **Name** — the name you gave the session; a session without one shows its first message in grey.
  A fork has a fork mark; chips say `shared folder`, `outside Pomade`, or ⏱ and a job name for an
  unattended run (started by Runner, not by you).
- **Live mark** before the name — a spinner while the agent is Working, a red dot when it Needs you, a
  grey dot when it is Idle, nothing when it is Closed. Hover for "Working since 09:05".
- **Context** — how full the model's context window was at its last turn; amber from 75 %, red from 90 %.
- **~$ est.** — the cost estimated from tokens. `—` means unknown; hover for why (no answer yet, or the
  model is not in the price table). A Done–skip/Failed session's cost is not counted in the header or in
  any group's cost; its panel says `not counted in totals`.
- **Last active** — `now`, `5m`, `3h`, `yesterday`, `4d`, `Nov 3`, `Nov 2025`; hover for the exact time.
- A note you attached shows under its row.

Hover a row for its checkbox, its **Open tab** / **Resume** button and ⋯ (the row's menu). Right-click opens the
same menu.

A new session appears within a couple of seconds, as Active. Sessions that existed when the app first
ran were put in Done.

## Read a session

Click a row. The tab becomes a list with the session's panel on the right. The list's four tabs —
**Active**, **On hold**, **Done**, **Skip/Failed**, each with a count — switch the status shown; the list
opens on the selected session's status. The panel shows:

- its name, the **×** (or Esc) that closes it, and its live state: "Working · since 09:05", or, Closed, "Closed · last active today, 09:05";
- the buttons **Open tab** / **Resume**, **Rename**, **Move to project**;
- notes about how it started: an unattended run, a fork (a link to the parent), a shared folder, outside Pomade;
- **Status**: four buttons and a note field;
- facts: **Project**, **Started in** (the start folder relative to the project, `./` for its root, with the
  branch), **Started**, **Last active**, **Agent**, **Model**, **Context**, **~$ est.**;
- **First message**, **Last message**, **Last agent answer**. Long texts are cut; **Show more** / **Show less**.

↑ ↓ move to the previous and next session; Esc returns to the table with the row in view.

## Set a status

A status is where you put the session in your work: **Active**, **On hold**, **Done**, **Done–skip/Failed**.
New sessions start Active; resuming a session makes it Active; nothing else changes it.

- In the panel, click a status button. Add a one-line note in the field **Add a one-line note…**: Enter or
  leaving the field saves, an empty field removes the note, Esc discards. Changing only the status keeps the note.
- From the row's menu: **Set status** → a status.
- Drag a row onto a group header (table) or a status tab (list).

A toast says what happened — `“Name” → Done` — with **Undo** for 4 seconds. Other apps are told about a
status change only 5 seconds after your last change, so an Undo takes it back before anyone hears of it.
If a change is refused, the panel (or the toast) says why and the row stays as it was.

## Change several at once

- Click a row's checkbox, or Cmd/Ctrl+click a row, to check it. Shift+click checks a range. Cmd+A (Ctrl+A)
  checks every row shown. The checkbox in the column header checks or clears them all.
- The bar **N selected** replaces the search row. **Set status** → pick a status; **Clear** (or Esc)
  clears the checks.
- Right-click or ⋯ on a checked row: **Set status · N sessions**. Dragging a checked row drags them all.

The checks clear once the change went through, and stay if it was refused. Rows that leave the list (or no
longer match your search) are unchecked.

## Rename a session

Click the name in the panel, or press **Rename**, F2, or right-click → **Rename**. Type, then Enter or
click away to save; Esc keeps the old name; an empty field makes the session unnamed again. The name is
also the title of the session's agent tab, both ways: renaming the tab renames the session.

## Move a session to another project

**Move to project** in the panel (or right-click → **Move to project…**) lists the projects and
**Workspace (no project)**; the one the session shows in now is ticked. Choosing one overrides where the
session would otherwise go (the tab that started it, then the folder it started in). A session moved
out of the tab's project leaves the list. **Undo** in the toast puts it back. A session in a
`shared folder` (several projects on the same root) shows in each until you move it.

## Find sessions

- **Search** (press `/`) looks in names, messages (first, last, the agent's last answer) and notes. Several
  words are one phrase. Matches are marked; a hit hidden in the row appears as a line under it
  (`Agent: …`). The toolbar shows `N matches` and **Clear**.
- **Project**, **Agent**, **Folder** open menus of the values the tab holds, each with a count of what it
  would leave; **All projects** / **All agents** / **All folders** remove the filter. Coming from **Open in
  Sessions** on an agent's page, the tab opens with the **Agent** (and **Project**) filter already set; **Clear**
  removes them. Folders read `project root`,
  `docs/api`, `workspace root`, `no folder recorded`.
- While a search or filter is on, every match shows, grouped by status. Opening a status tab clears the
  search and filters. **No sessions match** has **Clear search and filters**.
- ↓ in the search field goes to the first row.

## Hidden sessions

A session that holds no message from you and no answer from the agent — a file only a `/clear` wrote —
is hidden from the list, the counts, the sums and the search. `N hidden` in the header shows them dimmed
with a `hidden — no messages` chip; click again to hide. They appear in the list by themselves once
they have a message. A hidden session cannot be resumed.

## Get back into a session

**Open tab** / **Resume** — the button in the panel, the button on a hovered row, the row's menu, Enter on the selected or marked
row, or a double-click:

- **Open tab** — the session has an agent tab: Pomade switches to it.
- **Open run terminal** — an unattended run is running it with no tab: its terminal opens.
- **Resume** — the session is Closed: it starts again in a new agent tab, in its project and start folder, and
  a status other than Active becomes **Active**.

A toast says what was done, or why not (for example, the session started outside the workspace, its agent is
not in the roster, or it has no messages).

## When something is off

- "Reading the session stores…" — the app's background part does not answer yet; the tab asks again every second.
- A line under the header — session records are not kept right now (no workspace open, or the app's
  `settings.yaml` cannot be read, so new sessions get no record until it is fixed or deleted).
- A session's record file that cannot be read (bad YAML) is left alone; fix or delete the file. Changes to
  that session say so.
