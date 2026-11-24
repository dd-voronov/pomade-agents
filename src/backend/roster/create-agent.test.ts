// The Create from the template or as a clone in a throwaway workspace, with a scripted zsh: the name
// check's order, the steps as they tick, the agent appearing whole, a failure in its first three
// steps leaving nothing behind, a failed connection or alias keeping the agent, a clone taking only
// the allowed entries of its source, and the first tab opening only once the alias resolves.

import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AgentProfile, CreateAgentParams, CreateStep } from "../../shared/roster.ts";
import { openRecordStore, type RecordStore } from "../records/record-store.ts";
import { copyCloned, createAgentCreation, stagingName, stepBoard, TEMPLATE_FOLDER, type CreationOptions } from "./create-agent.ts";
import { aliasCommand, type ZshAnswer } from "./shell.ts";

/** A change on disk reaches the record store through its watch: under a loaded machine that takes more than the default second. */
const WATCH = { timeout: 3000, interval: 25 };
const NONE: ZshAnswer = { alias: null, resolves: false, description: "" };

describe("the step board", () => {
  it("starts with every step to do and hands out a fresh copy on each change", () => {
    const seen: CreateStep[][] = [];
    const board = stepBoard((steps) => seen.push(steps));
    expect(board.steps().map((s) => s.state)).toEqual(["todo", "todo", "todo", "todo", "todo", "todo", "todo"]);
    board.start("folder");
    board.end("folder", "done", "copied");
    board.end("projects", "skip", "none");
    expect(seen.map((steps) => steps.map((s) => s.state).join(" "))).toEqual(["run todo todo todo todo todo todo", "done todo todo todo todo todo todo", "done todo todo skip todo todo todo"]);
    seen[0]?.splice(0);
    expect(board.steps()[0]).toEqual({ id: "folder", state: "done", detail: "copied" });
  });
});

describe("creating an agent", () => {
  let dir: string;
  let workspace: string;
  let dataDir: string;
  let rc: string;
  let records: RecordStore;
  /** What the scripted zsh answers, by name; the alias it learns from the rc file once appended. */
  let shellKnows: Record<string, ZshAnswer>;
  let zshCalls: string[];
  let connected: [string, string][];
  let refreshes: number;
  let logs: string[];
  /** The tabs opened: agent, project. */
  let launched: [string, string][];
  /** The profiles the scripted roster answers for, by id, with their absolute config folders. */
  let rosterAgents: Record<string, { profile: AgentProfile; folder: string; orphan?: true }>;

  const params = (over: Partial<CreateAgentParams> = {}): CreateAgentParams => ({ name: "claude-tax", role: " Files the taxes. ", tags: ["tax"], projects: [], createId: "c1", ...over });

  const creation = (over: Partial<CreationOptions> = {}) =>
    createAgentCreation({
      workspace,
      dataDir,
      profiles: records.profiles,
      rosterIds: () => ["claude", "codex", "claude-libra"],
      refreshRoster: () => {
        refreshes++;
        return Promise.resolve();
      },
      connect: (project, agent) => {
        connected.push([project, agent]);
        return Promise.resolve("connected");
      },
      cloneSource: (id) => {
        const agent = rosterAgents[id];
        if (agent === undefined) return `${id} is not in the roster`;
        return agent.orphan === true ? `${id}’s config folder is gone` : { profile: agent.profile, folder: agent.folder };
      },
      launch: (agent, project) => {
        launched.push([agent, project]);
        return Promise.resolve(`tab-${launched.length}`);
      },
      rcFile: rc,
      zsh: {
        ask: async (name) => {
          zshCalls.push(name);
          const known = shellKnows[name];
          if (known !== undefined) return known;
          const text = await readFile(rc, "utf8").catch(() => "");
          const match = new RegExp(`^alias ${name}='(.*)'$`, "m").exec(text);
          return match === null ? NONE : { alias: match[1] ?? "", resolves: true, description: `${name} is an alias for ${match[1] ?? ""}` };
        },
      },
      log: (line) => logs.push(line),
      ...over,
    });

  const agentsList = async (): Promise<string[]> => (await readdir(join(workspace, "Agents"))).sort();

  beforeEach(async () => {
    dir = await mkdtemp(join(await realpath(tmpdir()), "pa-create-"));
    workspace = join(dir, "ws");
    dataDir = join(workspace, "Apps", "pomade-agents");
    rc = join(dir, "home", ".zshrc");
    await mkdir(join(dir, "home"), { recursive: true });
    const template = join(workspace, "Agents", TEMPLATE_FOLDER);
    await mkdir(join(template, "skills", "own-skill"), { recursive: true });
    await writeFile(join(template, "CLAUDE.md"), "# Agent\n\n## Role\nTBD\n");
    await writeFile(join(template, "settings.json"), "{}\n");
    await writeFile(join(template, "skills", "own-skill", "SKILL.md"), "own\n");
    for (const skill of ["alpha", "beta"]) {
      await mkdir(join(workspace, "Agents", "_shared", "skills", skill), { recursive: true });
      await writeFile(join(workspace, "Agents", "_shared", "skills", skill, "SKILL.md"), skill);
    }
    await writeFile(join(workspace, "Agents", "_shared", "skills", ".DS_Store"), "");
    await symlink("../../_shared/skills/alpha", join(template, "skills", "alpha"));
    await mkdir(join(workspace, "Agents", "claude-libra"), { recursive: true });
    records = await openRecordStore({ dataDir, now: () => new Date("2026-11-24T10:00:00Z"), log: () => undefined });
    shellKnows = {};
    zshCalls = [];
    connected = [];
    refreshes = 0;
    logs = [];
    launched = [];
    rosterAgents = {};
  });
  afterEach(async () => {
    await records.stop();
    await rm(dir, { recursive: true, force: true });
  });

  describe("the name check", () => {
    it("runs its rules, then the folder, then the roster, and asks zsh only about a name that passes them", async () => {
      shellKnows = { ls: { alias: null, resolves: true, description: "ls is /bin/ls" } };
      const c = creation();
      expect((await c.checkName("-x")).problem).toBe("leading-dash");
      expect((await c.checkName("new")).problem).toBe("reserved");
      expect((await c.checkName("claude-libra")).problem).toBe("folder");
      expect((await c.checkName("codex")).problem).toBe("agent");
      expect(zshCalls).toEqual([]);
      expect(await c.checkName("ls")).toEqual({ name: "ls", problem: "shell", detail: "ls is /bin/ls" });
      expect(await c.checkName("claude-tax")).toEqual({ name: "claude-tax", problem: null, detail: null });
      expect(zshCalls).toEqual(["ls", "claude-tax"]);
    });

    it("says when zsh cannot be asked", async () => {
      const c = creation({ zsh: { ask: () => Promise.reject(new Error("zsh did not answer in 15 s")) } });
      expect(await c.checkName("claude-tax")).toEqual({ name: "claude-tax", problem: "shell-error", detail: "zsh did not answer in 15 s" });
    });

    it("refuses a name whose profile exists without its folder", async () => {
      await mkdir(join(dataDir, "agents", "claude-gone"), { recursive: true });
      // Written again on every poll: FSEvents may miss a write made while the watch starts.
      await expect
        .poll(async () => {
          await writeFile(join(dataDir, "agents", "claude-gone", "agent.yaml"), "id: claude-gone\nprovider: claude\nkind: folder\nconfigDir: Agents/elsewhere\ncommand: claude-gone\n");
          return records.profiles.get("claude-gone") !== undefined;
        }, WATCH)
        .toBe(true);
      expect((await creation().checkName("claude-gone")).problem).toBe("agent");
    });
  });

  it("creates the agent whole: the template, the missing shared links, agent.yaml, the projects, the alias once, checked", async () => {
    const seen: string[] = [];
    const result = await creation().create(params({ projects: ["alpha", "beta", "alpha"] }), (steps) => seen.push(steps.map((s) => s.state[0]).join("")));
    const folder = join(workspace, "Agents", "claude-tax");
    expect(result.outcome).toBe("created");
    expect(result.steps.map((s) => [s.id, s.state])).toEqual([
      ["folder", "done"],
      ["skills", "done"],
      ["profile", "done"],
      ["projects", "done"],
      ["alias", "done"],
      ["verify", "done"],
      ["open", "done"],
    ]);
    expect(result.steps[1]?.detail).toBe("Linked beta");
    expect(seen).toEqual(["rtttttt", "dtttttt", "drttttt", "ddttttt", "ddrtttt", "dddtttt", "dddrttt", "ddddttt", "ddddrtt", "dddddtt", "dddddrt", "ddddddt", "ddddddr", "ddddddd"]);
    // Its first tab: in the first project connected, after the alias resolved.
    expect(launched).toEqual([["claude-tax", "alpha"]]);
    expect(result).toMatchObject({ openIn: "alpha", tabId: "tab-1" });
    expect(result.steps[6]?.detail).toBe("Opened in alpha");
    expect(result.aliasLine).toBe(`alias claude-tax='CLAUDE_CONFIG_DIR="${folder}" claude'`);
    expect(result.rcFile).toBe(rc);
    expect(await readFile(rc, "utf8")).toBe(`${result.aliasLine}\n`);
    expect(await readFile(join(folder, "CLAUDE.md"), "utf8")).toBe("# Agent\n\n## Role\nTBD\n");
    expect(await readlink(join(folder, "skills", "alpha"))).toBe("../../_shared/skills/alpha");
    expect(await readlink(join(folder, "skills", "beta"))).toBe("../../_shared/skills/beta");
    expect((await lstat(join(folder, "skills", "own-skill"))).isDirectory()).toBe(true);
    expect(await readdir(join(folder, "skills"))).not.toContain(".DS_Store");
    expect(await agentsList()).toEqual([TEMPLATE_FOLDER, "_shared", "claude-libra", "claude-tax"]);
    expect(records.profiles.get("claude-tax")?.value).toEqual({
      id: "claude-tax",
      provider: "claude",
      kind: "folder",
      configDir: "Agents/claude-tax",
      command: "claude-tax",
      role: "Files the taxes.",
      tags: ["tax"],
      hidden: false,
      modes: { normal: { enabled: true }, "full-autonomy": { enabled: true } },
    });
    expect(refreshes).toBe(1);
    expect(connected).toEqual([
      ["alpha", "claude-tax"],
      ["beta", "claude-tax"],
    ]);
  });

  it("skips the projects step with none to connect", async () => {
    const result = await creation().create(params(), () => undefined);
    expect(result.steps.find((s) => s.id === "projects")).toEqual({ id: "projects", state: "skip", detail: "No projects to connect" });
    expect(result.outcome).toBe("created");
    // With no project, the first tab opens in the Workspace.
    expect(launched).toEqual([["claude-tax", "__workspace__"]]);
    expect(result).toMatchObject({ openIn: "__workspace__", tabId: "tab-1" });
    expect(result.steps.find((s) => s.id === "open")?.detail).toBe("Opened in the Workspace");
  });

  it("never appends the alias line twice", async () => {
    const line = `alias claude-tax='${aliasCommand(join(workspace, "Agents", "claude-tax"))}'`;
    await writeFile(rc, `# mine\n${line}\n`);
    // A line zsh does not act on (a later `unalias`, say): the name is free, and the line is not added again.
    shellKnows = { "claude-tax": NONE };
    const result = await creation().create(params(), () => undefined);
    expect(result.steps.find((s) => s.id === "alias")?.detail).toBe(`Already in ${rc}`);
    expect(await readFile(rc, "utf8")).toBe(`# mine\n${line}\n`);
  });

  it("refuses a name that is taken before writing anything", async () => {
    shellKnows = { ls: { alias: null, resolves: true, description: "ls is /bin/ls" } };
    const before = await agentsList();
    for (const name of ["claude-libra", "ls", "Bad"]) {
      const result = await creation().create(params({ name }), () => undefined);
      expect(result.outcome, name).toBe("refused");
      expect(result.steps.every((s) => s.state === "todo")).toBe(true);
      expect(result.tabId).toBeNull();
    }
    expect(launched).toEqual([]);
    expect(await agentsList()).toEqual(before);
    expect(records.profiles.ids()).toEqual([]);
    await expect(readFile(rc, "utf8")).rejects.toThrow("ENOENT");
  });

  it("leaves nothing behind when the template is missing", async () => {
    await rm(join(workspace, "Agents", TEMPLATE_FOLDER), { recursive: true });
    const result = await creation().create(params(), () => undefined);
    expect(result.outcome).toBe("failed");
    expect(result.steps.map((s) => s.state)).toEqual(["fail", "todo", "todo", "todo", "todo", "todo", "todo"]);
    expect(result.steps[0]?.detail).toBe(`Agents/${TEMPLATE_FOLDER} is not there. Nothing of claude-tax was kept.`);
    expect(await agentsList()).toEqual(["_shared", "claude-libra"]);
  });

  it("removes the copied folder and agent.yaml when the agent cannot be put in place", async () => {
    const c = creation({
      // Something makes Agents/claude-tax while the Create runs: the folder step done, the profile written, the rename refused.
      refreshRoster: () => Promise.resolve(),
      profiles: {
        ...records.profiles,
        get: (id) => records.profiles.get(id),
        ids: () => records.profiles.ids(),
        onChange: (l) => records.profiles.onChange(l),
        update: (id, change) => records.profiles.update(id, change),
        create: async (value) => {
          await records.profiles.create(value);
          await mkdir(join(workspace, "Agents", "claude-tax"));
        },
      },
    });
    const result = await c.create(params(), () => undefined);
    expect(result.outcome).toBe("failed");
    expect(result.steps.map((s) => s.state)).toEqual(["done", "done", "fail", "todo", "todo", "todo", "todo"]);
    expect(result.steps[2]?.detail).toBe("Agents/claude-tax appeared meanwhile. Nothing of claude-tax was kept.");
    expect(await agentsList()).toEqual([TEMPLATE_FOLDER, "_shared", "claude-libra", "claude-tax"]);
    expect(await readdir(join(workspace, "Agents", "claude-tax"))).toEqual([]);
    await expect(lstat(join(workspace, "Agents", stagingName("claude-tax")))).rejects.toThrow("ENOENT");
    await expect(lstat(join(dataDir, "agents", "claude-tax"))).rejects.toThrow("ENOENT");
    await expect(readFile(rc, "utf8")).rejects.toThrow("ENOENT");
  });

  it("keeps the agent when a project cannot be connected, and goes on to the alias", async () => {
    const c = creation({ connect: (project) => (project === "beta" ? Promise.reject(new Error("not-found")) : Promise.resolve("connected")) });
    const result = await c.create(params({ projects: ["alpha", "beta"] }), () => undefined);
    expect(result.outcome).toBe("incomplete");
    expect(result.steps.find((s) => s.id === "projects")).toEqual({ id: "projects", state: "fail", detail: "Not connected: beta (not-found)" });
    expect(result.steps.find((s) => s.id === "verify")?.state).toBe("done");
    expect(await agentsList()).toContain("claude-tax");
    // The tab opens in the first project that was connected.
    expect(launched).toEqual([["claude-tax", "alpha"]]);
  });

  it("opens the tab in the Workspace when no project was connected", async () => {
    const c = creation({ connect: () => Promise.reject(new Error("not-found")) });
    const result = await c.create(params({ projects: ["alpha"] }), () => undefined);
    expect(result).toMatchObject({ outcome: "incomplete", openIn: "__workspace__", tabId: "tab-1" });
  });

  it("marks the open step when Pomade does not open the tab, and keeps the agent", async () => {
    const c = creation({ launch: () => Promise.reject(new Error("not-found: no agent claude-tax")) });
    const result = await c.create(params(), () => undefined);
    expect(result.outcome).toBe("incomplete");
    expect(result.steps.find((s) => s.id === "open")).toEqual({ id: "open", state: "fail", detail: "The tab did not open: not-found: no agent claude-tax" });
    expect(result.tabId).toBeNull();
    expect(await agentsList()).toContain("claude-tax");
  });

  it("marks the check when the alias does not resolve, keeps everything, and a later check passes once it does", async () => {
    shellKnows = { "claude-tax": NONE };
    const c = creation();
    const result = await c.create(params(), () => undefined);
    expect(result.outcome).toBe("incomplete");
    expect(result.steps.map((s) => s.state)).toEqual(["done", "done", "done", "skip", "done", "fail", "todo"]);
    expect(result.steps[5]?.detail).toBe("claude-tax does not resolve in a fresh zsh");
    // No tab: it would run a command zsh does not know.
    expect(launched).toEqual([]);
    expect(result).toMatchObject({ openIn: "__workspace__", tabId: null });
    expect(await readFile(rc, "utf8")).toBe(`${result.aliasLine}\n`);
    expect(await agentsList()).toContain("claude-tax");
    const folder = join(workspace, "Agents", "claude-tax");

    shellKnows = { "claude-tax": { alias: "something else", resolves: true, description: "claude-tax is an alias for something else" } };
    expect(await c.checkAlias("claude-tax", folder)).toEqual({ ok: false, aliasLine: result.aliasLine, rcFile: rc, detail: "claude-tax resolves to something else: claude-tax is an alias for something else" });
    delete shellKnows["claude-tax"];
    expect(await c.checkAlias("claude-tax", folder)).toEqual({ ok: true, aliasLine: result.aliasLine, rcFile: rc, detail: null });
  });

  it("marks the alias step when the rc file cannot be written, and still checks", async () => {
    const c = creation({ rcFile: join(dir, "no-such-folder", ".zshrc") });
    const result = await c.create(params(), () => undefined);
    expect(result.steps.find((s) => s.id === "alias")?.state).toBe("fail");
    expect(result.steps.find((s) => s.id === "alias")?.detail).toBe(`Could not write ${join(dir, "no-such-folder", ".zshrc")} (ENOENT)`);
    expect(result.steps.find((s) => s.id === "verify")?.state).toBe("fail");
    expect(result.outcome).toBe("incomplete");
  });

  describe("a clone", () => {
    /** `claude-libra` as a well-used agent: its identity and config, and everything a clone leaves behind. */
    const seedSource = async (): Promise<string> => {
      const source = join(workspace, "Agents", "claude-libra");
      await writeFile(join(source, "CLAUDE.md"), "# claude-libra\n\nThe librarian.\n");
      await writeFile(join(source, "settings.json"), '{ "model": "opus" }\n');
      await mkdir(join(source, "skills", "own-skill"), { recursive: true });
      await writeFile(join(source, "skills", "own-skill", "SKILL.md"), "own\n");
      await symlink("../../_shared/skills/alpha", join(source, "skills", "alpha"));
      await symlink("/opt/skills/abs", join(source, "skills", "abs"));
      await symlink("../extra/inner", join(source, "skills", "inner"));
      await symlink("../_shared/plugins", join(source, "plugins"));
      for (const folder of ["projects/-ws/memory", "todos", "shell-snapshots", "statsig", "ide", "cache", "session-env", "file-history"]) await mkdir(join(source, folder), { recursive: true });
      await writeFile(join(source, "projects", "-ws", "s1.jsonl"), "{}\n");
      await writeFile(join(source, "projects", "-ws", "memory", "MEMORY.md"), "memory\n");
      for (const file of [".claude.json", ".credentials.json", "history.jsonl", "CLAUDE.md.bak"]) await writeFile(join(source, file), "x\n");
      rosterAgents["claude-libra"] = {
        folder: source,
        profile: {
          id: "claude-libra",
          provider: "claude",
          kind: "folder",
          configDir: "Agents/claude-libra",
          command: "claude-libra",
          role: "The librarian.",
          tags: ["vault"],
          hidden: false,
          modes: { normal: { enabled: true } },
        },
      };
      return source;
    };

    it("copies only CLAUDE.md, settings.json, the skill links and the plugins link of a source full of other things", async () => {
      const source = await seedSource();
      const target = join(dir, "staging");
      const final = join(workspace, "Agents", "claude-tax");
      await mkdir(target);
      expect(await copyCloned(source, target, final)).toEqual(["CLAUDE.md", "settings.json", "skills/abs", "skills/alpha", "skills/inner", "plugins"]);
      expect((await readdir(target)).sort()).toEqual(["CLAUDE.md", "plugins", "settings.json", "skills"]);
      expect((await readdir(join(target, "skills"))).sort()).toEqual(["abs", "alpha", "inner"]);
      expect(await readFile(join(target, "settings.json"), "utf8")).toBe('{ "model": "opus" }\n');
      expect(await readlink(join(target, "skills", "alpha"))).toBe("../../_shared/skills/alpha");
      expect(await readlink(join(target, "skills", "abs"))).toBe("/opt/skills/abs");
      // A link into the source's own folder still reaches it from the clone.
      expect(await readlink(join(target, "skills", "inner"))).toBe("../../claude-libra/extra/inner");
      expect(await readlink(join(target, "plugins"))).toBe("../_shared/plugins");
    });

    it("leaves a plugins folder and a missing settings.json behind", async () => {
      const source = join(workspace, "Agents", "claude-libra");
      await writeFile(join(source, "CLAUDE.md"), "# x\n");
      await mkdir(join(source, "plugins", "cache"), { recursive: true });
      const target = join(dir, "staging");
      await mkdir(target);
      expect(await copyCloned(source, target, join(workspace, "Agents", "claude-tax"))).toEqual(["CLAUDE.md"]);
      expect(await readdir(target)).toEqual(["CLAUDE.md"]);
    });

    it("makes the agent from its source: the allowed entries, the missing shared links, the source's modes, the role and tags given", async () => {
      await seedSource();
      const result = await creation().create(params({ clone: "claude-libra", tags: ["tax", "vault"] }), () => undefined);
      expect(result.outcome).toBe("created");
      expect(result.steps[0]?.detail).toBe("Copied CLAUDE.md, settings.json, skills/abs, skills/alpha, skills/inner, plugins from claude-libra");
      expect(result.steps[1]?.detail).toBe("Linked beta");
      const folder = join(workspace, "Agents", "claude-tax");
      expect((await readdir(folder)).sort()).toEqual(["CLAUDE.md", "plugins", "settings.json", "skills"]);
      expect((await readdir(join(folder, "skills"))).sort()).toEqual(["abs", "alpha", "beta", "inner"]);
      expect(await readFile(join(folder, "CLAUDE.md"), "utf8")).toBe("# claude-libra\n\nThe librarian.\n");
      expect(records.profiles.get("claude-tax")?.value).toMatchObject({ id: "claude-tax", configDir: "Agents/claude-tax", command: "claude-tax", role: "Files the taxes.", tags: ["tax", "vault"], modes: { normal: { enabled: true } } });
      expect(launched).toEqual([["claude-tax", "__workspace__"]]);
      expect(logs.at(-1)).toContain("as a clone of claude-libra");
    });

    it("of an agent that is not a folder agent, or whose folder is gone, writes nothing", async () => {
      await seedSource();
      rosterAgents["claude-libra"] = { ...rosterAgents["claude-libra"]!, orphan: true };
      for (const [clone, detail] of [
        ["claude", "claude is not in the roster"],
        ["claude-libra", "claude-libra’s config folder is gone"],
      ] as const) {
        const result = await creation().create(params({ clone }), () => undefined);
        expect(result.outcome, clone).toBe("failed");
        expect(result.steps[0]?.detail, clone).toBe(`${detail}. Nothing of claude-tax was kept.`);
      }
      expect(await agentsList()).toEqual([TEMPLATE_FOLDER, "_shared", "claude-libra"]);
      expect(records.profiles.ids()).toEqual([]);
      expect(launched).toEqual([]);
    });
  });

  // Every name check starts a shell: under a loaded suite a few take seconds.
  it("holds the name while its Create runs", async () => {
    let release: (() => void) | null = null;
    const c = creation({ refreshRoster: () => new Promise<void>((resolve) => (release = resolve)) });
    const running = c.create(params(), () => undefined);
    await expect.poll(async () => (await c.checkName("claude-tax")).problem, { timeout: 12_000, interval: 25 }).toBe("folder");
    // The name is held from the start; the Create waits on the roster's refresh only once the agent is in place.
    await expect.poll(() => release !== null, { timeout: 12_000, interval: 25 }).toBe(true);
    await expect.poll(async () => (await c.checkName("claude-tax")).problem).toBe("folder");
    (release as (() => void) | null)?.();
    expect((await running).outcome).toBe("created");
    expect(logs.at(-1)).toContain("create: claude-tax created in");
  }, 20_000);
});
