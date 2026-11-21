import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { builtinProfile, folderProfile, readPomadeOverrides, roleLine } from "./first-sight.ts";
import { modelDefaults, tomlTopLevelStrings } from "./provider-config.ts";

describe("the role line", () => {
  it("is the first sentence of the first paragraph under ## Role, on one line", () => {
    expect(roleLine("# claude-libra\n\n## Role\n\nA meticulous librarian for the `Knowledge/` vault — its steward. It keeps notes.\n\n## Tone\nCalm.")).toBe(
      "A meticulous librarian for the `Knowledge/` vault — its steward.",
    );
    expect(roleLine("## Role\nA personal assistant (e.g., reminders)\nand bills! More.")).toBe("A personal assistant (e.g., reminders) and bills!");
    expect(roleLine("## role\n\nNo full stop")).toBe("No full stop");
  });

  it("is absent without a Role section or with an empty one", () => {
    expect(roleLine("# Agent\n\nSomething.")).toBeUndefined();
    expect(roleLine("## Role\n\n## Tone\nCalm.")).toBeUndefined();
    expect(roleLine("## Roles and more\nNot it.")).toBeUndefined();
  });
});

describe("first-sight profiles", () => {
  let dir: string;
  const lines: string[] = [];
  const log = (line: string): number => lines.push(line);

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), "pa-first-")));
    lines.length = 0;
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("take Pomade's command overrides and hidden agents, leaving malformed parts out", async () => {
    expect(await readPomadeOverrides(dir, log)).toEqual({ commands: {}, hidden: [] });
    await mkdir(join(dir, ".pomade"));
    await writeFile(join(dir, ".pomade", "agents.json"), JSON.stringify({ commands: { claude: " claude --x ", codex: "a\nb", libra: 3 }, hidden: ["codex", 4] }));
    const overrides = await readPomadeOverrides(dir, log);
    expect(overrides).toEqual({ commands: { claude: "claude --x" }, hidden: ["codex"] });
    expect(builtinProfile("claude", overrides)).toEqual({
      id: "claude",
      provider: "claude",
      kind: "builtin",
      configDir: "~/.claude",
      command: "claude --x",
      tags: [],
      hidden: false,
      modes: { normal: { enabled: true }, "full-autonomy": { enabled: true } },
    });
    expect(builtinProfile("codex", overrides)).toMatchObject({ provider: "codex", configDir: "~/.codex", command: "codex", hidden: true });
    await writeFile(join(dir, ".pomade", "agents.json"), "{");
    expect(await readPomadeOverrides(dir, log)).toEqual({ commands: {}, hidden: [] });
    expect(lines.join("\n")).toContain("agents.json cannot be read");
  });

  it("give a folder agent its folder, its alias and its role line", async () => {
    await mkdir(join(dir, "Agents", "claude-libra"), { recursive: true });
    await writeFile(join(dir, "Agents", "claude-libra", "CLAUDE.md"), "# claude-libra\n\n## Role\n\nA librarian. Calm.\n");
    expect(await folderProfile(dir, "claude-libra", { commands: {}, hidden: [] })).toEqual({
      id: "claude-libra",
      provider: "claude",
      kind: "folder",
      configDir: "Agents/claude-libra",
      command: "claude-libra",
      role: "A librarian.",
      tags: [],
      hidden: false,
      modes: { normal: { enabled: true }, "full-autonomy": { enabled: true } },
    });
    expect(await folderProfile(dir, "gone", { commands: { gone: "g" }, hidden: ["gone"] })).not.toHaveProperty("role");
  });

  it("read the default model and effort from the provider's own config", async () => {
    await writeFile(join(dir, "settings.json"), JSON.stringify({ model: "opus", effortLevel: "high", permissions: {} }));
    await writeFile(join(dir, "config.toml"), 'model = "gpt-5.2-codex" # mine\nmodel_reasoning_effort = \'medium\'\n[profiles.x]\nmodel = "other"\n');
    expect(await modelDefaults("claude", dir)).toEqual({ model: "opus", effort: "high" });
    expect(await modelDefaults("codex", dir)).toEqual({ model: "gpt-5.2-codex", effort: "medium" });
    expect(await modelDefaults("claude", join(dir, "missing"))).toEqual({ model: null, effort: null });
    expect(await modelDefaults("codex", null)).toEqual({ model: null, effort: null });
    await writeFile(join(dir, "settings.json"), "{ not json");
    expect(await modelDefaults("claude", dir)).toEqual({ model: null, effort: null });
    expect(tomlTopLevelStrings('a = "x \\" y"\nb = 3\n')).toEqual({ a: 'x " y' });
  });
});
