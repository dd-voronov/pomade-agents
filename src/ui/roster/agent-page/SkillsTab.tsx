// Skills: the agent's `skills/` entries grouped by skill folder — the Settings list's folders, then
// a folder a link points into that Settings no longer lists (marked), then the agent's own. A
// link's switch takes it away (off) or makes it again (on), with Undo; an own skill (a real folder)
// has no switch. **Add skill** links a skill of the skill folders' catalog. A link switched off
// stays in its row while the tab is open, so switching never moves a row. Codex has no skills.

import { useRef, useState, type ReactElement } from "react";
import { HostError } from "pomade-kit/sdk";

import type { AgentSkillEntry, SkillLinkResult, SkillsCatalog } from "../../../shared/skills.ts";
import { FolderIcon, PlusIcon } from "../../core/icons.tsx";
import { Menu, type MenuEntry } from "../../core/Menu.tsx";
import { SETTINGS_ROUTE } from "../../core/routes.ts";
import { Switch } from "../../core/Switch.tsx";
import { useSkillsCatalog } from "../../settings/useSkillsCatalog.ts";
import type { AgentContext } from "./agent-context.ts";
import { Section } from "./Section.tsx";
import styles from "./page.module.css";
import skills from "./skills-tab.module.css";
import { addableSkills, agentSkills, alsoText, skillGroups, type AddableSkill, type SkillRow } from "./skills-model.ts";

/** Why a write did not go through, in plain words; the backend's own message is the hover text. */
function failure(err: unknown): { text: string; title: string } {
  const message = err instanceof Error ? err.message : String(err);
  const code = err instanceof HostError ? err.code : null;
  const cause =
    code === "not-ready" || code === "not-found"
      ? message
      : code === "io-error"
        ? "The skills folder could not be written."
        : code === "app-absent" || code === "app-not-responding"
          ? "The Agents backend is not answering."
          : "Something went wrong.";
  return { text: `The link was not changed. ${cause}`, title: message };
}

const entryOf = (catalog: SkillsCatalog, agent: string, name: string): AgentSkillEntry | undefined => agentSkills(catalog, agent)?.entries.find((e) => e.name === name);

export function SkillsTab({ context }: { context: AgentContext }): ReactElement {
  const { host, entry, show, navigate } = context;
  const agent = entry.id;
  const { catalog, link, unlink } = useSkillsCatalog(host);
  /** The links switched off while this agent's tab is open: they keep their rows, off. */
  const [off, setOff] = useState<{ agent: string; entries: AgentSkillEntry[] }>({ agent, entries: [] });
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const [query, setQuery] = useState("");
  const addButton = useRef<HTMLButtonElement>(null);

  if (entry.profile?.provider === "codex") {
    return (
      <Section title="Skills" testId="agent-skills">
        <div className={styles.block}>
          <p className={styles.none} data-testid="skills-none">
            Codex reads no <code className={skills.code}>skills/</code> folder. Skills for Codex-based agents come later.
          </p>
        </div>
      </Section>
    );
  }

  const mine = catalog === null ? null : agentSkills(catalog, agent);
  const where = entry.profile === null ? (mine?.dir ?? "skills") : `${entry.profile.configDir}/skills`;
  const offHere = off.agent === agent ? off.entries : [];

  /** Run one write for `name`, its switch disabled meanwhile; `done` gets the answer when it went through. */
  const write = async (name: string, call: () => Promise<SkillLinkResult>, done: (result: Extract<SkillLinkResult, { ok: true }>) => void): Promise<void> => {
    setPending((p) => new Set(p).add(name));
    try {
      const result = await call();
      if (result.ok) done(result);
      else show(`The link was not changed: ${result.reason}`, null);
    } catch (err) {
      const { text, title } = failure(err);
      show(text, null, title);
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(name);
        return next;
      });
    }
  };

  const remember = (gone: AgentSkillEntry): void =>
    setOff((prev) => ({ agent, entries: [...(prev.agent === agent ? prev.entries : []).filter((e) => e.name !== gone.name), gone] }));

  /** Take the link away; it keeps its row, off. `undoable`: the toast offers to make it again. */
  const removeLink = (was: AgentSkillEntry, undoable: boolean): Promise<void> =>
    write(
      was.name,
      () => unlink({ agent, name: was.name }),
      (result) => {
        remember(was);
        if (undoable) show(`Removed the link ${where}/${was.name}`, () => void makeLink(was.name, result.target, false));
      },
    );

  /** Make the link `name` → `target` (absolute or workspace-relative). `undoable`: the toast offers to take it away. */
  const makeLink = (name: string, target: string, undoable: boolean): Promise<void> =>
    write(
      name,
      () => link({ agent, name, target }),
      (result) => {
        const made = entryOf(result.catalog, agent, name);
        if (!undoable || made === undefined) return;
        show(`Linked ${where}/${name} → ${made.targetPath ?? made.target ?? target}`, () => void removeLink(made, false));
      },
    );

  const toggle = (row: SkillRow): void => {
    const { entry: was } = row;
    if (row.on) void removeLink(was, true);
    else if (was.target !== null) void makeLink(was.name, was.target, true);
  };

  const add = (skill: AddableSkill): void => {
    setMenu(null);
    void makeLink(skill.name, skill.skill.path, true);
  };

  const openMenu = (): void => {
    const box = addButton.current?.getBoundingClientRect();
    if (box === undefined) return;
    setQuery("");
    setMenu(box);
  };

  const groups = catalog === null || mine === null ? [] : skillGroups(catalog, mine, offHere);

  return (
    <Section
      title="Skills"
      testId="agent-skills"
      action={
        <button
          ref={addButton}
          type="button"
          className={`${styles.btn} ${styles.sm}`}
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          disabled={mine === null}
          data-testid="add-skill"
          onClick={openMenu}
        >
          <PlusIcon size={14} />
          Add skill
        </button>
      }
    >
      <p className={skills.lead}>
        Links in <code className={skills.code}>{where}/</code> to skills in the{" "}
        <button type="button" className={styles.link} data-testid="skills-settings" onClick={() => navigate(SETTINGS_ROUTE)}>
          Skill folders…
        </button>{" "}
        Off removes the link, on creates it; a new session picks the change up.
      </p>
      <div className={`${styles.block} ${styles.flush}`} data-testid="skills-list">
        {catalog === null ? (
          <p className={`${styles.none} ${styles.pad}`}>Reading the skills…</p>
        ) : mine === null ? (
          <p className={`${styles.none} ${styles.pad}`} data-testid="skills-none">
            This agent’s <code className={skills.code}>skills/</code> folder is not read: its profile names no Claude Code config folder the app can find.
          </p>
        ) : groups.length === 0 ? (
          <p className={`${styles.none} ${styles.pad}`} data-testid="skills-empty">
            No skills linked.
          </p>
        ) : (
          groups.map((group) => (
            <div key={`${group.kind}:${group.label}`} className={skills.box} data-testid="skill-group" data-label={group.label} data-kind={group.kind}>
              <div className={skills.group}>
                <span className={skills.src} title={group.label}>
                  {group.label}
                </span>
                <span className={skills.count} data-testid="skill-group-count">
                  {group.on}
                </span>
                {group.kind === "unlisted" && (
                  <span className={skills.note} data-testid="skill-group-note" title="Settings no longer lists this folder: Add skill does not offer its skills, the links keep working.">
                    not in Skill folders
                  </span>
                )}
              </div>
              {group.rows.map((row) => (
                <Row key={row.entry.name} row={row} busy={pending.has(row.entry.name)} onToggle={() => toggle(row)} />
              ))}
            </div>
          ))
        )}
      </div>
      {menu !== null && catalog !== null && mine !== null && (
        <Menu
          entries={addEntries(catalog, addableSkills(catalog, mine, query), query, setQuery, add, () => navigate(SETTINGS_ROUTE))}
          anchor={menu}
          onClose={() => setMenu(null)}
          label="Add skill"
          testId="add-skill-menu"
          wide
        />
      )}
    </Section>
  );
}

/** Where a broken link points, as the catalog writes paths: workspace-relative inside the workspace. */
function brokenPath(entry: AgentSkillEntry): string {
  const target = entry.target ?? "";
  return entry.targetFolder === null ? target : `${entry.targetFolder}/${target.slice(target.lastIndexOf("/") + 1)}`;
}

function Row({ row, busy, onToggle }: { row: SkillRow; busy: boolean; onToggle: () => void }): ReactElement {
  const { entry, on, also } = row;
  const own = entry.kind === "own";
  const title = entry.broken ? "Broken — remove the link" : on ? "On — remove the link" : "Off — create the link";
  return (
    <div className={skills.row} data-testid="skill-row" data-name={entry.name} data-on={on} data-kind={entry.kind} data-broken={entry.broken || undefined}>
      {own ? (
        <span className={skills.own} title="A folder in the agent’s own skills/, not a link: the app never removes it">
          own
        </span>
      ) : (
        <Switch on={on} label={entry.name} title={title} disabled={busy} testId="skill-switch" onChange={onToggle} />
      )}
      <span className={skills.name} title={entry.name}>
        {entry.name}
      </span>
      {entry.broken ? (
        <span className={`${skills.desc} ${skills.brokenText}`} title={`Nothing is at ${entry.target ?? ""}`} data-testid="skill-broken">
          Nothing at {brokenPath(entry)}
        </span>
      ) : (
        <span className={skills.desc} title={entry.description ?? undefined}>
          {entry.description}
        </span>
      )}
      {entry.broken ? (
        <span className={`${skills.also} ${skills.brokenMark}`}>broken link</span>
      ) : (
        <span className={skills.also} title={also.join(", ") || undefined} data-testid="skill-also">
          {own ? "" : alsoText(also)}
        </span>
      )}
    </div>
  );
}

function addEntries(
  catalog: SkillsCatalog,
  groups: ReturnType<typeof addableSkills>,
  query: string,
  setQuery: (q: string) => void,
  add: (skill: AddableSkill) => void,
  toSettings: () => void,
): MenuEntry[] {
  const entries: MenuEntry[] = [{ kind: "search", value: query, placeholder: "Search the catalog", onChange: setQuery }];
  for (const group of groups) {
    entries.push({ kind: "head", label: group.folder, mono: true });
    for (const skill of group.skills) {
      const n = skill.skill.agents.length;
      entries.push({
        kind: "item",
        id: `add-${skill.name}`,
        label: skill.skill.name,
        ...(skill.skill.description === null ? {} : { detail: skill.skill.description }),
        ...(n === 0 ? {} : { trail: `in ${n}` }),
        ...(skill.blocked === null ? {} : { disabled: { why: skill.blocked } }),
        run: () => add(skill),
      });
    }
  }
  if (groups.length === 0) {
    entries.push({ kind: "note", text: catalog.folders.length === 0 ? "No skill folders: add one in Settings." : "Nothing matches — or every skill is already linked." });
  }
  entries.push({ kind: "separator" });
  entries.push({ kind: "item", id: "skill-folders", label: "Skill folders…", glyph: <FolderIcon size={14} />, trail: `${catalog.folders.length} in Settings`, run: toSettings });
  return entries;
}
