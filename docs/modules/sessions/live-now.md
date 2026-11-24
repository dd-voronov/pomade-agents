---
doc: docs/modules/sessions/live-now.md
audience: engineers, product
holds: the Live now panel — where its rows come from, grouping and order, clicks, the badge, the specs
kind: reference
---

# Live now

The side panel the Agents strip icon (`agents`, manifest `strip`, `action: "panel"`) opens: every agent
running now across projects. One bundle serves every surface; `viewFor` renders `LiveNowPanel` for the
panel surface. Row shapes: [CONTRACTS "Live now"](../../CONTRACTS.md#live-now).

## Rows

Built by the backend (`backend/sessions/live-now.ts`, `startLiveNow`) from the live state ([session-data](session-data.md)
"Live state and bound tabs"), not by the UI:

- **Tab row** — one per live agent-tab entry (`working`, `needs-you`, `idle`; `exited` is not live), bound to
  a session or not yet prompted. Carries the session's name and first message (one line), the agent's
  roster id (`agent`) and roster name (`agentName`, its id when the roster has none) and `since`.
- **Run row** — one per Runner agent run from its run started to its run finished: always Working, titled
  by the job's name, with the run's attached terminal when Runner named it ([session-data](session-data.md)
  "Runner runs"). Runs never need you.

Rows are rebuilt whenever the live entries, the sessions or the roster change; a different answer is a new
revision, and `liveNow.changed` goes out. `useLiveNow` asks `liveNow.list` once its subscription
stands, again when a notice is ahead of its copy, and every second while the backend does not answer.
The answer is unordered; the panel orders it.

## Panel

`live-now-model.ts` (pure) and `LiveNowPanel.tsx`.

- **Header** — "Live now" and `N running · M need you` (`headerCount`; "1 needs you"); empty with nothing running.
- **Buttons** — "Sessions" and "Roster" open or focus the app's one wide tab at that route
  (`openTab` → `tabs.openApp({ route })`, no project named, so Pomade picks); a failure is logged to the console.
- **Groups** — one per project that has rows: the active project first with a "current" tag, then projects in
  Projects panel order, the Workspace last (`groupRows`). Inside a group: Needs you → Working → Idle, then
  the latest `since` first, ties by tab or run key (`byUrgency`).
- **Row** — live mark, title, time since (`formatAgo`), state word · agent. The agent shown is the row's
  `agent`, the roster id; `agentName` is used only as the title's last fallback. Title: a run's job name; a
  tab's session name, else its first message in grey, else the agent's name (`rowTitle`). Run rows carry a ⏱
  and "unattended · <agent>". The tooltip is "Working since 09:05 — switches project and focuses the tab" /
  "— opens the run’s terminal tab" / "— Runner did not say which terminal it runs in" (`rowTooltip`); the
  mark's own title is the state word.
- **Clicks** — tab row: `agentTabs.focus` (Pomade switches to the tab's project). Run row:
  `tabs.openAttached({ session: { app: "pomade-runner", session: terminal }, title, projectId })`; a run
  without a known terminal is disabled. Group header: the first tab row's click, else the first run row
  with a terminal (`groupTarget`); nothing when it has neither.
- **Empty** — "No agents running — Sessions with an open agent tab and unattended runs show up here."
- **Footer** — `BackendStatus`: "Background: running" with the version, or "not answering" with Pomade's reason.
- The panel opens nothing and sets no badge on its own (`panel.spec.ts`).

## Badge

`keepBadge` sets the `agents` icon's badge (`strip.setBadge`, `urgent: true`) to the number of Needs you rows
whenever it changes, `0` clearing it. It runs in the backend from Pomade's start, so the badge is right before
the panel's frame exists. A new connection starts from no badge; on `pomade.ready` a non-zero count is set
again for a window that came up after the first set. Only tab rows can be Needs you.

## Tests

Unit: `live-now.test.ts` (rows, revisions, badge), `live-now-model.test.ts` (grouping, order, texts).
End-to-end: `live-now.spec.ts` (grouping, order, current project following, clicks, badge from the start and
clearing, empty, a tab coming alive, an unattended run and its terminal), `panel.spec.ts`,
`runner-runs.spec.ts`, `hidden-sessions.spec.ts` ("a hidden session with an agent tab": Live now lists its
tab), `look.spec.ts`.

Tickets: T-014, T-015.
