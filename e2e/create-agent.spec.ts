// Creating an agent from the template on the New agent page (ARCHITECTURE §3.6, E-006), against the fake
// Pomade with the sandbox's HOME, rc file and workspace: the name is checked as it is typed —
// characters, the folder, then zsh — and `claude-pm` and `ls` are refused before anything is
// written; Create ticks its steps, makes the folder with the shared skill links and `agent.yaml`,
// connects the chosen project, appends the alias to the sandbox's `.zshrc` exactly once and finds
// it resolving, the agent is in `roster.list`, and its tab opens in that project with the setup
// prompt to copy; a rc file that cannot be written marks the alias, keeps the agent, shows the line
// and opens no tab, and Check again passes once the line is there and opens the tab then; a slow
// shell never blocks typing nor leaves a verdict about a name no longer typed.
//
// The backend's environment is the sandbox's (`backendEnv`): its HOME is the sandbox home and no
// ZDOTDIR is set, so the only rc file it can reach is `<sandbox>/home/.zshrc` — which
// `roster.checkAlias` names, and which every assertion here reads.

import { execFileSync } from "node:child_process";
import { chmod, lstat, mkdir, readFile, readdir, readlink, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";

import type { FrameLocator, Page } from "@playwright/test";
import { checkRosterList, type RosterAgent } from "pomade-kit/protocol";

import type { Sandbox } from "../harness/sandbox.ts";
import type { FakePomade } from "../harness/fake-pomade.ts";
import {
  ROSTER_AGENTS_METHOD,
  ROSTER_CHECK_ALIAS_METHOD,
  ROSTER_CREATE_METHOD,
  ROSTER_LIST_METHOD,
  ROSTER_PROJECTS_FOR_METHOD,
  isAliasCheck,
  isCreateAgentResult,
  isRosterAgentsAnswer,
} from "../src/shared/roster.ts";
import { expect, test, type Shell } from "./fixtures.ts";

const NAME = "claude-tax-advisor";
const ROLE = "Prepares the Spanish tax return and tracks its deadlines.";
const TEMPLATE = "Claude Agent Template";

const rcOf = (sandbox: Sandbox): string => join(sandbox.home, ".zshrc");
const aliasFor = (sandbox: Sandbox, name: string): string => `alias ${name}='CLAUDE_CONFIG_DIR="${join(sandbox.workspace, "Agents", name)}" claude'`;
const occurrences = (text: string, line: string): number => text.split("\n").filter((l) => l === line).length;

/** The roster has read the sandbox: every agent has its profile, so the backend is ready to create. */
async function rosterReady(pomade: FakePomade): Promise<void> {
  await expect
    .poll(async () => {
      const answer = await pomade.fake.callApi(ROSTER_AGENTS_METHOD).catch(() => null);
      return isRosterAgentsAnswer(answer) && answer.agents.length > 0 && answer.agents.every((a) => a.profile !== null);
    })
    .toBe(true);
}

/** The app's tab in Alpha, at the New agent page. */
async function openNewAgent(page: Page, openShell: (page: Page) => Promise<Shell>, pomade: FakePomade): Promise<FrameLocator> {
  const { tabFrame } = await openShell(page);
  pomade.fake.openAppTab({ projectId: "alpha", route: "roster/new" });
  const tab = tabFrame("alpha");
  await expect(tab.getByRole("heading", { name: "New agent" })).toBeVisible();
  return tab;
}

async function typeName(tab: FrameLocator, name: string): Promise<void> {
  await tab.getByTestId("new-agent-name").fill(name);
}

const nameMessage = (tab: FrameLocator) => tab.getByTestId("new-agent-name-message");

/** The fake Pomade's roster for `agentTabs.launch`: the agents a test creates (Pomade reads the app's
 *  `roster.list` on each launch; the fake holds a fixed one). */
const launchable = (...ids: string[]): RosterAgent[] => ids.map((id) => ({ id, name: id, command: id, provider: "claude" }));

test.describe("from the template", () => {
  // The fake Pomade launches in a project folder its own files hold.
  test.use({ pomadeSeed: { roster: launchable(NAME), files: { "Projects/beta/README.md": "" } } });

  test("Create makes the agent: its folder and skill links, agent.yaml, its project, the alias once and resolving; it is in roster.list", async ({ page, openShell, pomade, sandbox, backend }) => {
    await rosterReady(pomade);
    // Beta lists its agents; Alpha offers every agent (the fixture's default).
    pomade.fake.updateProject("beta", { visibleAgents: ["claude"] });
    const rcBefore = await readFile(rcOf(sandbox), "utf8");
    const tab = await openNewAgent(page, openShell, pomade);

    await expect(tab.getByTestId("new-agent-projects-none")).toHaveCount(0);
    await expect(tab.getByTestId("new-agent-project-alpha")).toHaveCount(0);
    await expect(tab.getByText("Alpha offers every agent already.")).toBeVisible();

    await typeName(tab, NAME);
    await expect(nameMessage(tab)).toHaveText(`Free: folder Agents/${NAME}, alias ${NAME}.`);
    await tab.getByTestId("new-agent-role").fill(ROLE);
    await tab.getByTestId("new-agent-tag").fill("Tax");
    await tab.getByTestId("new-agent-tag").press("Enter");
    await tab.getByTestId("new-agent-tag").fill("personal");
    await tab.getByTestId("new-agent-tag").press(",");
    await expect(tab.getByTestId("new-agent-tag-chip")).toHaveText(["tax", "personal"]);
    await tab.getByTestId("new-agent-project-beta").click();
    await expect(tab.getByTestId("new-agent-project-beta")).toHaveAttribute("aria-checked", "true");
    await expect(tab.getByTestId("new-agent-create-will").locator("li")).toHaveText([
      `Copy Agents/${TEMPLATE} to Agents/${NAME}/`,
      "Link every missing shared skill from Agents/_shared/skills",
      `Write Apps/pomade-agents/agents/${NAME}/agent.yaml`,
      "Connect to Beta",
      `Append alias ${NAME}=… to ~/.zshrc and check it resolves`,
      `Open a ${NAME} tab in Beta`,
    ]);

    await tab.getByTestId("new-agent-create").click();
    await expect(tab.getByRole("heading", { name: `${NAME} created` })).toBeVisible({ timeout: 30_000 });
    await expect(tab.getByTestId("new-agent-steps").locator("li")).toHaveText([
      `Copy Agents/${TEMPLATE}`,
      "Link the missing shared skills",
      "Write agent.yaml",
      "Connect to Beta",
      "Append the alias to ~/.zshrc",
      `Check that ${NAME} resolves in a fresh zsh`,
      `Open a ${NAME} tab in Beta`,
    ]);
    for (const step of ["folder", "skills", "profile", "projects", "alias", "verify", "open"]) await expect(tab.getByTestId(`new-agent-step-${step}`)).toHaveAttribute("data-state", "done");
    await expect(tab.getByTestId("new-agent-done")).toContainText(`${NAME} is ready`);

    // Its tab: opened by Pomade in the first project connected, with no prompt typed (it starts logged out).
    expect(pomade.fake.openedAgentTabs).toEqual([expect.objectContaining({ kind: "agent", agentId: NAME, projectId: "beta", mode: "normal" })]);
    expect(pomade.fake.openedAgentTabs[0]?.prompt).toBeUndefined();
    await expect(tab.getByTestId("new-agent-done-text")).toContainText("Its tab is open in Beta.");
    await expect(tab.getByTestId("new-agent-setup-prompt")).toHaveText(`Use the creating-claude-agent skill to set up ${NAME}: role “${ROLE}”, tags tax, personal.`);
    await tab.getByTestId("new-agent-copy-prompt").click();
    await expect(tab.getByTestId("new-agent-copy-prompt")).toHaveText("Copied");
    await tab.getByTestId("new-agent-go-to-tab").click();
    await expect.poll(() => pomade.fake.focusedAgentTabs).toEqual([pomade.fake.openedAgentTabs[0]?.tabId]);

    // The folder: the template, its own skill, its shared link, and the shared skill it lacked.
    const folder = join(sandbox.workspace, "Agents", NAME);
    expect((await readdir(folder)).sort()).toEqual(["CLAUDE.md", "settings.json", "skills"]);
    expect(await readFile(join(folder, "CLAUDE.md"), "utf8")).toBe(await readFile(join(sandbox.workspace, "Agents", TEMPLATE, "CLAUDE.md"), "utf8"));
    expect((await readdir(join(folder, "skills"))).sort()).toEqual(["creating-claude-agent", "grill-me", "second-opinion"]);
    expect(await readlink(join(folder, "skills", "grill-me"))).toBe("../../_shared/skills/grill-me");
    expect(await readlink(join(folder, "skills", "second-opinion"))).toBe("../../_shared/skills/second-opinion");
    expect(await readFile(join(folder, "skills", "second-opinion", "SKILL.md"), "utf8")).toContain("name: second-opinion");
    expect((await lstat(join(folder, "skills", "creating-claude-agent"))).isDirectory()).toBe(true);
    expect((await readdir(join(sandbox.workspace, "Agents"))).filter((n) => n.startsWith("."))).toEqual([]);

    expect(await readFile(join(sandbox.workspace, "Apps", "pomade-agents", "agents", NAME, "agent.yaml"), "utf8")).toBe(
      `id: ${NAME}\nprovider: claude\nkind: folder\nconfigDir: Agents/${NAME}\ncommand: ${NAME}\nrole: ${ROLE}\ntags:\n  - tax\n  - personal\nhidden: false\nmodes:\n  normal:\n    enabled: true\n  full-autonomy:\n    enabled: true\n`,
    );

    // The alias: in the sandbox's rc file, exactly once, after what was there; the backend names that file.
    const rc = await readFile(rcOf(sandbox), "utf8");
    expect(rc).toBe(`${rcBefore}${aliasFor(sandbox, NAME)}\n`);
    expect(occurrences(rc, aliasFor(sandbox, NAME))).toBe(1);
    const check = await pomade.fake.callApi(ROSTER_CHECK_ALIAS_METHOD, { agent: NAME });
    expect(isAliasCheck(check)).toBe(true);
    expect(check).toMatchObject({ ok: true, rcFile: rcOf(sandbox), aliasLine: aliasFor(sandbox, NAME) });
    expect(rcOf(sandbox).startsWith(sandbox.root + sep)).toBe(true);
    // A new terminal of this home resolves it.
    expect(execFileSync("/bin/zsh", ["-ilc", `whence -w ${NAME}`], { env: sandbox.backendEnv(), encoding: "utf8" }).trim()).toBe(`${NAME}: alias`);

    // On the roster and in Pomade's "+" menu, connected to Alpha (every agent) and Beta (listed now).
    const list = await pomade.fake.callApi(ROSTER_LIST_METHOD, {}, { from: "pomade" });
    expect(checkRosterList(list)).toMatchObject({ ok: true });
    expect((list as { agents: { id: string }[] }).agents.find((a) => a.id === NAME)).toMatchObject({ id: NAME, name: NAME, command: NAME, provider: "claude", configDir: folder });
    expect(await pomade.fake.callApi(ROSTER_PROJECTS_FOR_METHOD, { agent: NAME }, { from: "pomade-runner" })).toEqual({ projects: ["alpha", "beta"] });

    // A second Create of the name is refused, and the rc file keeps one line.
    const again = await pomade.fake.callApi(ROSTER_CREATE_METHOD, { name: NAME, role: ROLE, tags: [], projects: [], createId: "again" });
    expect(again).toMatchObject({ outcome: "refused", refused: { problem: "folder" } });
    expect(occurrences(await readFile(rcOf(sandbox), "utf8"), aliasFor(sandbox, NAME))).toBe(1);

    await tab.getByTestId("new-agent-open-page").click();
    await expect.poll(() => pomade.fake.appTabs.find((t) => t.projectId === "alpha")?.route).toBe(`roster/${NAME}/overview`);
    expect(backend.running()).toBe(true);
  });
});

test.describe("refused names", () => {
  test.use({
    seed: {
      async into(sandbox) {
        await mkdir(join(sandbox.workspace, "Agents", "claude-pm"), { recursive: true });
        await writeFile(join(sandbox.workspace, "Agents", "claude-pm", "CLAUDE.md"), "# claude-pm\n");
        await writeFile(rcOf(sandbox), `${await readFile(rcOf(sandbox), "utf8")}alias claude-tax='echo taxes'\n`);
      },
    },
  });

  test("are checked as typed — characters, the folder, then zsh — and claude-pm and ls are refused before anything is written", async ({ page, openShell, pomade, sandbox, backend }) => {
    await rosterReady(pomade);
    const agentsBefore = await sandbox.snapshot(join(sandbox.workspace, "Agents"));
    const rcBefore = await readFile(rcOf(sandbox), "utf8");
    const tab = await openNewAgent(page, openShell, pomade);

    const refused = async (name: string, problem: string, text: string): Promise<void> => {
      await typeName(tab, name);
      await expect(nameMessage(tab)).toHaveAttribute("data-problem", problem);
      await expect(nameMessage(tab)).toHaveText(text);
      await expect(tab.getByTestId("new-agent-name")).toHaveAttribute("aria-invalid", "true");
    };
    await refused("-tax", "leading-dash", "Start with a letter or digit: a leading “-” breaks the alias.");
    await refused("Claude-Tax", "characters", "Only lowercase letters, digits and “-”.");
    await refused("new", "reserved", "new is the New agent page’s own address.");
    await refused("claude-pm", "folder", "Agents/claude-pm already exists.");
    await refused("codex", "agent", "The roster already has an agent codex.");
    await refused("ls", "shell", "ls already runs something in zsh: ls is /bin/ls.");
    await refused("claude-tax", "shell", "claude-tax already runs something in zsh: claude-tax is an alias for echo taxes.");

    // Create with a refused name stays on the form and says what to fix.
    await tab.getByTestId("new-agent-role").fill(ROLE);
    await tab.getByTestId("new-agent-create").click();
    await expect(tab.getByText("Fix the fields marked red.")).toBeVisible();
    await expect(tab.getByRole("heading", { name: "New agent" })).toBeVisible();

    // The backend refuses them too, whoever asks.
    for (const [name, problem] of [["claude-pm", "folder"], ["ls", "shell"]] as const) {
      const result = await pomade.fake.callApi(ROSTER_CREATE_METHOD, { name, role: ROLE, tags: [], projects: ["beta"], createId: name });
      expect(isCreateAgentResult(result), name).toBe(true);
      expect(result, name).toMatchObject({ outcome: "refused", refused: { name, problem } });
      expect((result as { steps: { state: string }[] }).steps.map((s) => s.state), name).toEqual(["todo", "todo", "todo", "todo", "todo", "todo", "todo"]);
    }
    expect(await sandbox.snapshot(join(sandbox.workspace, "Agents"))).toEqual(agentsBefore);
    expect((await readdir(join(sandbox.workspace, "Agents"))).sort()).toEqual([TEMPLATE, "_shared", "claude-libra", "claude-pm"]);
    expect(await readFile(rcOf(sandbox), "utf8")).toBe(rcBefore);
    expect(backend.running()).toBe(true);
  });
});

test.describe("a rc file that cannot be written", () => {
  test.use({
    seed: {
      async into(sandbox) {
        await chmod(rcOf(sandbox), 0o444);
      },
    },
    pomadeSeed: { roster: launchable("claude-writer") },
  });

  test("marks the alias, keeps the agent, shows the line to add and opens no tab; Check again passes once it is there and opens the tab", async ({ page, openShell, pomade, sandbox, backend }) => {
    await rosterReady(pomade);
    const tab = await openNewAgent(page, openShell, pomade);
    await typeName(tab, "claude-writer");
    await expect(nameMessage(tab)).toHaveAttribute("data-state", "ok");
    await tab.getByTestId("new-agent-role").fill("Drafts the letters.");
    await tab.getByTestId("new-agent-role").press("Enter");

    await expect(tab.getByTestId("new-agent-alias-failed")).toBeVisible({ timeout: 30_000 });
    await expect(tab.getByRole("heading", { name: "claude-writer created" })).toBeVisible();
    await expect(tab.getByTestId("new-agent-step-alias")).toHaveAttribute("data-state", "fail");
    await expect(tab.getByTestId("new-agent-step-alias")).toContainText(`Could not write ${rcOf(sandbox)} (EACCES)`);
    await expect(tab.getByTestId("new-agent-step-verify")).toHaveAttribute("data-state", "fail");
    await expect(tab.getByTestId("new-agent-step-verify")).toContainText("claude-writer does not resolve in a fresh zsh");
    for (const step of ["folder", "skills", "profile"]) await expect(tab.getByTestId(`new-agent-step-${step}`)).toHaveAttribute("data-state", "done");
    await expect(tab.getByTestId("new-agent-step-projects")).toHaveAttribute("data-state", "skip");
    const line = aliasFor(sandbox, "claude-writer");
    await expect(tab.getByTestId("new-agent-alias-line")).toHaveText(line);
    await expect(tab.getByTestId("new-agent-alias-failed")).toContainText(`Add this line to ${rcOf(sandbox)}`);
    await expect(tab.getByTestId("new-agent-alias-failed")).toContainText("its tab opens once it resolves");
    await expect(tab.getByTestId("new-agent-done")).toHaveCount(0);
    // No tab: it would run a command zsh does not know.
    await expect(tab.getByTestId("new-agent-step-open")).toHaveAttribute("data-state", "todo");
    expect(pomade.fake.openedAgentTabs).toEqual([]);

    // Everything else is there: the folder, and the agent on the roster.
    expect((await readdir(join(sandbox.workspace, "Agents", "claude-writer"))).sort()).toEqual(["CLAUDE.md", "settings.json", "skills"]);
    await expect.poll(async () => ((await pomade.fake.callApi(ROSTER_LIST_METHOD, {}, { from: "pomade" })) as { agents: { id: string }[] }).agents.map((a) => a.id)).toContain("claude-writer");

    // Not yet: Check again says so.
    await tab.getByTestId("new-agent-check-again").click();
    await expect(tab.getByTestId("new-agent-check-detail")).toHaveText("Still not: claude-writer does not resolve in a fresh zsh.");

    // The user adds the line; Check again finds it.
    await chmod(rcOf(sandbox), 0o644);
    await writeFile(rcOf(sandbox), `${await readFile(rcOf(sandbox), "utf8")}${line}\n`);
    await tab.getByTestId("new-agent-check-again").click();
    await expect(tab.getByTestId("new-agent-done")).toBeVisible({ timeout: 20_000 });
    await expect(tab.getByTestId("new-agent-alias-failed")).toHaveCount(0);
    await expect(tab.getByTestId("new-agent-step-verify")).toHaveAttribute("data-state", "done");
    await expect(tab.getByTestId("new-agent-step-alias")).toHaveAttribute("data-state", "done");
    // Now the tab opens — in the Workspace, as no project was connected.
    await expect(tab.getByTestId("new-agent-step-open")).toHaveAttribute("data-state", "done");
    await expect(tab.getByTestId("new-agent-step-open")).toHaveText("Open a claude-writer tab in the Workspace");
    expect(pomade.fake.openedAgentTabs).toEqual([expect.objectContaining({ agentId: "claude-writer", projectId: "__workspace__", mode: "normal" })]);
    await expect(tab.getByTestId("new-agent-done-text")).toContainText("Its tab is open in the Workspace.");
    expect(backend.running()).toBe(true);
  });
});

test.describe("a slow shell", () => {
  test.use({
    seed: {
      async into(sandbox) {
        await writeFile(rcOf(sandbox), `sleep 1.5\n${await readFile(rcOf(sandbox), "utf8")}`);
      },
    },
  });

  test("never blocks typing, and a verdict on a name no longer typed never shows", async ({ page, openShell, pomade, backend }) => {
    await rosterReady(pomade);
    const tab = await openNewAgent(page, openShell, pomade);
    const field = tab.getByTestId("new-agent-name");
    await field.fill("ls");
    await expect(tab.getByTestId("new-agent-name-checking")).toBeVisible();
    // The check of `ls` is out; the name changes before zsh answers.
    // eslint-disable-next-line playwright/no-wait-for-timeout -- the race needs the check of "ls" sent (past the 300 ms pause) and not answered (zsh takes 1.5 s)
    await page.waitForTimeout(500);
    await field.pressSequentially("-not-a-command", { delay: 10 });
    await expect(field).toHaveValue("ls-not-a-command");
    await expect(nameMessage(tab)).toHaveAttribute("data-state", "checking");
    await expect(nameMessage(tab)).toHaveText("Free: folder Agents/ls-not-a-command, alias ls-not-a-command.", { timeout: 10_000 });
    // The answer about `ls` comes meanwhile; the verdict stays the typed name's.
    // eslint-disable-next-line playwright/no-wait-for-timeout -- nothing on the page marks the stale answer arriving: wait past it
    await page.waitForTimeout(2000);
    await expect(nameMessage(tab)).toHaveAttribute("data-state", "ok");
    expect(backend.running()).toBe(true);
  });
});

test("Check again is for a folder agent the roster holds", async ({ pomade, backend }) => {
  await rosterReady(pomade);
  await expect(pomade.fake.callApi(ROSTER_CHECK_ALIAS_METHOD, { agent: "nobody" })).rejects.toMatchObject({ code: "not-found" });
  await expect(pomade.fake.callApi(ROSTER_CHECK_ALIAS_METHOD, { agent: "claude" })).rejects.toMatchObject({ code: "not-found" });
  expect(backend.running()).toBe(true);
});
