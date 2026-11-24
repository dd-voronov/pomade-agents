import { describe, expect, it } from "vitest";

import { CREATE_STEP_IDS, type CreateAgentResult, type CreateStep } from "../../../shared/roster.ts";
import { addTags, aliasChecked, aliasFailed, answeredName, createWill, nameMessage, pageTitle, phaseOf, stepLabel, typedName, type Part } from "./new-agent-model.ts";

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
    ]);
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
    ]);
    expect(stepLabel("projects", "x", ["Alpha"])).toBe("Connect to Alpha");
  });

  it("show the alias to fix when the alias or its check failed, and both done once Check again passes", () => {
    expect(aliasFailed(steps("dddsdd"))).toBe(false);
    expect(aliasFailed(steps("dddsdf"))).toBe(true);
    expect(aliasFailed(steps("dddsfd"))).toBe(true);
    expect(aliasFailed(steps("dddfdd"))).toBe(false);
    expect(aliasChecked(steps("dddsff")).map((s) => s.state)).toEqual(["done", "done", "done", "skip", "done", "done"]);
    expect(aliasChecked(steps("dddfdf")).map((s) => s.state)).toEqual(["done", "done", "done", "fail", "done", "done"]);
  });

  it("leave the page where the Create's outcome says", () => {
    const result = (outcome: CreateAgentResult["outcome"]): CreateAgentResult => ({ createId: "c", name: "x", outcome, steps: [], refused: null, folder: "/w/Agents/x", aliasLine: "", rcFile: null });
    expect(phaseOf(result("created"))).toBe("done");
    expect(phaseOf(result("incomplete"))).toBe("incomplete");
    expect(phaseOf(result("failed"))).toBe("failed");
    expect(phaseOf(result("refused"))).toBe("edit");
    expect(["edit", "creating", "done", "incomplete", "failed"].map((p) => pageTitle(p as "edit", "claude-tax"))).toEqual(["New agent", "Creating claude-tax", "claude-tax created", "claude-tax created", "claude-tax not created"]);
  });
});

describe("tags", () => {
  it("are added trimmed, lowercased, comma-separated, each once", () => {
    expect(addTags([], "Tax, personal ,,tax")).toEqual(["tax", "personal"]);
    expect(addTags(["tax"], " TAX ")).toEqual(["tax"]);
    expect(addTags(["a"], "")).toEqual(["a"]);
  });
});
