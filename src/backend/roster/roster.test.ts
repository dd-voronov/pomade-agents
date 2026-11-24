import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkRosterList } from "pomade-kit/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RosterChanged } from "../../shared/roster.ts";
import { openRecordStore, type RecordStore } from "../records/record-store.ts";
import { resolveConfigDir, startRoster, type Roster } from "./roster.ts";

const SOON = { timeout: 3000, interval: 25 };
const FULL = ["--dangerously-skip-permissions"];

describe("the roster", () => {
  let dir: string;
  let home: string;
  let workspace: string;
  let dataDir: string;
  let records: RecordStore | null = null;
  let roster: Roster | null = null;
  const lines: string[] = [];
  const notices: RosterChanged[] = [];

  const agentFolder = async (name: string, claudeMd = `# ${name}\n\n## Role\n\nThe ${name} agent. More.\n`): Promise<void> => {
    await mkdir(join(workspace, "Agents", name), { recursive: true });
    await writeFile(join(workspace, "Agents", name, "CLAUDE.md"), claudeMd);
  };
  const profilePath = (id: string): string => join(dataDir, "agents", id, "agent.yaml");
  const writeProfile = async (id: string, text: string): Promise<void> => {
    await mkdir(join(dataDir, "agents", id), { recursive: true });
    await writeFile(profilePath(id), text);
  };
  const start = async (options: { workspace?: string | null } = {}): Promise<Roster> => {
    const ws = options.workspace === undefined ? workspace : options.workspace;
    records = ws === null ? null : await openRecordStore({ dataDir, now: () => new Date(), log: (line) => lines.push(line) });
    roster = startRoster({ home, workspace: ws, profiles: records?.profiles ?? null, noProfiles: "No workspace is open.", log: (line) => lines.push(line), tickMs: 100 });
    roster.onChange((changed) => notices.push(changed));
    await roster.refresh();
    return roster;
  };
  const ids = (r: Roster): string[] => r.list().map((a) => a.id);

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), "pa-roster-")));
    home = join(dir, "home");
    workspace = join(dir, "workspace");
    dataDir = join(workspace, "Apps", "pomade-agents");
    await mkdir(join(home, ".claude"), { recursive: true });
    await mkdir(join(home, ".codex"), { recursive: true });
    await writeFile(join(home, ".claude", "settings.json"), JSON.stringify({ model: "opus", effortLevel: "high" }));
    await writeFile(join(home, ".codex", "config.toml"), 'model = "gpt-5.2-codex"\nmodel_reasoning_effort = "medium"\n');
    await agentFolder("claude-libra");
    await agentFolder("_shared");
    await agentFolder("Claude Agent Template");
    await mkdir(join(workspace, "Agents", "no-marker"), { recursive: true });
    lines.length = 0;
    notices.length = 0;
  });

  afterEach(async () => {
    roster?.stop();
    roster = null;
    await records?.stop();
    records = null;
    await rm(dir, { recursive: true, force: true });
  });

  it("holds the built-ins and the folder agents, each with an agent.yaml written at first sight", async () => {
    await agentFolder("odd name");
    const r = await start();
    await expect.poll(() => readdir(join(dataDir, "agents")).catch(() => []), SOON).toEqual(["claude", "claude-libra", "codex"]);
    expect(await readFile(profilePath("claude-libra"), "utf8")).toBe(
      [
        "id: claude-libra",
        "provider: claude",
        "kind: folder",
        "configDir: Agents/claude-libra",
        "command: claude-libra",
        "role: The claude-libra agent.",
        "tags: []",
        "hidden: false",
        "modes:",
        "  normal:",
        "    enabled: true",
        "  full-autonomy:",
        "    enabled: true",
        "",
      ].join("\n"),
    );
    expect(await readFile(profilePath("codex"), "utf8")).toContain("configDir: ~/.codex\n");
    await expect.poll(() => r.answer().agents.every((a) => a.profile !== null), SOON).toBe(true);
    expect(r.answer().agents.map((a) => [a.id, a.name, a.model, a.effort, a.orphan, a.configDir])).toEqual([
      ["claude", "Claude", "opus", "high", false, join(home, ".claude")],
      ["codex", "Codex", "gpt-5.2-codex", "medium", false, join(home, ".codex")],
      ["claude-libra", "claude-libra", null, null, false, join(workspace, "Agents", "claude-libra")],
    ]);
    await r.refresh();
    expect(lines.filter((line) => line.includes('"odd name" cannot name a profile'))).toHaveLength(1);
  });

  it("answers roster.list in Pomade's RosterAgent shape, which Pomade's check takes unchanged", async () => {
    const r = await start();
    const list = r.list();
    expect(checkRosterList({ agents: list })).toEqual({ ok: true, agents: list });
    expect(list).toEqual([
      { id: "claude", name: "Claude", command: "claude", provider: "claude", configDir: join(home, ".claude"), modes: [{ id: "normal", name: "Normal", args: [] }, { id: "full-autonomy", name: "Full autonomy", args: FULL }] },
      {
        id: "codex",
        name: "Codex",
        command: "codex",
        provider: "codex",
        configDir: join(home, ".codex"),
        modes: [{ id: "normal", name: "Normal", args: [] }, { id: "full-autonomy", name: "Full autonomy", args: ["--dangerously-bypass-approvals-and-sandbox"] }],
      },
      { id: "claude-libra", name: "claude-libra", command: "claude-libra", provider: "claude", configDir: join(workspace, "Agents", "claude-libra"), modes: expect.any(Array) },
    ]);
  });

  it("imports Pomade's command overrides and hidden agents at first sight, and leaves hidden agents out of the list", async () => {
    await mkdir(join(workspace, ".pomade"), { recursive: true });
    await writeFile(join(workspace, ".pomade", "agents.json"), JSON.stringify({ commands: { "claude-libra": "libra" }, hidden: ["codex"] }));
    const r = await start();
    await expect.poll(() => readFile(profilePath("codex"), "utf8").catch(() => ""), SOON).toContain("hidden: true");
    expect(await readFile(profilePath("claude-libra"), "utf8")).toContain("command: libra\n");
    expect(ids(r)).toEqual(["claude", "claude-libra"]);
    expect(r.list().find((a) => a.id === "claude-libra")?.command).toBe("libra");
    expect(r.answer().agents.map((a) => [a.id, a.hidden])).toEqual([["claude", false], ["codex", true], ["claude-libra", false]]);
  });

  it("follows a profile edited on disk: hidden, a mode disabled, with a change notice", async () => {
    const r = await start();
    await expect.poll(() => r.answer().agents.every((a) => a.profile !== null), SOON).toBe(true);
    const before = notices.length;
    const text = await readFile(profilePath("claude-libra"), "utf8");
    await writeFile(profilePath("claude-libra"), text.replace("full-autonomy:\n    enabled: true", "full-autonomy:\n    enabled: false"));
    await expect.poll(() => r.list().find((a) => a.id === "claude-libra")?.modes?.map((m) => m.id), SOON).toEqual(["normal"]);
    expect(notices.length).toBeGreaterThan(before);
    expect(notices.at(-1)).toEqual({ epoch: r.answer().epoch, revision: r.answer().revision });
    await writeFile(profilePath("claude-libra"), text.replace("hidden: false", "hidden: true"));
    await expect.poll(() => ids(r), SOON).toEqual(["claude", "codex"]);
    expect(r.agent("claude-libra")?.profile.hidden).toBe(true);
  });

  it("never writes over a profile that is there: an unusable one is reported, and its agent answers from first sight", async () => {
    await writeProfile("claude-libra", "id: [\n");
    await writeProfile("claude", "id: claude\nprovider: claude\nkind: builtin\nconfigDir: ~/.claude\ncommand: my-claude\nmodes:\n  normal: { enabled: true }\n");
    const r = await start();
    await expect.poll(() => readdir(join(dataDir, "agents")).catch(() => []), SOON).toEqual(["claude", "claude-libra", "codex"]);
    expect(await readFile(profilePath("claude-libra"), "utf8")).toBe("id: [\n");
    expect(r.answer().agents.find((a) => a.id === "claude-libra")).toMatchObject({ profile: null, problem: expect.stringContaining("not valid YAML"), configDir: null, provider: "claude", kind: "folder", hidden: false });
    expect(r.list().find((a) => a.id === "claude-libra")).toMatchObject({ command: "claude-libra" });
    expect(r.list().find((a) => a.id === "claude")).toMatchObject({ command: "my-claude", modes: [{ id: "normal", name: "Normal", args: [] }] });
    expect(await readFile(profilePath("claude"), "utf8")).not.toContain("tags");
  });

  it("keeps a renamed folder's profile as an orphan, out of the list, and takes the new folder as a new agent", async () => {
    const r = await start();
    await expect.poll(() => r.answer().agents.every((a) => a.profile !== null), SOON).toBe(true);
    await rename(join(workspace, "Agents", "claude-libra"), join(workspace, "Agents", "claude-librarian"));
    await expect.poll(() => ids(r), SOON).toEqual(["claude", "codex", "claude-librarian"]);
    expect(r.answer().agents.find((a) => a.id === "claude-libra")).toMatchObject({ orphan: true, profile: { configDir: "Agents/claude-libra" } });
    await expect.poll(() => readFile(profilePath("claude-librarian"), "utf8").catch(() => ""), SOON).toContain("configDir: Agents/claude-librarian\n");
    expect(r.agent("claude-libra")?.orphan).toBe(true);
  });

  it("takes a folder a profile names as that profile's agent, never a new one; a built-in is never an orphan", async () => {
    await writeProfile("librarian", "id: librarian\nprovider: claude\nkind: folder\nconfigDir: Agents/claude-libra\ncommand: claude-libra\nmodes:\n  normal: { enabled: true }\n");
    await rm(join(home, ".codex"), { recursive: true });
    const r = await start();
    await expect.poll(() => readdir(join(dataDir, "agents")).catch(() => []), SOON).toEqual(["claude", "codex", "librarian"]);
    expect(ids(r)).toEqual(["claude", "codex", "librarian"]);
    expect(r.answer().agents.find((a) => a.id === "codex")).toMatchObject({ orphan: false, model: null });
  });

  it("follows a new folder agent and the provider's config within a couple of ticks", async () => {
    const r = await start();
    await agentFolder("claude-pm");
    await writeFile(join(home, ".claude", "settings.json"), JSON.stringify({ model: "sonnet" }));
    await expect.poll(() => ids(r), SOON).toEqual(["claude", "codex", "claude-libra", "claude-pm"]);
    await expect.poll(() => r.answer().agents[0]?.model, SOON).toBe("sonnet");
    expect(r.answer().agents[0]?.effort).toBeNull();
  });

  it("without a workspace holds the built-ins from first sight and keeps no profiles", async () => {
    const r = await start({ workspace: null });
    expect(ids(r)).toEqual(["claude", "codex"]);
    expect(r.answer()).toMatchObject({ profilesOff: "No workspace is open.", agents: [{ id: "claude", profile: null, provider: "claude", kind: "builtin" }, { id: "codex", profile: null, provider: "codex", kind: "builtin" }] });
  });

  it("writes a role and tags into agent.yaml, only those keys, keeping the file's comments and other keys, and answers the profile", async () => {
    const r = await start();
    await expect.poll(() => r.answer().agents.every((a) => a.profile !== null), SOON).toBe(true);
    const text = await readFile(profilePath("claude-libra"), "utf8");
    await writeFile(profilePath("claude-libra"), `# kept\n${text}extra: 1\n`);
    await expect.poll(async () => (await readFile(profilePath("claude-libra"), "utf8")).startsWith("# kept"), SOON).toBe(true);
    const written = await r.updateProfile("claude-libra", { role: "Files the vault.", tags: ["vault", "knowledge"] });
    expect(written).toMatchObject({ id: "claude-libra", role: "Files the vault.", tags: ["vault", "knowledge"] });
    const after = await readFile(profilePath("claude-libra"), "utf8");
    expect(after).toContain("# kept\n");
    expect(after).toContain("role: Files the vault.\n");
    expect(after).toContain("extra: 1\n");
    expect(after.replace("role: Files the vault.", "role: The claude-libra agent.").replace(/tags:\n  - vault\n  - knowledge\n|tags: \[\s*vault,\s*knowledge\s*\]\n/, "tags: []\n")).toBe(`# kept\n${text}extra: 1\n`);
    expect(r.answer().agents.find((a) => a.id === "claude-libra")?.profile).toMatchObject({ role: "Files the vault.", tags: ["vault", "knowledge"] });
    await r.updateProfile("claude-libra", { role: null });
    expect(await readFile(profilePath("claude-libra"), "utf8")).not.toContain("role:");
    expect(r.answer().agents.find((a) => a.id === "claude-libra")?.profile?.role).toBeUndefined();
  });

  it("writes the first file of an agent that has none yet, and refuses what it cannot use: an unusable file, an orphan, an unknown agent, no profiles", async () => {
    await writeProfile("claude-libra", "id: [\n");
    const r = await start();
    await expect(r.updateProfile("claude-libra", { role: "x" })).rejects.toMatchObject({ code: "io-error" });
    expect(await readFile(profilePath("claude-libra"), "utf8")).toBe("id: [\n");
    await expect(r.updateProfile("ghost", { role: "x" })).rejects.toMatchObject({ code: "not-found" });
    await r.updateProfile("codex", { tags: ["cli"] });
    expect(await readFile(profilePath("codex"), "utf8")).toContain("cli");
    await rename(join(workspace, "Agents", "claude-libra"), join(workspace, "Agents", "claude-librarian"));
    await writeFile(profilePath("claude-libra"), "id: claude-libra\nprovider: claude\nkind: folder\nconfigDir: Agents/claude-libra\ncommand: claude-libra\nmodes:\n  normal: { enabled: true }\n");
    await expect.poll(() => r.agent("claude-libra")?.orphan, SOON).toBe(true);
    await expect(r.updateProfile("claude-libra", { role: "x" })).rejects.toMatchObject({ code: "not-found" });
    await expect(r.permissions("claude-libra")).rejects.toMatchObject({ code: "not-found" });
  });

  it("refuses an edit when no profiles are kept", async () => {
    const r = await start({ workspace: null });
    await expect(r.updateProfile("claude", { role: "x" })).rejects.toMatchObject({ code: "not-ready" });
  });

  it("reads an agent's permissions and memory from its config folder", async () => {
    const r = await start();
    await writeFile(join(workspace, "Agents", "claude-libra", "settings.json"), JSON.stringify({ permissions: { allow: ["Edit(Knowledge/**)"], deny: ["Bash(rm:*)"] }, enabledPlugins: { "easel@market": true, "off@market": false } }));
    await mkdir(join(workspace, "Agents", "claude-libra", "projects", "-w-Projects-beta", "memory"), { recursive: true });
    await writeFile(join(workspace, "Agents", "claude-libra", "projects", "-w-Projects-beta", "memory", "MEMORY.md"), "# memory\n");
    expect(await r.permissions("claude-libra")).toMatchObject({ provider: "claude", exists: true, allow: ["Edit(Knowledge/**)"], deny: ["Bash(rm:*)"], plugins: ["easel@market"] });
    expect(await r.memory("claude-libra")).toEqual({ folders: [{ folder: "-w-Projects-beta", files: [{ name: "MEMORY.md", path: join(workspace, "Agents", "claude-libra", "projects", "-w-Projects-beta", "memory", "MEMORY.md") }] }] });
    expect(await r.permissions("codex")).toMatchObject({ provider: "codex", file: join(home, ".codex", "config.toml") });
    expect(await r.memory("codex")).toEqual({ folders: [] });
  });

  it("hides an agent from the list and shows it again, keeping it in the roster's answer", async () => {
    const r = await start();
    await expect.poll(() => r.agent("claude-libra")?.profile.role, SOON).toBe("The claude-libra agent.");
    await r.updateProfile("claude-libra", { hidden: true });
    expect(await readFile(profilePath("claude-libra"), "utf8")).toContain("hidden: true");
    expect(ids(r)).not.toContain("claude-libra");
    expect(r.answer().agents.find((a) => a.id === "claude-libra")?.hidden).toBe(true);
    await r.updateProfile("claude-libra", { hidden: false });
    expect(ids(r)).toContain("claude-libra");
  });

  describe("an orphan", () => {
    /** claude-libra's folder renamed outside the app: the profile is an orphan, the new folder an agent of its own. */
    const renamed = async (r: Roster): Promise<void> => {
      await expect.poll(() => readFile(profilePath("claude-libra"), "utf8").catch(() => ""), SOON).toContain("id: claude-libra");
      await r.updateProfile("claude-libra", { tags: ["vault"] });
      await rename(join(workspace, "Agents", "claude-libra"), join(workspace, "Agents", "claude-librarian"));
      await expect.poll(() => r.agent("claude-libra")?.orphan, SOON).toBe(true);
      await expect.poll(() => readFile(profilePath("claude-librarian"), "utf8").catch(() => ""), SOON).toContain("id: claude-librarian");
    };

    it("is re-linked to the folder it was renamed to: its profile names that folder, the folder's first-sight profile goes, and it is back in the list", async () => {
      const r = await start();
      await agentFolder("claude-coder");
      await renamed(r);
      await expect.poll(() => readFile(profilePath("claude-coder"), "utf8").catch(() => ""), SOON).toContain("id: claude-coder");
      await r.updateProfile("claude-coder", { tags: ["code"] });
      // claude-coder's own profile was edited: it is that agent's folder now, not unclaimed.
      expect(await r.unclaimedFolders()).toEqual([{ name: "claude-librarian", configDir: "Agents/claude-librarian" }]);
      const { profile: written } = await r.relink("claude-libra", "claude-librarian");
      expect(written).toMatchObject({ id: "claude-libra", configDir: "Agents/claude-librarian", tags: ["vault"] });
      expect(await readFile(profilePath("claude-libra"), "utf8")).toContain("configDir: Agents/claude-librarian");
      await expect(readFile(profilePath("claude-librarian"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      expect(r.agent("claude-libra")?.orphan).toBe(false);
      expect(ids(r)).toContain("claude-libra");
      expect(ids(r)).not.toContain("claude-librarian");
      // A tick later the folder is still claude-libra's: no first-sight profile comes back.
      await new Promise((done) => setTimeout(done, 300));
      expect(r.answer().agents.map((a) => a.id)).not.toContain("claude-librarian");
      expect(await r.unclaimedFolders()).toEqual([]);
    });

    it("is re-linked and the re-link taken back: both agent.yaml files and the roster are exactly as before", async () => {
      const r = await start();
      await renamed(r);
      const files = async (): Promise<string[]> => Promise.all(["claude-libra", "claude-librarian"].map((id) => readFile(profilePath(id), "utf8")));
      const roster = (): unknown => r.answer().agents.map(({ id, orphan, hidden, profile }) => ({ id, orphan, hidden, profile }));
      await expect.poll(() => r.answer().agents.find((a) => a.id === "claude-librarian")?.profile?.id, SOON).toBe("claude-librarian");
      const before = await files();
      const listed = ids(r);
      const answer = roster();
      const { undo } = await r.relink("claude-libra", "claude-librarian");
      expect(undo).toEqual({ agent: "claude-libra", agentText: before[0], folder: "claude-librarian", profileText: before[1] });
      await r.undoRelink(undo);
      expect(await files()).toEqual(before);
      expect(r.agent("claude-libra")?.orphan).toBe(true);
      expect(ids(r)).toEqual(listed);
      expect(roster()).toEqual(answer);
      // A tick later first sight has nothing to rewrite.
      await new Promise((done) => setTimeout(done, 300));
      expect(await files()).toEqual(before);
      expect(roster()).toEqual(answer);
      // Taken back once: a second Undo has nothing to take back.
      await expect(r.undoRelink(undo)).rejects.toMatchObject({ code: "invalid-params" });
    });

    it("takes nothing back from a text that is not the folder's profile: the re-link stands", async () => {
      const r = await start();
      await renamed(r);
      const { undo } = await r.relink("claude-libra", "claude-librarian");
      await expect(r.undoRelink({ ...undo, profileText: "id: someone-else\n" })).rejects.toMatchObject({ code: "invalid-params" });
      expect(r.agent("claude-libra")?.orphan).toBe(false);
      expect(await readFile(profilePath("claude-libra"), "utf8")).toContain("configDir: Agents/claude-librarian\n");
    });

    it("refuses a re-link to a folder that is not unclaimed, and of an agent that is not an orphan", async () => {
      const r = await start();
      await agentFolder("claude-coder");
      await renamed(r);
      await expect.poll(() => readFile(profilePath("claude-coder"), "utf8").catch(() => ""), SOON).toContain("id: claude-coder");
      await r.updateProfile("claude-coder", { role: "Mine." });
      await expect(r.relink("claude-libra", "claude-coder")).rejects.toMatchObject({ code: "invalid-params" });
      await expect(r.relink("claude-libra", "nowhere")).rejects.toMatchObject({ code: "invalid-params" });
      await expect(r.relink("claude-coder", "claude-librarian")).rejects.toMatchObject({ code: "invalid-params" });
      await expect(r.relink("ghost", "claude-librarian")).rejects.toMatchObject({ code: "not-found" });
      await expect(r.removeOrphan("claude-coder")).rejects.toMatchObject({ code: "invalid-params" });
      expect(await readFile(profilePath("claude-libra"), "utf8")).toContain("configDir: Agents/claude-libra\n");
    });

    it("is removed: its profile and its folder go, no agent folder is touched", async () => {
      const r = await start();
      await renamed(r);
      await r.removeOrphan("claude-libra");
      await expect(readdir(join(dataDir, "agents", "claude-libra"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(r.answer().agents.map((a) => a.id)).not.toContain("claude-libra");
      expect(await readdir(join(workspace, "Agents"))).toContain("claude-librarian");
      await expect(r.removeOrphan("claude-libra")).rejects.toMatchObject({ code: "not-found" });
    });

    it("cannot be re-linked or removed when no profiles are kept", async () => {
      const r = await start({ workspace: null });
      expect(await r.unclaimedFolders()).toEqual([]);
      await expect(r.relink("claude", "x")).rejects.toMatchObject({ code: "not-ready" });
      await expect(r.removeOrphan("claude")).rejects.toMatchObject({ code: "not-ready" });
    });
  });

  it("resolves a config folder under the home folder, the workspace, or as it is", () => {
    expect(resolveConfigDir("~/.claude", "/h", "/w")).toBe("/h/.claude");
    expect(resolveConfigDir("Agents/x", "/h", "/w")).toBe("/w/Agents/x");
    expect(resolveConfigDir("/abs/x", null, null)).toBe("/abs/x");
    expect(resolveConfigDir("Agents/x", "/h", null)).toBeNull();
  });
});
