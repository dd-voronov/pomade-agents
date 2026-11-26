---
doc: docs/modules/roster/roster-tab.md
audience: engineers, product
holds: the Roster tab — what it reads, the card and the list row, Connected to, the week's numbers, state chips and notices, and the actions shared with the agent page
kind: reference
---

# The Roster tab

The route `roster` renders `RosterList` (`src/ui/roster/list/`): every agent as a **card** or a **list
row**, with where it is connected, when it was last active, this week's work sessions and ~$, and its
actions. `RosterTab.tsx` picks the state by route: `roster` is this page, `roster/new` the New agent page
([creating-agents](creating-agents.md)), `roster/<agent>/<tab>` an agent's page
([agent-page](agent-page.md)). Design: [ARCHITECTURE](../../ARCHITECTURE.md) §3.3. Routes: [CONTRACTS "Surfaces and
routes"](../../CONTRACTS.md#surfaces-and-routes). Users: [Roster](../../user-guide/roster.md).

## What it reads

| Read | Hook | Refreshed on |
|---|---|---|
| every agent (`roster.agents`) and each agent's connected projects (`roster.connections`), asked together | `useRoster` | `roster.changed` and `project.created`, `.renamed`, `.removed`, `.updated`; every second while the backend does not answer |
| the workspace's projects | `useProjects` | the same project events |
| each agent's counts (`sessions.agentCounts`) | `useAgentCounts` | `sessions.changed` past the answer's `{ epoch, revision }`, and when the windows change |
| the view (cards or list) | `useRosterView` | `localStorage` key `pomade-agents.roster.view`, the frame's own, so the choice is per Mac; blocked storage keeps it for the session |
| the workspace path and data folder | `useBackendInfo` | every 15 s |

A state page, **Reading the roster…**, shows until the roster, the connections, the projects and the counts
have all answered. `useRoster.patchProfile` takes a profile the frame just saved from the save's answer, so
the card shows it at once; a roster read that began before the save is dropped and asked again, so a stale
read never undoes it.

**Windows** (`rosterWindows`, `agent-counts-model.ts`): *this week* is the local calendar week from Monday
00:00; the per-project window is the last 90 days from 00:00 local. Both are the same all day. Counts are
over work sessions ([sessions](../sessions/index.md) "Work sessions").

`agentViews` (`roster-model.ts`) joins these into one `AgentView` per agent: the roster entry, its counts
(`noCounts` for an agent with no work session), the ranked connected projects, `readOnly` (no workspace, an
unusable profile, or an orphan), `cloneable` (a Claude Code folder agent with a usable profile that is not
an orphan), `needsLogin` and the setup prompt.

## Layout and order

- **Header:** `Roster`, `N agents`, `This week: 11 sessions · ~$9.85` (work sessions and ~$ across the
  agents that are not orphans; `Indexing…` before it while the first walk of the stores runs; `~$` left
  out when no session has an estimate), the cards / list switch, **New agent**. **New agent** is off,
  titled "No workspace is open", without a workspace. The week sum loses its label at a header width of 599 px and
  narrower and goes at 459 px and narrower.
- **Order:** `claude`, `codex`, then by id (the roster's). Agents hidden from the "+" menu are in their own
  section after the others, **Hidden from the “+” menu** with a count, collapsible, open at the start (not
  remembered). An orphan and an agent whose `agent.yaml` cannot be read stay in the main list, marked
  (`isTucked`: hidden, not an orphan, no problem).
- **Cards** fill a grid of at least 346 px columns; a card's Sessions button is an icon at a card width of
  315 px and narrower.
- **List** columns: Agent · Provider · model · Connected to · Last active · This week · actions. Narrow
  lists drop columns by the list's own width: provider·model and This week at 900 px and narrower, then
  Last active and the state chips at 640 px, then Connected to at 440 px.
- **Only the built-ins** in a workspace: a **No folder agents yet** invitation with **New agent** follows
  them (`FirstAgent`). **No workspace open:** a warning banner, the two built-ins with their defaults,
  read-only, `No projects`, New agent off.

## The card and the row

A card shows, top to bottom: the name (a button to the agent's page, titled with the id) and the state
chips; the provider and the default model + effort (`Claude Code · opus-4.8 high`; `provider default` when
the provider's config sets none; `modelLabel` writes `claude-opus-4-8` as `opus-4.8`, Codex's name as is);
the role line (two lines, edited in place); the tags (one row, the ones that do not fit fade, the whole list
is the tooltip, `+ tag` on hover); a notice when one applies; the facts **Connected to**, **Last active**
and **This week**; the buttons **Start session ▾**, **Sessions**, **Open** and the ⋯ menu. A row shows the
same without tags, with the role line (or `No role line`) under the name, and **Start session ▾** and ⋯
only; Sessions and Open are entries of its ⋯ menu.

- **Last active:** relative to now (`now`, `5m`, `3h`, `yesterday`, `4d`, `Nov 3`), `never` with no work
  session; renewed every 30 s.
- **This week:** `11 sessions · ~$9.85`, `1 session` (cost left out when none known). A row shows the
  count over the cost, or `—` for none.
- **State chips**, in order (`chipsOf`): `Needs login` (below), `built-in`, `orphan`, `agent.yaml can't be
  read` (the problem on hover), `hidden` — one list for the
  card, the row and the agent's page (`state-chips.ts`).
- **Notices.** A card shows one at a time, the first that applies (`Notice`): an orphan — its config
  folder is gone, with the folder's name; an unusable `agent.yaml` — why, that the agent runs on its
  first-sight values and the file is never written over, with **Open agent.yaml**; Needs login — **Log in
  with `/login` in its tab, then paste the setup prompt.** with **Copy setup prompt**. A row has no
  notice: its second line says `Config folder … is gone` for an orphan, `agent.yaml can’t be used: …` for
  an unusable file, Needs login — the instruction with **Copy setup prompt** (below 640 px the link alone,
  the instruction in its tooltip), else the role; the chip stays at every width. An orphan's model, Connected to and numbers are empty.
- **Needs login** (`needs-login.ts`): a Claude Code folder agent with a usable profile that is not an
  orphan and has no session of any status in its store (`AgentCountsAnswer.withSessions`). It clears by
  itself when the agent's first session appears. While the stores' first walk runs (`indexing`) no agent is
  said to need login. The setup prompt is `Use the creating-claude-agent skill to set up <name>: role “…”,
  tags a, b.` from the profile.

## Connected to

One field: the projects whose "+" menu offers the agent (the project's own setting; the app reads it
through `roster.connections` and writes it from the [agent page's Projects tab](agent-page.md)).
`connected-model.ts` and `ConnectedTo.tsx`:

- **Total first, then the top projects in brackets:** `8 (■ pomade-agents, ■ Pomade, …)`. Ranking
  (`rankConnected`): the connected projects the agent has work sessions in within the last 90 days, most
  first; the rest follow in the Projects panel's order. A project the agent has sessions in but is not
  connected to does not count. An unknown project is named by its id.
- **How many names:** at most 3 on a card (`CARD_NAMES`), 2 on a row (`ROW_NAMES`), then as many as fit the
  field's measured width (`fitCount`, from canvas text widths; again when the column resizes), at least
  one. A name is cut with `…` right after its last letter at 128 px (`NAME_MAX_WIDTH`); the total and the
  brackets are never clipped; a `…` before the closing bracket says more are connected than named.
- **Tooltip:** `Connected to 8, by work sessions in the last 90 days:` and every project, each with its
  count, then `Open <name>'s Projects tab`.
- A project offering every agent (`["*"]`) counts. Every workspace project connected: `All 12 (…)`; none, or
  no workspace: `No projects`. The Workspace is not counted.
- The whole field is a button: it opens the agent's page on its **Projects** tab.
- Each project has a swatch whose tint is a stable hash of its id (`projectTint`); Pomade gives a project
  no colour.

## Actions

One implementation serves a card, a row and the agent page's header (`commands/`: `useAgentCommands`,
`AgentMenus.tsx`, `commands-model.ts`). A toast (4 s) says what was done, or what was not and why — the
backend's own words on hover — and carries **Undo** where noted.

| Action | What it does |
|---|---|
| **Start session ▾** | A menu: **Mode** (Normal / Full autonomy, only when more than Normal is enabled; Normal first), then **Connected** projects, **Not connected** projects, a separator, **Workspace**. A pick is `agentTabs.launch({ agentId, projectId, mode })`; Pomade builds the command line from `roster.launchSpec` and switches to the new tab, so nothing is said when it works. Off, with the reason as its title, for no workspace, an orphan (`Its config folder is gone`) and a hidden agent (`Hidden from the “+” menu: show it there to start a session`): Pomade launches only agents `roster.list` holds. A refusal says `The session was not started.` with its cause |
| **Sessions** | `tabs.openApp({ route: "sessions?agent=<id>", projectId: "__workspace__" })`: the Workspace's Sessions tab with the Agent filter set |
| **Open** (card) / name | the agent's page at Overview |
| **⋯** | on the Roster: **Open agent page**, **Sessions**; then **Clone…** (Claude Code folder agents with a usable profile), **Hide from the “+” menu** / **Show in the “+” menu**, **Open CLAUDE.md** (Claude Code), **Open agent.yaml**. Not shown for an orphan |
| **Hide / Show** | `roster.updateProfile({ hidden })`; the toast offers Undo (the opposite write). Off, with the reason, without a usable profile or workspace |
| **Open CLAUDE.md**, **Open agent.yaml** | Pomade's editor (`tabs.openFile`): a workspace-relative path inside the workspace, the absolute path outside it |
| role line, tags | edited in place — below |
| **Re-link ▾** (orphan) | asks `roster.unclaimedFolders` each time it opens and lists the folders (`Agents/<name>`), or says `None: every agent folder is an agent’s own.` (`The agent folders could not be read.` on a failed read). A pick is `roster.relink`; the toast `<name> now points at Agents/x. It is back in the “+” menu.` offers Undo (`roster.undoRelink`) |
| **Remove** (orphan) | asks in place: the notice says `Remove <name>’s profile? This deletes Apps/pomade-agents/agents/<id>/. No agent folder is touched.` and the buttons become **Remove** and **Cancel**; Remove is `roster.removeOrphan`. No Undo |

**Role line and tags** (`profile-edit/`: `RoleLine`, `TagList`, shared with the agent page). A click (or
Enter on the focused line) turns the role line into a field: Enter or leaving it saves, Esc drops the
change, line breaks become spaces, at most 200 characters (`ROLE_MAX`), an empty field removes the role.
Tags: `×` removes one; `+ tag` opens a field where Enter or a comma adds the tag, leaving the field adds
what is typed, Esc drops it; tags are lower-cased, cut to 24 characters (`TAG_MAX`), none repeated. Every
change saves the whole value at once through `roster.updateProfile` (`useProfileEdit`); the text shows as
sent until the answer. The toast says `Role line saved to agent.yaml.` / `Tags saved to agent.yaml.`, or
that it was not saved and why. Hovering and editing change no box: the role has a fixed room, the field
lies over the text. Only editable (`!readOnly`) agents have the pencil and the buttons.

## Invariants

- The Roster writes nothing but through the backend's methods: the profile through `roster.updateProfile`
  and the orphan methods, a project's agent list nowhere (that is the agent page's Projects tab).
- A card, a row and the agent page's header show the same actions from the same code.
- Every number is over work sessions; a time window belongs to the view, not to the rule.
- Hovering and editing move nothing: the role line, the tags and the buttons keep their room at every width.
- No card button leaves its card, and nothing scrolls sideways, at any width down to a tab beside the Live
  now panel.

## Tests

Unit: `roster-model.test.ts` (views, order, sections, chips, week text), `connected-model.test.ts`
(ranking, fit, cut, tooltip, total), `agent-counts-model.test.ts` (windows, sums), `needs-login.test.ts`,
`commands-model.test.ts` (modes, targets, why Start is off, toast words), `profile-edit-model.test.ts`.
End to end: `e2e/roster-tab.spec.ts` (order and sections, the numbers and sums, Connected to, the view
switch kept, navigation, widths, kept current without a reload, no workspace, the invitation),
`e2e/roster-actions.spec.ts` (Start session, Sessions, Hide / Show with Undo, open files, role and tags,
Re-link and Undo, Remove, menus inside the window), `e2e/clone-agent.spec.ts` (Clone… and Needs login on a
card and a row).

Known limits: no sort or filter of the agents; the hidden section's open state and the list's columns are
not remembered or chosen.

Tickets: T-020, T-021, T-033, T-026.
