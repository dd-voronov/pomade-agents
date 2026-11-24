import { describe, expect, it } from "vitest";

import { CREATE_STEP_IDS, type AgentProfile, type CreateAgentResult, type CreateStep, type RosterEntry } from "../../../shared/roster.ts";
import {
  aliasChecked,
  aliasFailed,
  answeredName,
  clonePrefill,
  cloneable,
  createWill,
  nameMessage,
  pageTitle,
  phaseOf,
  settledPhase,
  stepLabel,
  takePrefill,
  typedName,
  withOpen,
  type Part,
} from "./new-agent-model.ts";

const text = (parts: readonly Part[]): string => parts.map((p) => (typeof p === "string" ? p : `\`${p.code}\``)).join("");

describe("the name as it is typed", () => {
  it("is decided at once by its own rules, else checked", () => {
    expect(typedName("")).toEqual({ status: "empty" });
    expect(typedName("-tax")).toEqual({ status: "bad", name: "-tax", verdict: { name: "-tax", problem: "leading-dash", detail: null } });
    expect(typedName("claude-tax")).toEqual({ status: "checking", name: "claude-tax" });
  });

  it("takes the backend's verdict only for the name still being checked", () => {
    const checking = typedName("claude-tax");
    expect(answeredName(checking, { name: "claude-tax", problem: null, detail: null })).toEqual({ status: "ok", name: "claude-tax" });
    const ls = { name: "ls", problem: "shell" as const, detail: "ls is /bin/ls" };
    expect(answeredName(typedName("ls"), ls)).toEqual({ status: "bad", name: "ls", verdict: ls });
    // A slow answer about an earlier name changes nothing.
    expect(answeredName(checking, { name: "claude-ta", problem: "shell", detail: "x" })).toBe(checking);
    expect(answeredName(typedName("Bad"), { name: "Bad", problem: null, detail: null })).toEqual(typedName("Bad"));
  });

  it("says why, in the order the checks run", () => {
    const say = (name: string, problem: Parameters<typeof answeredName>[1]["problem"], detail: string | null = null): string =>
      text(nameMessage(answeredName(typedName(name), { name, problem, detail }), false).parts);
    expect(text(nameMessage(typedName(""), false).parts)).toBe("Lowercase letters, digits and “-”, starting with a letter or digit. It is the folder, the alias and the name in the “+” menu.");
    expect(nameMessage(typedName(""), true)).toEqual({ tone: "error", parts: ["Name it. Lowercase letters, digits and “-”, starting with a letter or digit."] });
    expect(text(nameMessage(typedName("-x"), false).parts)).toBe("Start with a letter or digit: a leading “-” breaks the alias.");
    expect(text(nameMessage(typedName("Tax"), false).parts)).toBe("Only lowercase letters, digits and “-”.");
    expect(text(nameMessage(typedName("a".repeat(65)), false).parts)).toBe("At most 64 characters.");
    expect(text(nameMessage(typedName("new"), false).parts)).toBe("`new` is the New agent page’s own address.");
    expect(text(nameMessage(typedName("my-template"), false).parts)).toBe("A name with “template” in it is skipped by the agent scan.");
    expect(say("claude-pm", "folder")).toBe("`Agents/claude-pm` already exists.");
    expect(say("codex", "agent")).toBe("The roster already has an agent `codex`.");
    expect(say("ls", "shell", "ls is /bin/ls")).toBe("`ls` already runs something in zsh: ls is /bin/ls.");
    expect(say("x", "shell-error", "zsh did not answer in 15 s")).toBe("zsh could not be asked (zsh did not answer in 15 s). Try again.");
    expect(nameMessage(typedName("claude-tax"), false)).toEqual({ tone: "hint", parts: ["Checking the folder and zsh…"] });
    expect(say("claude-tax", null)).toBe("Free: folder `Agents/claude-tax`, alias `claude-tax`.");
    expect(nameMessage(typedName("ls"), true).tone).toBe("hint");
    expect(nameMessage(typedName("-x"), false).tone).toBe("error");
  });
});

describe("Create will", () => {
  it("lists the steps for the current name and projects", () => {
    expect(createWill("claude-tax", ["Alpha", "Beta"]).map((item) => text(item.parts))).toEqual([
      "Copy `Agents/Claude Agent Template` to `Agents/claude-tax/`",
      "Link every missing shared skill from `Agents/_shared/skills`",
      "Write `Apps/pomade-agents/agents/claude-tax/agent.yaml`",
      "Connect to Alpha, Beta",
      "Append `alias claude-tax=…` to `~/.zshrc` and check it resolves",
      "Open a `claude-tax` tab in Alpha",
    ]);
  });

  it("copies from the clone source, and opens the tab in the Workspace with no project", () => {
    const items = createWill("claude-tax", [], { kind: "clone", source: "claude-libra" }).map((item) => text(item.parts));
    expect(items[0]).toBe("Copy from `claude-libra`: `CLAUDE.md`, `settings.json`, its skill links, the `plugins` link");
    expect(items[5]).toBe("Open a `claude-tax` tab in the Workspace");
    expect(text(createWill("", [], { kind: "clone", source: null })[0]?.parts ?? [])).toBe("Copy the picked agent’s `CLAUDE.md`, `settings.json`, skill links and `plugins` link");
  });

  it("names a placeholder before the name is typed, and says when no project is chosen", () => {
    const items = createWill("", []);
    expect(text(items[0]?.parts ?? [])).toBe("Copy `Agents/Claude Agent Template` to `Agents/<name>/`");
    expect(items[3]).toEqual({ parts: ["Connect to no project (the Workspace offers every agent)"], faint: true });
  });
});

describe("the steps", () => {
  const steps = (states: string): CreateStep[] => CREATE_STEP_IDS.map((id, i) => ({ id, state: ({ t: "todo", r: "run", d: "done", s: "skip", f: "fail" } as const)[states[i] as "t"], detail: null }));

  it("are labelled for the agent and its projects", () => {
    expect(CREATE_STEP_IDS.map((id) => stepLabel(id, "claude-tax", []))).toEqual([
      "Copy Agents/Claude Agent Template",
      "Link the missing shared skills",
      "Write agent.yaml",
      "No projects to connect",
      "Append the alias to ~/.zshrc",
      "Check that claude-tax resolves in a fresh zsh",
      "Open a claude-tax tab in the Workspace",
    ]);
    expect(stepLabel("projects", "x", ["Alpha"])).toBe("Connect to Alpha");
    expect(stepLabel("open", "x", ["Alpha", "Beta"])).toBe("Open a x tab in Alpha");
    expect(stepLabel("folder", "x", [], "claude-libra")).toBe("Copy claude-libra’s CLAUDE.md, settings.json, skill links and plugins link");
  });

  it("show the alias to fix when the alias or its check failed, and both done once Check again passes", () => {
    expect(aliasFailed(steps("dddsddd"))).toBe(false);
    expect(aliasFailed(steps("dddsdft"))).toBe(true);
    expect(aliasFailed(steps("dddsfdt"))).toBe(true);
    expect(aliasFailed(steps("dddfddd"))).toBe(false);
    expect(aliasChecked(steps("dddsfft")).map((s) => s.state)).toEqual(["done", "done", "done", "skip", "done", "done", "todo"]);
    expect(aliasChecked(steps("dddfdft")).map((s) => s.state)).toEqual(["done", "done", "done", "fail", "done", "done", "todo"]);
  });

  it("take the tab the page opened after Check again, and settle on done only when every step is done or skipped", () => {
    const checked = aliasChecked(steps("dddsfft"));
    expect(settledPhase(checked)).toBe("incomplete");
    expect(withOpen(checked, "run").at(-1)).toEqual({ id: "open", state: "run", detail: null });
    const opened = withOpen(checked, "done", "Opened in the Workspace");
    expect(settledPhase(opened)).toBe("done");
    expect(settledPhase(withOpen(checked, "fail", "The tab did not open: not-found"))).toBe("incomplete");
    expect(settledPhase(steps("dddfddd"))).toBe("incomplete");
  });

  it("leave the page where the Create's outcome says", () => {
    const result = (outcome: CreateAgentResult["outcome"]): CreateAgentResult => ({ createId: "c", name: "x", outcome, steps: [], refused: null, folder: "/w/Agents/x", aliasLine: "", rcFile: null, openIn: "__workspace__", tabId: null });
    expect(phaseOf(result("created"))).toBe("done");
    expect(phaseOf(result("incomplete"))).toBe("incomplete");
    expect(phaseOf(result("failed"))).toBe("failed");
    expect(phaseOf(result("refused"))).toBe("edit");
    expect(["edit", "creating", "done", "incomplete", "failed"].map((p) => pageTitle(p as "edit", "claude-tax"))).toEqual(["New agent", "Creating claude-tax", "claude-tax created", "claude-tax created", "claude-tax not created"]);
    expect(pageTitle("edit", "", "claude-libra")).toBe("New agent — clone of claude-libra");
  });
});

describe("a clone", () => {
  const profile = (id: string, over: Partial<AgentProfile> = {}): AgentProfile => ({ id, provider: "claude", kind: "folder", configDir: `Agents/${id}`, command: id, role: "The librarian.", tags: ["vault"], hidden: false, modes: {}, ...over });
  const entry = (id: string, over: Partial<RosterEntry> = {}, p: Partial<AgentProfile> = {}): RosterEntry => {
    const value = profile(id, p);
    return { id, name: id, profile: value, problem: null, orphan: false, configDir: `/w/Agents/${id}`, model: null, effort: null, provider: value.provider, kind: value.kind, hidden: value.hidden, ...over };
  };

  it("starts only from a Claude Code folder agent with a readable profile that is not an orphan", () => {
    const agents = [
      entry("claude", {}, { kind: "builtin" }),
      entry("codex", {}, { provider: "codex", kind: "builtin" }),
      entry("claude-libra"),
      entry("claude-gone", { orphan: true }),
      entry("claude-bad", { profile: null, problem: "bad" }),
      entry("claude-hidden", {}, { hidden: true }),
    ];
    expect(cloneable(agents).map((a) => a.id)).toEqual(["claude-libra", "claude-hidden"]);
  });

  it("pre-fills the role, the tags and the projects that list the source", () => {
    const projects = [
      { id: "alpha", agents: ["claude", "claude-libra"] },
      { id: "beta", agents: ["claude"] },
      { id: "gamma", agents: ["claude-libra"] },
    ];
    expect(clonePrefill(entry("claude-libra"), projects)).toEqual({ role: "The librarian.", tags: ["vault"], projects: ["alpha", "gamma"] });
    const bare: AgentProfile = { id: "claude-bare", provider: "claude", kind: "folder", configDir: "Agents/claude-bare", command: "claude-bare", tags: [], hidden: false, modes: {} };
    expect(clonePrefill(entry("claude-bare", { profile: bare }), [])).toEqual({ role: "", tags: [], projects: [] });
  });

  it("cuts a source's role and tags to the limits a new agent holds", () => {
    const long: AgentProfile = { id: "claude-long", provider: "claude", kind: "folder", configDir: "Agents/claude-long", command: "claude-long", role: "r".repeat(300), tags: Array.from({ length: 30 }, (_, i) => `tag-${i}`).concat(["x".repeat(40)]), hidden: false, modes: {} };
    const fill = clonePrefill(entry("claude-long", { profile: long }), []);
    expect(fill.role).toHaveLength(200);
    expect(fill.tags).toHaveLength(20);
    expect(clonePrefill(entry("claude-long", { profile: { ...long, tags: ["x".repeat(40)] } }), []).tags).toEqual(["x".repeat(24)]);
  });
});

describe("takePrefill", () => {
  const form = { role: "Typed.", tags: ["mine"], projects: ["alpha"] };
  const fill = { role: "Source role.", tags: ["src"], projects: ["beta"] };

  it("gives the untouched fields the source's values", () => {
    expect(takePrefill(form, { role: false, tags: false, projects: false }, fill)).toEqual(fill);
  });

  it("keeps each field the user changed", () => {
    expect(takePrefill(form, { role: true, tags: false, projects: true }, fill)).toEqual({ role: "Typed.", tags: ["src"], projects: ["alpha"] });
    expect(takePrefill(form, { role: true, tags: true, projects: true }, fill)).toEqual(form);
  });
});
