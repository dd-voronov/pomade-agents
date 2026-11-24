import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { builtinRoots, folderAgentRoots, isSkippedAgentFolder, listSessionFiles, mayHoldSessions, sessionFileAt, storeAgent, type StoreRoot } from "./roots.ts";

const CLAUDE: StoreRoot = { path: "/h/.claude/projects", provider: "claude-code", configDir: "/h/.claude", folderAgent: "claude" };
const CODEX: StoreRoot = { path: "/h/.codex/sessions", provider: "codex", configDir: "/h/.codex", folderAgent: "codex" };
const UUID = "019a7c3e-5b2d-7f10-8c4e-1d2f3a4b5c6d";

describe("sessionFileAt", () => {
  it("takes a Claude store's .jsonl files one folder deep, named by their id", () => {
    expect(sessionFileAt(CLAUDE, "/h/.claude/projects/-w-alpha/abc.jsonl")).toEqual({ root: CLAUDE, path: "/h/.claude/projects/-w-alpha/abc.jsonl", fileId: "abc" });
  });

  it("skips memory, per-session folders, sub-agent transcripts and other files", () => {
    for (const path of [
      "/h/.claude/projects/abc.jsonl",
      "/h/.claude/projects/-w-alpha/memory/notes.jsonl",
      "/h/.claude/projects/-w-alpha/abc/subagents/agent-1.jsonl",
      "/h/.claude/projects/-w-alpha/abc.json",
      "/h/.claude/projects/-w-alpha/abc.jsonl.tmp",
      "/h/.claude/other/-w-alpha/abc.jsonl",
    ]) {
      expect(sessionFileAt(CLAUDE, path)).toBeNull();
    }
  });

  it("takes Codex rollouts anywhere in the date tree, by the uuid that ends their name", () => {
    expect(sessionFileAt(CODEX, `/h/.codex/sessions/2026/11/17/rollout-2026-11-17T10-00-00-${UUID}.jsonl`)?.fileId).toBe(UUID);
    expect(sessionFileAt(CODEX, `/h/.codex/sessions/2026/11/17/other-${UUID}.jsonl`)).toBeNull();
    expect(sessionFileAt(CODEX, "/h/.codex/sessions/2026/11/17/rollout-2026-11-17.jsonl")).toBeNull();
  });

  it("knows the folders that can hold sessions", () => {
    expect(mayHoldSessions(CLAUDE, CLAUDE.path)).toBe(true);
    expect(mayHoldSessions(CLAUDE, "/h/.claude/projects/-w-alpha")).toBe(true);
    expect(mayHoldSessions(CLAUDE, "/h/.claude/projects/-w-alpha/abc")).toBe(false);
    expect(mayHoldSessions(CODEX, "/h/.codex/sessions/2026/11")).toBe(true);
    expect(mayHoldSessions(CODEX, "/h/.codex")).toBe(false);
  });
});

describe("storeAgent", () => {
  it("is the folder's own agent while no profile names the folder", () => {
    expect(storeAgent([], "claude-writer-v2")).toBe("claude-writer-v2");
  });

  it("is the agent whose profile names the folder: a re-linked agent keeps its id", () => {
    expect(storeAgent(["claude-writer"], "claude-writer-v2")).toBe("claude-writer");
  });

  it("is the folder's own agent when its profile is among those naming the folder, else the first", () => {
    expect(storeAgent(["claude-a", "claude-writer-v2"], "claude-writer-v2")).toBe("claude-writer-v2");
    expect(storeAgent(["claude-a", "claude-b"], "claude-writer-v2")).toBe("claude-a");
    expect(storeAgent(["claude"], "claude")).toBe("claude");
  });
});

describe("store roots on disk", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pa-roots-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("puts the built-in stores under the home folder", () => {
    expect(builtinRoots("/h")).toEqual([CLAUDE, CODEX]);
  });

  it("finds a store per folder agent: a folder with a CLAUDE.md, not _shared, no template", async () => {
    for (const name of ["claude-libra", "claude-pm", "_shared", "Claude Agent Template", "Agent X (template folder)", "no-marker"]) {
      await mkdir(join(dir, "Agents", name), { recursive: true });
      if (name !== "no-marker") await writeFile(join(dir, "Agents", name, "CLAUDE.md"), "# agent\n");
    }
    await writeFile(join(dir, "Agents", "new-agent.sh"), "#!/bin/sh\n");
    expect(await folderAgentRoots(dir)).toEqual([
      { path: join(dir, "Agents", "claude-libra", "projects"), provider: "claude-code", configDir: join(dir, "Agents", "claude-libra"), folderAgent: "claude-libra" },
      { path: join(dir, "Agents", "claude-pm", "projects"), provider: "claude-code", configDir: join(dir, "Agents", "claude-pm"), folderAgent: "claude-pm" },
    ]);
    expect(await folderAgentRoots(join(dir, "nowhere"))).toEqual([]);
    expect(isSkippedAgentFolder("my-TEMPLATE")).toBe(true);
  });

  it("lists a store's session files and nothing else", async () => {
    const root: StoreRoot = { path: join(dir, "projects"), provider: "claude-code", configDir: dir, folderAgent: "claude" };
    const project = join(root.path, "-w-alpha");
    await mkdir(join(project, "s1", "subagents"), { recursive: true });
    await mkdir(join(project, "memory"), { recursive: true });
    await mkdir(join(project, "folder.jsonl"), { recursive: true });
    await writeFile(join(project, "s1.jsonl"), "{}\n");
    await writeFile(join(project, "s1", "subagents", "a.jsonl"), "{}\n");
    await writeFile(join(project, "memory", "m.jsonl"), "{}\n");
    await writeFile(join(root.path, "stray.jsonl"), "{}\n");
    expect((await listSessionFiles(root)).map((f) => f.fileId)).toEqual(["s1"]);
    expect(await listSessionFiles({ ...root, path: join(dir, "missing") })).toEqual([]);
  });
});
