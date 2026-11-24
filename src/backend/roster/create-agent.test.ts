// The Create from the template in a throwaway workspace, with a scripted zsh: the name check's
// order, the steps as they tick, the agent appearing whole, a failure in its first three steps
// leaving nothing behind, and a failed connection or alias keeping the agent.

import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CreateAgentParams, CreateStep } from "../../shared/roster.ts";
import { openRecordStore, type RecordStore } from "../records/record-store.ts";
import { createAgentCreation, stagingName, stepBoard, TEMPLATE_FOLDER, type CreationOptions } from "./create-agent.ts";
import { aliasCommand, type ZshAnswer } from "./shell.ts";

const NONE: ZshAnswer = { alias: null, resolves: false, description: "" };

describe("the step board", () => {
  it("starts with every step to do and hands out a fresh copy on each change", () => {
    const seen: CreateStep[][] = [];
    const board = stepBoard((steps) => seen.push(steps));
    expect(board.steps().map((s) => s.state)).toEqual(["todo", "todo", "todo", "todo", "todo", "todo"]);
    board.start("folder");
    board.end("folder", "done", "copied");
    board.end("projects", "skip", "none");
    expect(seen.map((steps) => steps.map((s) => s.state).join(" "))).toEqual(["run todo todo todo todo todo", "done todo todo todo todo todo", "done todo todo skip todo todo"]);
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
      await writeFile(join(dataDir, "agents", "claude-gone", "agent.yaml"), "id: claude-gone\nprovider: claude\nkind: folder\nconfigDir: Agents/elsewhere\ncommand: claude-gone\n");
      await expect.poll(() => records.profiles.get("claude-gone") !== undefined).toBe(true);
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
    ]);
    expect(result.steps[1]?.detail).toBe("Linked beta");
    expect(seen).toEqual(["rttttt", "dttttt", "drtttt", "ddtttt", "ddrttt", "dddttt", "dddrtt", "ddddtt", "ddddrt", "dddddt", "dddddr", "dddddd"]);
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
    }
    expect(await agentsList()).toEqual(before);
    expect(records.profiles.ids()).toEqual([]);
    await expect(readFile(rc, "utf8")).rejects.toThrow("ENOENT");
  });

  it("leaves nothing behind when the template is missing", async () => {
    await rm(join(workspace, "Agents", TEMPLATE_FOLDER), { recursive: true });
    const result = await creation().create(params(), () => undefined);
    expect(result.outcome).toBe("failed");
    expect(result.steps.map((s) => s.state)).toEqual(["fail", "todo", "todo", "todo", "todo", "todo"]);
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
    expect(result.steps.map((s) => s.state)).toEqual(["done", "done", "fail", "todo", "todo", "todo"]);
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
  });

  it("marks the check when the alias does not resolve, keeps everything, and a later check passes once it does", async () => {
    shellKnows = { "claude-tax": NONE };
    const c = creation();
    const result = await c.create(params(), () => undefined);
    expect(result.outcome).toBe("incomplete");
    expect(result.steps.map((s) => s.state)).toEqual(["done", "done", "done", "skip", "done", "fail"]);
    expect(result.steps[5]?.detail).toBe("claude-tax does not resolve in a fresh zsh");
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

  it("holds the name while its Create runs", async () => {
    let release: () => void = () => undefined;
    const c = creation({ refreshRoster: () => new Promise<void>((resolve) => (release = resolve)) });
    const running = c.create(params(), () => undefined);
    await expect.poll(async () => (await c.checkName("claude-tax")).problem).toBe("folder");
    release();
    expect((await running).outcome).toBe("created");
    expect(logs.at(-1)).toContain("create: claude-tax created in");
  });
});
