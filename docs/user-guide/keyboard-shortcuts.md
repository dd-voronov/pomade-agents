---
doc: docs/user-guide/keyboard-shortcuts.md
audience: users
holds: every keyboard and pointer shortcut of the app
kind: reference
---

# Keyboard shortcuts

Cmd means Ctrl on Windows and Linux. The Sessions tab's keys work while the tab has focus, no menu is open
and the cursor is not in a text field; fields have their own keys (below). The Roster tab and the Live now
panel have no keys of their own beyond their menus and fields.

## Sessions tab

The **key row** is the selected session in the list, or, in the table, the row marked after the panel
closed.

| Keys | What it does |
|---|---|
| ↑ ↓ | Select the previous / next session, in the table too (the table becomes the list); ↓ with nothing marked selects the first, ↑ the last |
| Shift+↑ Shift+↓ | Check the key row and its neighbour and move on; in the list the selection moves too, in the table the panel stays closed |
| Space | Check or uncheck the key row |
| Cmd+A | Check every row shown |
| Enter | **Open tab** / **Resume** the key row |
| F2 | Rename the key row in the panel |
| / | Focus the search field and select its text |
| Esc | Clear the checks; with none, close the panel |
| Double-click a row | Open tab / Resume it |
| Click a row | Select it |
| Cmd+click a row | Check or uncheck it |
| Shift+click a row or a checkbox | Check the range from the last checked or clicked row |
| Right-click a row | Its menu |

## Search field

| Keys | What it does |
|---|---|
| Esc | Clear the search; with it empty, leave the field |
| ↓ | Leave the field and select the first row |

## Panel fields

| Keys | What it does |
|---|---|
| Enter | Save the name (name field) or the note (note field) |
| Esc | Name field: keep the old name. Note field: discard the change |
| Leaving the field | Saves, as Enter |

## Menus

The row menu, **Move to project**, the filter menus, and the Roster's **Start session ▾**, ⋯, **Re-link ▾**,
**Add skill** and model menus.

| Keys | What it does |
|---|---|
| ↑ ↓ | Move between items (wraps) |
| Home End | First / last item |
| Enter | Run the item |
| Esc, Tab | Close the menu |
| ↓ in a menu's search field | Move to the first item |
| Enter in a menu's search field | Run the first item |

## Roster fields

| Keys | What it does |
|---|---|
| Enter on the role line | Edit it; Enter in the field saves, Esc keeps the old one |
| Enter or `,` in a tag field | Add the tag and keep the field open |
| Esc in a tag field | Close the field without adding |
| Enter in the New agent page's name or role field | **Create agent** |
| Backspace in the New agent page's empty tag field | Remove the last tag |

## Source

| Shortcut | Source |
|---|---|
| Esc, `/`, F2, Enter, Cmd+A, Space, ↑ ↓, Shift+↑↓ | `src/ui/sessions/SessionsTab.tsx:301`, `:308`, `:314`, `:322`, `:329`, `:335`, `:344` |
| Click, Cmd+click, Shift+click, double-click | `src/ui/sessions/SessionsTab.tsx:258` (`onTabClick`), `:269` (`events.onClick`), `:284` (`events.onCheck`) |
| Search field's Esc and ↓ | `src/ui/sessions/Toolbar.tsx:40`, `:44` |
| Name and note fields | `src/ui/sessions/DetailPanel.tsx:147`, `:234` |
| Menus | `src/ui/core/Menu.tsx:103` |
| Role line, tag field | `src/ui/roster/profile-edit/RoleLine.tsx:97`, `src/ui/roster/profile-edit/TagList.tsx:98`, `:106` |
| New agent page's fields | `src/ui/roster/new-agent/NewAgentPage.tsx:154`, `:160` |
