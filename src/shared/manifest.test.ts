// The manifest is the single source of the app's id, version and API list; these checks keep the
// package and the code in step with it.

import { readFileSync } from "node:fs";

import { parseManifest } from "pomade-kit/protocol";
import { describe, expect, it } from "vitest";

import { skillProblems } from "../../scripts/build-folder.ts";
import { createApi } from "../backend/interfaces/api.ts";
import { API_METHODS } from "./api.ts";
import { LIVE_NOW_CHANGED_EVENT } from "./live-now.ts";
import { ROSTER_CHANGED_EVENT, ROSTER_CREATING_EVENT } from "./roster.ts";
import { RUN_FINISHED_EVENT, RUN_STARTED_EVENT } from "./runner-events.ts";
import { SESSION_CLOSED_EVENT, SESSION_STATUS_CHANGED_EVENT, SESSION_TURN_FINISHED_EVENT } from "./session-events.ts";
import { SKILLS_CHANGED_EVENT } from "./skills.ts";

const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const raw = read("../../public/manifest.json");

describe("manifest.json", () => {
  it("is a valid Host API manifest for a with-Pomade app with one panel icon", () => {
    const parsed = parseManifest(raw);
    if (!parsed.ok) throw new Error(parsed.errors.map((e) => e.message).join("; "));
    expect(parsed.manifest).toMatchObject({
      id: "pomade-agents",
      name: "Agents",
      hostApi: 0,
      strip: [{ id: "agents", title: "Agents", action: "panel", route: "" }],
      backend: { entry: "backend/main.mjs", mode: "with-pomade" },
    });
    expect(parsed.unsupportedKeys).toEqual([]);
    expect(parsed.manifest.outsideWorkspace).toEqual(["~/.claude/", "~/.codex/", "~/.zshrc"]);
    // The UI hears the backend's change notices through the app's own published events; other apps
    // hear the session events; the backend follows Pomade's projects and agent tabs, and Runner's
    // runs, for project attribution, live state and event B; Live now focuses agent tabs; the
    // Settings page picks folders; a new agent is connected to its projects, its Create's steps
    // tick on the page.
    expect(parsed.manifest.capabilities).toEqual(["project.read", "agentTabs.read", "agentTabs.write", "tabs.open", "files.read", "project.write"]);
    expect(parsed.manifest.events).toEqual({
      publish: ["sessions.changed", ROSTER_CHANGED_EVENT, LIVE_NOW_CHANGED_EVENT, SESSION_TURN_FINISHED_EVENT, SESSION_CLOSED_EVENT, SESSION_STATUS_CHANGED_EVENT, SKILLS_CHANGED_EVENT, ROSTER_CREATING_EVENT],
      subscribe: ["pomade-agents:sessions.changed", "pomade-agents:roster.changed", `pomade-agents:${LIVE_NOW_CHANGED_EVENT}`, "pomade.ready", "project.created", "project.renamed", "project.removed", "agentTab.changed", "agentTab.exited", RUN_STARTED_EVENT, RUN_FINISHED_EVENT, `pomade-agents:${SKILLS_CHANGED_EVENT}`, `pomade-agents:${ROSTER_CREATING_EVENT}`],
    });
  });

  it("carries the package's version", () => {
    expect((raw as { version: string }).version).toBe((read("../../package.json") as { version: string }).version);
  });

  it("declares exactly the API methods the backend serves", () => {
    const api = (raw as { api: string[] }).api;
    expect(api).toEqual([...API_METHODS]);
    const info = { version: "0", startedAt: "", workspace: null, workspaceReal: null, dataDir: null, stateDir: "/s" };
    const none = (): Promise<never> => Promise.reject(new Error("not called"));
    const sessions = {
      answer: () => ({ epoch: "e", revision: 0, full: true, sessions: [], removed: [], indexing: false, recordsOff: null }),
      changeStatus: none,
      rename: none,
      moveToProject: none,
      list: () => [],
      get: () => undefined,
    };
    const live = { entries: () => [] };
    const roster = { answer: () => ({ epoch: "e", revision: 0, agents: [], profilesOff: null }), list: () => [], agent: () => undefined, updateProfile: none, permissions: none, memory: none, modelConfig: none, setModel: none };
    const projects = { projects: none, visibleAgents: none };
    expect(Object.keys(createApi({ info, sessions, live, liveNow: { answer: () => ({ epoch: "l", revision: 0, rows: [] }) }, realPath: (p: string) => Promise.resolve(p), roster, projects, open: none, tabs: { ofTab: () => null }, skills: { read: none, setFolders: none, link: none, unlink: none } }))).toEqual(api);
  });

  it("declares the pomade-agents command, built from the command's entry", () => {
    const parsed = parseManifest(raw);
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.manifest.commands).toEqual([{ name: "pomade-agents", entry: "cli/pomade-agents.mjs", title: expect.any(String) as string }]);
    const config = readFileSync(new URL("../../vite.command.config.ts", import.meta.url), "utf8");
    expect(config).toContain('ssr: "src/command/main.ts"');
    expect(config).toContain('outDir: "dist/cli"');
    expect(config).toContain('entryFileNames: "pomade-agents.mjs"');
  });

  it("ships each skill it declares from public/, with a SKILL.md that names it and says when to use it", () => {
    const parsed = parseManifest(raw);
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.manifest.skills).toEqual([{ name: "pomade-agents-sessions", path: "skills/pomade-agents-sessions" }]);
    for (const skill of parsed.manifest.skills ?? []) {
      const text = readFileSync(new URL(`../../public/${skill.path}/SKILL.md`, import.meta.url), "utf8");
      expect(skillProblems(skill.name, text)).toEqual([]);
    }
  });
});

describe("a skill's SKILL.md", () => {
  it.each<[string, string, string]>([
    ["no frontmatter", "# Skill\n", "it has no frontmatter"],
    ["another name", "---\nname: other\ndescription: Use it.\n---\n", 'its name is "other", not its folder\'s "s"'],
    ["no description", "---\nname: s\n---\n", "it has no description"],
    ["a blank description", "---\nname: s\ndescription: \"  \"\n---\n", "it has no description"],
    ["a description past the limit", `---\nname: s\ndescription: ${"x".repeat(1025)}\n---\n`, "its description is longer than 1024 characters"],
  ])("is refused with %s", (_case, text, problem) => {
    expect(skillProblems("s", text)).toEqual([problem]);
  });

  it("is refused when its frontmatter is not YAML", () => {
    expect(skillProblems("s", "---\nname: [s\n---\n")[0]).toMatch(/^its frontmatter is invalid/);
  });
});
