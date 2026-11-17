import { appendFile, mkdir, mkdtemp, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionsChanged } from "../../shared/sessions.ts";
import { INDEX_FILE } from "./index-file.ts";
import { startSessionStore, type SessionStore } from "./session-store.ts";
import { fixture, fixtureLines } from "./test-helpers.ts";

const CODEX_ID = "019a7c3e-5b2d-7f10-8c4e-1d2f3a4b5c6d";
/** Within the ~2 s the ticket allows a change to reach the UI; the root-appearance tick is 2 s itself. */
const SOON = { timeout: 2000, interval: 25 };
const AFTER_TICK = { timeout: 4500, interval: 50 };

describe("the session store", () => {
  let dir: string;
  let home: string;
  let workspace: string;
  let stateDir: string;
  let store: SessionStore | null = null;
  const lines: string[] = [];

  const claudeFile = (): string => join(home, ".claude", "projects", "-work-alpha", "5b0e8f52.jsonl");
  const libraFile = (): string => join(workspace, "Agents", "claude-libra", "projects", "-work-alpha", "c41f7e2a.jsonl");
  const codexFile = (): string => join(home, ".codex", "sessions", "2026", "11", "12", `rollout-2026-11-12T10-00-00-${CODEX_ID}.jsonl`);

  async function put(path: string, content: Buffer | string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }

  async function start(): Promise<SessionStore> {
    store = await startSessionStore({ home, workspace, stateDir, log: (line) => lines.push(line) });
    return store;
  }

  const ids = (s: SessionStore): string[] => s.answer().summaries.map((x) => x.id).sort();

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), "pa-store-")));
    home = join(dir, "home");
    workspace = join(dir, "ws");
    stateDir = join(dir, "ud", "app-state", "pomade-agents");
    lines.length = 0;
    await put(claudeFile(), fixture("claude-session.jsonl"));
    await put(join(dirname(claudeFile()), "5b0e8f52", "subagents", "agent-1.jsonl"), fixture("claude-no-origin.jsonl"));
    await put(join(dirname(claudeFile()), "memory", "notes.jsonl"), "{}\n");
    await put(join(workspace, "Agents", "claude-libra", "CLAUDE.md"), "# claude-libra\n");
    await put(libraFile(), fixture("claude-after-clear.jsonl"));
    await put(join(workspace, "Agents", "Claude Agent Template", "CLAUDE.md"), "# template\n");
    await put(join(workspace, "Agents", "Claude Agent Template", "projects", "-x", "t.jsonl"), fixture("claude-no-origin.jsonl"));
    await put(codexFile(), fixture("codex-session.jsonl"));
    await put(join(dirname(codexFile()), "rollout-2026-11-14T09-00-00-019a7e00-aaaa-7bbb-8ccc-dddd00001111.jsonl"), fixture("codex-subagent.jsonl"));
  });

  afterEach(async () => {
    await store?.stop();
    store = null;
    await rm(dir, { recursive: true, force: true });
  });

  it("indexes every session of every store at start: built-in, folder agents and Codex, sub-agents left out", async () => {
    const s = await start();
    await s.indexed;
    const answer = s.answer();
    expect(answer).toMatchObject({ full: true, removed: [], indexing: false });
    expect(answer.summaries.map((x) => [x.agent, x.provider, x.id]).sort()).toEqual([
      ["claude", "claude-code", "5b0e8f52"],
      ["claude-libra", "claude-code", "c41f7e2a"],
      ["codex", "codex", CODEX_ID],
    ]);
    expect(answer.summaries.find((x) => x.agent === "codex")?.transcript).toBe(codexFile());
    expect(lines.some((l) => l.includes("3 sessions from 4 transcripts indexed"))).toBe(true);
  });

  it("updates a growing transcript within moments, notifies, and answers only the change", async () => {
    const s = await start();
    await s.indexed;
    const before = s.answer();
    const heard: SessionsChanged[] = [];
    s.onChange((c) => heard.push(c));

    await appendFile(
      claudeFile(),
      `${JSON.stringify({ type: "user", message: { role: "user", content: "And the tests" }, origin: { kind: "human" }, timestamp: "2026-11-10T10:00:00.000Z" })}\n`,
    );
    await vi.waitFor(() => expect(heard.at(-1)?.revision).toBeGreaterThan(before.revision), SOON);

    const delta = s.answer({ epoch: before.epoch, revision: before.revision });
    expect(delta.full).toBe(false);
    expect(delta.summaries.map((x) => [x.id, x.lastMessage?.text])).toEqual([["5b0e8f52", "And the tests"]]);
    expect(s.answer({ epoch: "another-run", revision: before.revision }).full).toBe(true);
  });

  it("takes a half-written line once its end arrives", async () => {
    const s = await start();
    await s.indexed;
    const record = JSON.stringify({ type: "user", message: { role: "user", content: "Split line" }, origin: { kind: "human" }, timestamp: "2026-11-10T10:00:00.000Z" });
    await appendFile(claudeFile(), record.slice(0, 20));
    await new Promise((resolve) => setTimeout(resolve, 300));
    const summary = (): string | undefined => s.answer().summaries.find((x) => x.id === "5b0e8f52")?.lastMessage?.text;
    expect(summary()).toBe("Now write it");
    await appendFile(claudeFile(), `${record.slice(20)}\n`);
    await vi.waitFor(() => expect(summary()).toBe("Split line"), SOON);
    expect(s.answer().summaries.find((x) => x.id === "5b0e8f52")?.malformedLines).toBe(0);
  });

  it("picks up a new session in a new project folder, and drops a deleted one", async () => {
    const s = await start();
    await s.indexed;
    const before = s.answer();
    const fresh = join(home, ".claude", "projects", "-work-beta", "0d6a3b9e.jsonl");
    await put(fresh, fixture("claude-skill-first.jsonl"));
    await vi.waitFor(() => expect(ids(s)).toContain("0d6a3b9e"), SOON);

    await unlink(claudeFile());
    await vi.waitFor(() => expect(ids(s)).not.toContain("5b0e8f52"), SOON);
    const delta = s.answer({ epoch: before.epoch, revision: before.revision });
    expect(delta.removed).toEqual([claudeFile()]);
    expect(delta.summaries.map((x) => x.id)).toEqual(["0d6a3b9e"]);
  });

  it("follows a store that appears after start, and a folder agent added to the roster", async () => {
    await rm(join(home, ".codex"), { recursive: true });
    const s = await start();
    await s.indexed;
    expect(ids(s)).not.toContain(CODEX_ID);

    await put(codexFile(), fixture("codex-session.jsonl"));
    await put(join(workspace, "Agents", "claude-pm", "CLAUDE.md"), "# claude-pm\n");
    await put(join(workspace, "Agents", "claude-pm", "projects", "-w", "0d6a3b9e.jsonl"), fixture("claude-skill-first.jsonl"));
    await vi.waitFor(() => expect(ids(s)).toEqual([CODEX_ID, "0d6a3b9e", "5b0e8f52", "c41f7e2a"]), AFTER_TICK);
    expect(s.answer().summaries.find((x) => x.id === "0d6a3b9e")?.agent).toBe("claude-pm");
  });

  it("drops the sessions of a store that went away", async () => {
    const s = await start();
    await s.indexed;
    await rm(join(workspace, "Agents", "claude-libra"), { recursive: true });
    await vi.waitFor(() => expect(ids(s)).toEqual([CODEX_ID, "5b0e8f52"]), AFTER_TICK);
  });

  it("starts warm from the parse index it saved, reading only what grew meanwhile", async () => {
    const cold = await start();
    await cold.indexed;
    const first = cold.answer().summaries;
    await cold.stop();
    expect(JSON.parse(await readFile(join(stateDir, INDEX_FILE), "utf8"))).toMatchObject({ parser: expect.any(Number) });

    // Grown while the backend was down: only the appended line is read.
    const extra = fixtureLines("claude-session.jsonl")[13] ?? "";
    await appendFile(claudeFile(), extra.replace("Now write it", "Written while away").replace("09:03:00", "11:00:00"));
    const warm = await start();
    await warm.indexed;
    const second = warm.answer().summaries;
    expect(second.find((x) => x.id === "5b0e8f52")?.lastMessage?.text).toBe("Written while away");
    expect(second.filter((x) => x.id !== "5b0e8f52")).toEqual(first.filter((x) => x.id !== "5b0e8f52"));
  });

  it("rebuilds from scratch over a corrupt index", async () => {
    await mkdir(stateDir, { recursive: true });
    await writeFile(join(stateDir, INDEX_FILE), "{ not json", "utf8");
    const s = await start();
    await s.indexed;
    expect(ids(s)).toHaveLength(3);
  });

  it("runs with no home and no workspace: nothing to index", async () => {
    store = await startSessionStore({ home: null, workspace: null, stateDir, log: () => undefined });
    await store.indexed;
    expect(store.answer()).toMatchObject({ summaries: [], indexing: false });
  });
});
