import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { codexMcp, readMemory, readPermissions } from "./agent-files.ts";

describe("agent files", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pa-agent-files-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const write = async (path: string, text: string): Promise<void> => {
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, text);
  };

  describe("permissions of a Claude Code agent", () => {
    it("reads permissions and enabled plugins from settings.json and MCP servers from the config folder's .claude.json", async () => {
      await write(
        join(dir, "settings.json"),
        JSON.stringify({ permissions: { defaultMode: "acceptEdits", allow: ["Read(a)", "", 3], ask: ["Bash(git push:*)"], deny: ["Bash(rm:*)"] }, enabledPlugins: { "b@m": true, "a@m": true, "c@m": false } }),
      );
      await write(join(dir, ".claude.json"), JSON.stringify({ mcpServers: { zed: { type: "http", url: "u" }, abc: { command: "npx" }, bare: {} }, projects: {} }));
      expect(await readPermissions({ provider: "claude", configDir: dir, builtin: false, home: null })).toEqual({
        provider: "claude",
        file: join(dir, "settings.json"),
        exists: true,
        problem: null,
        defaultMode: "acceptEdits",
        sandbox: null,
        allow: ["Read(a)"],
        ask: ["Bash(git push:*)"],
        deny: ["Bash(rm:*)"],
        mcp: [
          { name: "abc", type: "stdio" },
          { name: "bare", type: null },
          { name: "zed", type: "http" },
        ],
        plugins: ["a@m", "b@m"],
      });
    });

    it("finds a built-in's .claude.json in the home folder, beside its config folder", async () => {
      const config = join(dir, ".claude");
      await write(join(config, "settings.json"), "{}");
      await write(join(dir, ".claude.json"), JSON.stringify({ mcpServers: { chrome: { type: "stdio" } } }));
      expect((await readPermissions({ provider: "claude", configDir: config, builtin: true, home: dir })).mcp).toEqual([{ name: "chrome", type: "stdio" }]);
      expect((await readPermissions({ provider: "claude", configDir: config, builtin: true, home: null })).mcp).toEqual([]);
    });

    it("says an absent file is absent and an unreadable one is why", async () => {
      expect(await readPermissions({ provider: "claude", configDir: dir, builtin: false, home: null })).toMatchObject({ exists: false, problem: null, allow: [], mcp: [] });
      await write(join(dir, "settings.json"), "{ not json");
      expect(await readPermissions({ provider: "claude", configDir: dir, builtin: false, home: null })).toMatchObject({ exists: true, problem: expect.stringContaining("JSON") as string, allow: [] });
      await write(join(dir, "settings.json"), "[]");
      expect(await readPermissions({ provider: "claude", configDir: dir, builtin: false, home: null })).toMatchObject({ exists: true, problem: "it is not a JSON object" });
    });
  });

  describe("permissions of a Codex agent", () => {
    it("reads the approval policy, the sandbox and the MCP servers from config.toml", async () => {
      await write(join(dir, "config.toml"), 'model = "gpt-5"\napproval_policy = "on-request"\nsandbox_mode = "workspace-write"\n\n[mcp_servers.docs]\nurl = "https://x"\n\n[mcp_servers.docs.env]\nK = "v"\n\n[mcp_servers."local one"]\ncommand = "npx"\n');
      expect(await readPermissions({ provider: "codex", configDir: dir, builtin: true, home: dir })).toMatchObject({
        provider: "codex",
        file: join(dir, "config.toml"),
        exists: true,
        defaultMode: "on-request",
        sandbox: "workspace-write",
        allow: [],
        mcp: [
          { name: "docs", type: "http" },
          { name: "local one", type: "stdio" },
        ],
      });
    });

    it("lists no server for a file with none", () => {
      expect(codexMcp('model = "x"\n[profiles.a]\nmodel = "y"\n')).toEqual([]);
    });
  });

  describe("memory", () => {
    it("lists the Markdown files of each project folder that has some, MEMORY.md first", async () => {
      await write(join(dir, "projects", "-w-b", "memory", "z.md"), "z");
      await write(join(dir, "projects", "-w-b", "memory", "MEMORY.md"), "m");
      await write(join(dir, "projects", "-w-b", "memory", "a.md"), "a");
      await write(join(dir, "projects", "-w-b", "memory", "notes.txt"), "n");
      await write(join(dir, "projects", "-w-a", "memory", "MEMORY.md"), "m");
      await mkdir(join(dir, "projects", "-w-empty", "memory"), { recursive: true });
      await write(join(dir, "projects", "-w-nomemory", "session.jsonl"), "{}");
      await symlink(join(dir, "projects", "-w-a", "memory", "MEMORY.md"), join(dir, "projects", "-w-b", "memory", "linked.md"));
      const memory = await readMemory("claude", dir);
      expect(memory.folders.map((f) => [f.folder, f.files.map((x) => x.name)])).toEqual([
        ["-w-a", ["MEMORY.md"]],
        ["-w-b", ["MEMORY.md", "a.md", "linked.md", "z.md"]],
      ]);
      expect(memory.folders[0]?.files[0]?.path).toBe(join(dir, "projects", "-w-a", "memory", "MEMORY.md"));
    });

    it("has none without a projects folder, and none for Codex", async () => {
      expect(await readMemory("claude", dir)).toEqual({ folders: [] });
      await write(join(dir, "projects", "-w-a", "memory", "MEMORY.md"), "m");
      expect(await readMemory("codex", dir)).toEqual({ folders: [] });
    });
  });
});
