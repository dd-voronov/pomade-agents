---
doc: docs/user-guide/live-now.md
audience: users
holds: the Live now panel and the Agents icon's badge, for users
kind: reference
---

# Live now

Click the **Agents** icon in Pomade's strip: the side panel **Live now** lists every agent running right now,
across all projects. The icon's badge is the number of agents that **Need you** — it is right from Pomade's
start, before you ever open the panel, and disappears when none is waiting.

## What you see

The header says `3 running · 1 needs you` (nothing when nothing runs). Two buttons, **Sessions** and
**Roster**, open the Agents tab at that view, or bring it forward if it is open.

The rows are grouped by project: the project in front first, marked `current`, then the others in the
Projects panel's order, the Workspace last. A group header shows the project's name and how many rows it has. Inside
a group the rows are ordered: **Needs you**, then **Working**, then **Idle**, the most recent first.

A row has the agent's state mark (a spinner for Working, a red dot for Needs you, a grey dot for Idle), a title, how
long ago it entered that state (`now`, `5m`, `3h`), then the state word and the agent's name. Hover for
"Working since 09:05".

- **Agent tabs** — the title is the session's name; an unnamed session shows its first message in grey; a
  tab that has not been prompted yet shows the agent's name.
- **Unattended runs** — agents Runner runs on a schedule or trigger — show with ⏱, the job's name as the
  title and `unattended · <agent>`. They are always Working and never need you.

## Go there

- Click an agent-tab row: Pomade switches to that tab's project and focuses the tab.
- Click an unattended run: its terminal opens as a tab in its project. A run whose terminal Runner did not
  report cannot be clicked.
- Click a group header (`Switch to <project>`): the same as clicking its first agent-tab row, else its
  first run with a terminal.

**No agents running** shows when nothing is live. At the bottom, "Background: running" and the app's
version say the app's background part is up; "not answering" means the panel is waiting for it.
