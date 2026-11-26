// The roster through the fake Pomade's broker, as Pomade and Runner call it (ARCHITECTURE §3, §5): in the
// sandbox workspace every agent gets its `agent.yaml` — the folder agent's role line from its
// `CLAUDE.md`; `roster.list` passes Pomade's own check and leaves a hidden agent out; launch specs
// carry the provider's mode argument and resume form, and their `line` runs in a real shell to
// exactly their `args`; a renamed agent folder leaves its profile an orphan and comes back as a new
// agent within ~2 s, with a `roster.changed` notice; the project ↔ agent connection is read from
// the projects' visible agents.

import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { checkRosterList, type JsonValue } from "pomade-kit/protocol";

import { FIXTURE_AGENTS } from "../harness/app.ts";
import type { Sandbox } from "../harness/sandbox.ts";
import {
  ROSTER_AGENTS_FOR_METHOD,
  ROSTER_AGENTS_METHOD,
  ROSTER_CHANGED_EVENT,
  ROSTER_LAUNCH_SPEC_METHOD,
  ROSTER_LIST_METHOD,
  ROSTER_PROJECTS_FOR_METHOD,
  isLaunchSpec,
  isRosterAgentsAnswer,
  isRosterChanged,
  type LaunchSpec,
  type RosterAgentsAnswer,
} from "../src/shared/roster.ts";
import type { FakePomade } from "../harness/fake-pomade.ts";
import { expect, test } from "./fixtures.ts";

/** Pomade's limit for its roster read. */
const LIMIT_MS = 1500;
const POMADE = { from: "pomade" };
const RUNNER = { from: "pomade-runner" };
const LIBRA = "claude-libra";

const profileOf = (sandbox: Sandbox, id: string): string => join(sandbox.workspace, "Apps", "pomade-agents", "agents", id, "agent.yaml");

async function agents(pomade: FakePomade): Promise<RosterAgentsAnswer> {
  const answer = await pomade.fake.callApi(ROSTER_AGENTS_METHOD);
  if (!isRosterAgentsAnswer(answer)) throw new Error(`not a roster.agents answer: ${JSON.stringify(answer)}`);
  return answer;
}

/** Every fixture agent has its profile on disk. */
async function profiled(pomade: FakePomade, message: string): Promise<void> {
  await expect
    .poll(async () => {
      const answer = await agents(pomade).catch(() => null);
      return answer?.agents.filter((a) => a.profile !== null).map((a) => a.id) ?? [];
    }, { message })
    .toEqual(FIXTURE_AGENTS);
}

async function listed(pomade: FakePomade): Promise<string[]> {
  const started = Date.now();
  const answer = await pomade.fake.callApi(ROSTER_LIST_METHOD, {}, POMADE);
  expect(Date.now() - started, `roster.list answers inside ${LIMIT_MS} ms`).toBeLessThan(LIMIT_MS);
  const checked = checkRosterList(answer);
  if (!checked.ok) throw new Error(`Pomade refuses the roster: ${checked.message}`);
  expect(checked.agents).toEqual((answer as { agents: unknown }).agents);
  return checked.agents.map((a) => a.id);
}

const launch = (pomade: FakePomade, params: JsonValue): Promise<JsonValue> => pomade.fake.callApi(ROSTER_LAUNCH_SPEC_METHOD, params, RUNNER);

test("in the sandbox workspace every agent gets its agent.yaml, the folder agent's role line from its CLAUDE.md, and Pomade's check takes the list", async ({ pomade, sandbox, backend }) => {
  await profiled(pomade, backend.output());
  expect(await readFile(profileOf(sandbox, LIBRA), "utf8")).toBe(
    "id: claude-libra\nprovider: claude\nkind: folder\nconfigDir: Agents/claude-libra\ncommand: claude-libra\nrole: A meticulous librarian for the fixture workspace.\ntags: []\nhidden: false\nmodes:\n  normal:\n    enabled: true\n  full-autonomy:\n    enabled: true\n",
  );
  expect(await readFile(profileOf(sandbox, "claude"), "utf8")).toContain("kind: builtin\nconfigDir: ~/.claude\n");
  const answer = await agents(pomade);
  expect(answer.profilesOff).toBeNull();
  expect(answer.agents.map((a) => ({ id: a.id, name: a.name, model: a.model, effort: a.effort, orphan: a.orphan }))).toEqual([
    { id: "claude", name: "Claude", model: "opus", effort: "high", orphan: false },
    { id: "codex", name: "Codex", model: "gpt-5.2-codex", effort: "medium", orphan: false },
    { id: LIBRA, name: LIBRA, model: null, effort: null, orphan: false },
  ]);

  expect(await listed(pomade)).toEqual(FIXTURE_AGENTS);
  expect(await pomade.fake.callApi(ROSTER_LIST_METHOD, {}, POMADE)).toMatchObject({
    agents: [
      { id: "claude", command: "claude", provider: "claude", configDir: join(sandbox.home, ".claude"), modes: [{ id: "normal", args: [] }, { id: "full-autonomy", args: ["--dangerously-skip-permissions"] }] },
      { id: "codex", provider: "codex", configDir: join(sandbox.home, ".codex"), modes: [{ id: "normal" }, { id: "full-autonomy", args: ["--dangerously-bypass-approvals-and-sandbox"] }] },
      { id: LIBRA, command: LIBRA, provider: "claude", configDir: join(sandbox.workspace, "Agents", LIBRA) },
    ],
  });
});

test("a hidden agent is left out of roster.list and stays in roster.agents; a disabled mode is offered nowhere", async ({ pomade, sandbox, backend }) => {
  await profiled(pomade, backend.output());
  const heard: JsonValue[] = [];
  pomade.fake.subscribeAs("pomade-runner", ROSTER_CHANGED_EVENT, heard);
  const text = await readFile(profileOf(sandbox, LIBRA), "utf8");
  await writeFile(profileOf(sandbox, LIBRA), text.replace("hidden: false", "hidden: true"));
  await expect.poll(() => listed(pomade)).toEqual(["claude", "codex"]);
  expect((await agents(pomade)).agents.find((a) => a.id === LIBRA)?.profile).toMatchObject({ hidden: true });
  await expect.poll(() => heard.length).toBeGreaterThan(0);
  expect(heard.every(isRosterChanged)).toBe(true);

  const codex = await readFile(profileOf(sandbox, "codex"), "utf8");
  await writeFile(profileOf(sandbox, "codex"), codex.replace("full-autonomy:\n    enabled: true", "full-autonomy:\n    enabled: false"));
  await expect.poll(async () => ((await pomade.fake.callApi(ROSTER_LIST_METHOD, {}, POMADE)) as { agents: { id: string; modes: { id: string }[] }[] }).agents.find((a) => a.id === "codex")?.modes.map((m) => m.id)).toEqual(["normal"]);
  await expect(launch(pomade, { agent: "codex", mode: "full-autonomy" })).rejects.toMatchObject({ code: "invalid-params" });
});

test("a launch spec carries the provider's Full autonomy argument and resume form, and its line runs to exactly its args", async ({ pomade, sandbox, backend }) => {
  await profiled(pomade, backend.output());
  expect(await launch(pomade, { agent: LIBRA, mode: "full-autonomy" })).toEqual({
    command: LIBRA,
    args: ["--dangerously-skip-permissions"],
    line: `${LIBRA} --dangerously-skip-permissions`,
    sessionId: null,
    exit: "/exit",
  });
  expect(await launch(pomade, { agent: "claude", mode: "full-autonomy", resume: "5b0e8f52-3c1d-4a7e-9f21-6d8c0b4a7e13" })).toMatchObject({
    args: ["--dangerously-skip-permissions", "--resume", "5b0e8f52-3c1d-4a7e-9f21-6d8c0b4a7e13"],
    sessionId: "5b0e8f52-3c1d-4a7e-9f21-6d8c0b4a7e13",
  });
  expect(await launch(pomade, { agent: "codex", mode: "full-autonomy", resume: "019a7c3e-5b2d-7f10-8c4e-1d2f3a4b5c6d" })).toMatchObject({
    command: "codex",
    args: ["--dangerously-bypass-approvals-and-sandbox", "resume", "019a7c3e-5b2d-7f10-8c4e-1d2f3a4b5c6d"],
    line: "codex --dangerously-bypass-approvals-and-sandbox resume 019a7c3e-5b2d-7f10-8c4e-1d2f3a4b5c6d",
    sessionId: "019a7c3e-5b2d-7f10-8c4e-1d2f3a4b5c6d",
    exit: "/exit",
  });
  const id = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";
  expect(await launch(pomade, { agent: "codex", mode: "normal", sessionId: id })).toMatchObject({ args: [], sessionId: null });
  await expect(launch(pomade, { agent: LIBRA, mode: "normal", resume: "a", sessionId: id })).rejects.toMatchObject({ code: "invalid-params" });
  await expect(launch(pomade, { agent: LIBRA, mode: "plan" })).rejects.toMatchObject({ code: "invalid-params" });
  await expect(launch(pomade, { agent: "ghost", mode: "normal" })).rejects.toMatchObject({ code: "not-found" });

  // The alias is the agent's: here a script in its place prints what it gets.
  const prompt = "Fix `it`: don't touch $HOME!\n\t- \"quoted\" \\ back\nlast line";
  const answer = await launch(pomade, { agent: LIBRA, mode: "normal", sessionId: id, prompt });
  expect(isLaunchSpec(answer)).toBe(true);
  const spec = answer as LaunchSpec;
  expect(spec).toMatchObject({ args: ["--session-id", id, prompt], sessionId: id });
  expect(spec.line).not.toContain("\n");
  const bin = join(sandbox.root, "bin");
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, LIBRA), "#!/bin/sh\nfor arg in \"$@\"; do printf '%s\\0' \"$arg\"; done\n");
  await chmod(join(bin, LIBRA), 0o755);
  const out = execFileSync("/bin/sh", ["-c", spec.line], { env: { PATH: `${bin}:/usr/bin:/bin`, HOME: sandbox.home }, encoding: "utf8" });
  expect(out.slice(0, -1).split("\0")).toEqual(spec.args);
});

test("renaming an agent's folder makes its profile an orphan, out of the list, and the new folder a new agent within ~2 s", async ({ pomade, sandbox, backend }) => {
  await profiled(pomade, backend.output());
  await rename(join(sandbox.workspace, "Agents", LIBRA), join(sandbox.workspace, "Agents", "claude-librarian"));
  const renamed = Date.now();
  await expect.poll(() => listed(pomade), { timeout: 4000, intervals: [100] }).toEqual(["claude", "codex", "claude-librarian"]);
  expect(Date.now() - renamed).toBeLessThan(3000);
  const answer = await agents(pomade);
  expect(answer.agents.find((a) => a.id === LIBRA)).toMatchObject({ orphan: true, profile: { configDir: "Agents/claude-libra" } });
  await expect.poll(() => readFile(profileOf(sandbox, "claude-librarian"), "utf8").catch(() => "")).toContain("role: A meticulous librarian for the fixture workspace.\n");
  await expect(launch(pomade, { agent: LIBRA, mode: "normal" })).rejects.toMatchObject({ code: "not-found" });
});

test("the project ↔ agent connection is each project's visible agents, the Workspace offering every agent", async ({ pomade, backend }) => {
  await profiled(pomade, backend.output());
  pomade.fake.updateProject("beta", { visibleAgents: [LIBRA, "ghost"] });
  const agentsFor = (project: string): Promise<JsonValue> => pomade.fake.callApi(ROSTER_AGENTS_FOR_METHOD, { project }, RUNNER);
  const projectsFor = (agent: string): Promise<JsonValue> => pomade.fake.callApi(ROSTER_PROJECTS_FOR_METHOD, { agent }, RUNNER);
  expect(await agentsFor("alpha")).toEqual({ agents: FIXTURE_AGENTS });
  expect(await agentsFor("beta")).toEqual({ agents: [LIBRA] });
  expect(await agentsFor("__workspace__")).toEqual({ agents: FIXTURE_AGENTS });
  expect(await projectsFor(LIBRA)).toEqual({ projects: ["alpha", "beta"] });
  expect(await projectsFor("claude")).toEqual({ projects: ["alpha"] });
  pomade.fake.updateProject("alpha", { visibleAgents: [] });
  expect(await projectsFor("claude")).toEqual({ projects: [] });
  await expect(agentsFor("nowhere")).rejects.toMatchObject({ code: "not-found" });
  await expect(projectsFor("ghost")).rejects.toMatchObject({ code: "not-found" });
});
