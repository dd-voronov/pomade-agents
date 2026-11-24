---
doc: docs/user-guide/settings.md
audience: users
holds: the app's Settings page — the skill folders, adding and removing one — for users
kind: reference
---

# Settings

Click the gear at the right of the **Sessions | Roster** bar. The page holds the Agents app's own
settings, kept in `Apps/pomade-agents/settings.yaml` in your workspace, so they travel with it.

## Skill folders

The folders the app reads skills from, subfolders included. An agent's **Skills** tab groups its
links by these folders, and **Add skill** offers what they hold. Paths are relative to the
workspace; `Agents/_shared/skills` and `Knowledge/_skills` are listed from the start. An agent's own
`skills/` folder is always read and is not listed.

Each row shows the folder, how many skills it holds, and the links into it — `5 links from 3
agents`, or `no links`. A folder that is no longer on disk says **Not found**.

### Add a folder

1. Click **Add folder…** and pick a folder in Pomade's picker.
2. The toast says how many skills **Add skill** now offers, or that the folder holds no skills yet
   (no `SKILL.md` found). **Undo** takes the folder off the list again.

A folder is refused, with the reason in the toast, when it is outside the workspace, is the
workspace itself, is Pomade's own `.pomade`, or sits inside a folder already listed or around one.

### Remove a folder

Click **Remove** on its row. Nothing on disk is deleted — the folder only leaves the list.

- With no links into it, it is removed at once.
- With links, a warning names the agents first: `2 skill links in 1 agent depend on this folder`.
  The links stay and keep working; **Add skill** stops offering the folder's skills, and the Skills
  tab shows those links as "not in Skill folders". **Remove from the list** confirms, **Cancel**
  keeps the folder.
- **Undo** on the toast puts the folder back.

## When the page cannot change anything

A line at the top says why, and **Add folder…** and **Remove** are off:

- no workspace is open in Pomade;
- `settings.yaml` cannot be used (not valid YAML, for example) — the app never writes over such a
  file; fix it by hand and the page follows. Meanwhile the app reads the two default folders.

You can edit `settings.yaml` by hand at any time: the page and the Skills tabs follow the file.
