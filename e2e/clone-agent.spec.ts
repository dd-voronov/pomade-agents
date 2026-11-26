// Cloning a folder agent and the new agent's first run (ARCHITECTURE §3.6, E-006), against the fake
// Pomade with the sandbox's HOME, rc file and workspace: Clone… on `claude-libra`'s page opens the
// New agent page with it as the source — its role, tags and projects pre-filled, the name empty —
// and Create copies only its CLAUDE.md, settings.json, skill links and plugins link (no sessions,
// memory, history, caches or .claude.json), opens the new agent's tab in the first project
// connected and hands over the setup prompt; the new agent's page shows Needs login with the prompt
// until its first session exists, and drops it without a reload when that session appears; so does
// its Roster card (and list row), whose ⋯ Clone… opens the same form.

import { mkdir, readFile, readdir, readlink, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { FrameLocator, Page } from "@playwright/test";
import type { RosterAgent } from "pomade-kit/protocol";

import type { FakePomade } from "../harness/fake-pomade.ts";
import { ROSTER_AGENTS_METHOD, ROSTER_CREATE_METHOD, ROSTER_UPDATE_PROFILE_METHOD, isRosterAgentsAnswer } from "../src/shared/roster.ts";
import { agentRoute } from "../src/ui/core/routes.ts";
import { expect, test, type Shell } from "./fixtures.ts";
import { answer, prompt } from "./transcripts.ts";

const SOURCE = "claude-libra";
const NAME = "claude-tax-advisor";
const ROLE = "Keeps the vault in order.";
const PROMPT = `Use the creating-claude-agent skill to set up ${NAME}: role “${ROLE}”, tags vault, notes.`;

const launchable = (...ids: string[]): RosterAgent[] => ids.map((id) => ({ id, name: id, command: id, provider: "claude" }));

async function rosterReady(pomade: FakePomade): Promise<void> {
  await expect
    .poll(async () => {
      const roster = await pomade.fake.callApi(ROSTER_AGENTS_METHOD).catch(() => null);
      return isRosterAgentsAnswer(roster) && roster.agents.length > 0 && roster.agents.every((a) => a.profile !== null);
    })
    .toBe(true);
}

async function openTab(page: Page, openShell: (page: Page) => Promise<Shell>, pomade: FakePomade, route: string): Promise<FrameLocator> {
  const { tabFrame } = await openShell(page);
  pomade.fake.openAppTab({ projectId: "alpha", route });
  return tabFrame("alpha");
}

test.describe("a clone", () => {
  test.use({
    seed: {
      async into(sandbox) {
        // claude-libra, well used: skill links and an own skill, a plugins link, and what a clone leaves behind.
        const libra = join(sandbox.workspace, "Agents", SOURCE);
        await mkdir(join(libra, "skills", "own-notes"), { recursive: true });
        await writeFile(join(libra, "skills", "own-notes", "SKILL.md"), "---\nname: own-notes\n---\n");
        await symlink("../../_shared/skills/grill-me", join(libra, "skills", "grill-me"));
        await mkdir(join(sandbox.workspace, "Agents", "_shared", "plugins"), { recursive: true });
        await symlink("../_shared/plugins", join(libra, "plugins"));
        await mkdir(join(libra, "projects", "-fixture-workspace-Projects-beta", "memory"), { recursive: true });
        await writeFile(join(libra, "projects", "-fixture-workspace-Projects-beta", "memory", "MEMORY.md"), "# Memory\n");
        for (const folder of ["todos", "shell-snapshots", "statsig"]) await mkdir(join(libra, folder), { recursive: true });
        await writeFile(join(libra, "history.jsonl"), "{}\n");
        await writeFile(join(libra, ".credentials.json"), "{}\n");
      },
    },
    // The fake Pomade launches in a project folder its own files hold.
    pomadeSeed: { roster: launchable(NAME), files: { "Projects/beta/README.md": "" } },
  });

  test("Clone… starts the page from its source; Create copies only what a clone takes, opens its tab with the setup prompt; Needs login holds until its first session", async ({ page, openShell, pomade, sandbox, backend }) => {
    await rosterReady(pomade);
    await pomade.fake.callApi(ROSTER_UPDATE_PROFILE_METHOD, { agent: SOURCE, role: ROLE, tags: ["vault", "notes"] });
    // Beta lists claude-libra; Alpha offers every agent.
    pomade.fake.updateProject("beta", { visibleAgents: ["claude", SOURCE] });

    const tab = await openTab(page, openShell, pomade, agentRoute(SOURCE));
    await expect(tab.getByTestId("agent-name")).toHaveText(SOURCE);
    // An agent with sessions is logged in.
    await expect(tab.getByTestId("agent-chip-needs-login")).toHaveCount(0);
    await tab.getByTestId("agent-more").click();
    await tab.getByTestId("menu-item-clone").click();

    // The page, with the source set and its role, tags and projects; the name empty.
    await expect(tab.getByRole("heading", { name: `New agent — clone of ${SOURCE}` })).toBeVisible();
    await expect.poll(() => pomade.fake.appTabs.find((t) => t.projectId === "alpha")?.route).toBe(`roster/new?clone=${SOURCE}`);
    await expect(tab.getByTestId("new-agent-from-clone")).toHaveAttribute("aria-pressed", "true");
    await expect(tab.getByTestId("new-agent-clone-source")).toHaveText(SOURCE);
    await expect(tab.getByTestId("new-agent-clone-hint")).toHaveText(`Role, tags and projects are prefilled from ${SOURCE}; change them freely.`);
    await expect(tab.getByTestId("new-agent-name")).toHaveValue("");
    await expect(tab.getByTestId("new-agent-role")).toHaveValue(ROLE);
    await expect(tab.getByTestId("new-agent-tag-chip")).toHaveText(["vault", "notes"]);
    await expect(tab.getByTestId("new-agent-project-beta")).toHaveAttribute("aria-checked", "true");
    await expect(tab.getByTestId("new-agent-never-cloned")).toHaveText("Never copied: projects/, sessions, memory, history, caches, .claude.json.");

    // The source menu offers the folder agents only.
    await tab.getByTestId("new-agent-clone-source").click();
    await expect(tab.getByTestId("new-agent-clone-menu").getByRole("menuitemradio")).toHaveText([`${SOURCE}${ROLE}`]);
    await page.keyboard.press("Escape");

    await tab.getByTestId("new-agent-name").fill(NAME);
    await expect(tab.getByTestId("new-agent-name-message")).toHaveAttribute("data-state", "ok");
    await expect(tab.getByTestId("new-agent-create-will").locator("li")).toHaveText([
      `Copy from ${SOURCE}: CLAUDE.md, settings.json, its skill links, the plugins link`,
      "Link every missing shared skill from Agents/_shared/skills",
      `Write Apps/pomade-agents/agents/${NAME}/agent.yaml`,
      "Connect to Beta",
      `Append alias ${NAME}=… to ~/.zshrc and check it resolves`,
      `Open a ${NAME} tab in Beta`,
    ]);
    await tab.getByTestId("new-agent-create").click();
    await expect(tab.getByRole("heading", { name: `${NAME} created` })).toBeVisible({ timeout: 30_000 });
    await expect(tab.getByTestId("new-agent-step-folder")).toHaveText(`Copy ${SOURCE}’s CLAUDE.md, settings.json, skill links and plugins link`);
    for (const step of ["folder", "skills", "profile", "projects", "alias", "verify", "open"]) await expect(tab.getByTestId(`new-agent-step-${step}`)).toHaveAttribute("data-state", "done");

    // Only the allowed entries: identity, settings, the skill links (the missing shared one added), the plugins link.
    const libra = join(sandbox.workspace, "Agents", SOURCE);
    const folder = join(sandbox.workspace, "Agents", NAME);
    expect((await readdir(folder)).sort()).toEqual(["CLAUDE.md", "plugins", "settings.json", "skills"]);
    expect(await readFile(join(folder, "CLAUDE.md"), "utf8")).toBe(await readFile(join(libra, "CLAUDE.md"), "utf8"));
    expect(await readFile(join(folder, "settings.json"), "utf8")).toBe(await readFile(join(libra, "settings.json"), "utf8"));
    expect((await readdir(join(folder, "skills"))).sort()).toEqual(["grill-me", "second-opinion"]);
    expect(await readlink(join(folder, "skills", "grill-me"))).toBe("../../_shared/skills/grill-me");
    expect(await readlink(join(folder, "plugins"))).toBe("../_shared/plugins");
    expect(await readFile(join(sandbox.workspace, "Apps", "pomade-agents", "agents", NAME, "agent.yaml"), "utf8")).toContain(`role: ${ROLE}\ntags:\n  - vault\n  - notes\n`);

    // Its tab in Beta, the prompt to paste after /login, and Go to its tab.
    expect(pomade.fake.openedAgentTabs).toEqual([expect.objectContaining({ kind: "agent", agentId: NAME, projectId: "beta", mode: "normal" })]);
    await expect(tab.getByTestId("new-agent-done-text")).toHaveText(`Its tab is open in Beta. It starts logged out: run /login there, then paste this prompt so the creating-claude-agent skill writes its identity.`);
    await expect(tab.getByTestId("new-agent-setup-prompt")).toHaveText(PROMPT);
    await tab.getByTestId("new-agent-go-to-tab").click();
    await expect.poll(() => pomade.fake.focusedAgentTabs).toEqual([pomade.fake.openedAgentTabs[0]?.tabId]);
    // The tab closed meanwhile: Go to its tab opens another.
    pomade.fake.closeAgentTab(pomade.fake.openedAgentTabs[0]?.tabId ?? "");
    await tab.getByTestId("new-agent-go-to-tab").click();
    await expect.poll(() => pomade.fake.openedAgentTabs.length).toBe(2);
    expect(pomade.fake.openedAgentTabs[1]).toMatchObject({ agentId: NAME, projectId: "beta" });

    // Its page: Needs login, with the prompt to copy.
    await tab.getByTestId("new-agent-open-page").click();
    await expect(tab.getByTestId("agent-name")).toHaveText(NAME);
    await expect(tab.getByTestId("agent-chip-needs-login")).toHaveText("Needs login");
    await expect(tab.getByTestId("agent-needs-login")).toHaveText("Log in with /login in its tab, then paste the setup prompt. Copy setup prompt");
    await expect(tab.getByTestId("agent-needs-login-copy")).toHaveAttribute("title", PROMPT);
    await tab.getByTestId("agent-needs-login-copy").click();
    await expect(tab.getByTestId("agent-needs-login-copy")).toHaveText("Copied");

    // Its first session appears in its store: Needs login clears, no reload.
    const at = new Date().toISOString();
    const cwd = join(sandbox.workspace, "Projects", "beta");
    const transcript = join(folder, "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"), "0f1e2d3c-4b5a-4968-8776-655443322110.jsonl");
    await mkdir(join(transcript, ".."), { recursive: true });
    await writeFile(transcript, prompt(PROMPT, at, cwd) + answer({ model: "claude-opus-4-8", input: 1000, at, cwd }));
    await expect(tab.getByTestId("agent-chip-needs-login"), backend.output()).toHaveCount(0, { timeout: 15_000 });
    await expect(tab.getByTestId("agent-needs-login")).toHaveCount(0);
    expect(backend.running()).toBe(true);
  });
});

test.describe("on the Roster", () => {
  test.use({ pomadeSeed: { roster: launchable("claude-fresh") } });

  test("a card's ⋯ Clone… opens the form with the source set; a new agent's card and row show Needs login with the prompt until its first session", async ({ page, openShell, pomade, sandbox, backend }) => {
    await rosterReady(pomade);
    const created = await pomade.fake.callApi(ROSTER_CREATE_METHOD, { name: "claude-fresh", role: "Tries things.", tags: ["lab"], projects: [], createId: "fresh" });
    expect(created).toMatchObject({ name: "claude-fresh" });
    const tab = await openTab(page, openShell, pomade, "roster");

    // The new agent: chip and notice on its card; claude-libra, which has sessions, has neither.
    const fresh = tab.getByTestId("agent-card-claude-fresh");
    await expect(fresh.getByTestId("chip-needs-login-claude-fresh")).toHaveText("Needs login");
    await expect(fresh.getByTestId("agent-needs-login-claude-fresh")).toHaveText("Log in with /login in its tab, then paste the setup prompt. Copy setup prompt");
    await expect(fresh.getByTestId("agent-needs-login-claude-fresh-copy")).toHaveAttribute("title", "Use the creating-claude-agent skill to set up claude-fresh: role “Tries things.”, tags lab.");
    await fresh.getByTestId("agent-needs-login-claude-fresh-copy").click();
    await expect(fresh.getByTestId("agent-needs-login-claude-fresh-copy")).toHaveText("Copied");
    await expect(tab.getByTestId(`chip-needs-login-${SOURCE}`)).toHaveCount(0);
    // The built-ins are never cloned.
    await tab.getByTestId("agent-more-claude").click();
    await expect(tab.getByTestId("agent-menu-claude").getByRole("menuitem")).toHaveText(["Open agent page", "Sessions", "Hide from the “+” menu", "Open CLAUDE.md", "Open agent.yaml"]);
    await page.keyboard.press("Escape");

    // The list row shows the chip too.
    await tab.getByTestId("roster-view-list").click();
    await expect(tab.getByTestId("chip-needs-login-claude-fresh")).toBeVisible();
    await tab.getByTestId("roster-view-cards").click();

    // Its first session appears: card chip and notice go, no reload.
    const at = new Date().toISOString();
    const cwd = join(sandbox.workspace, "Projects", "alpha");
    const transcript = join(sandbox.workspace, "Agents", "claude-fresh", "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"), "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d.jsonl");
    await mkdir(join(transcript, ".."), { recursive: true });
    await writeFile(transcript, prompt("hello", at, cwd) + answer({ model: "claude-opus-4-8", input: 1000, at, cwd }));
    await expect(fresh.getByTestId("chip-needs-login-claude-fresh"), backend.output()).toHaveCount(0, { timeout: 15_000 });
    await expect(fresh.getByTestId("agent-needs-login-claude-fresh")).toHaveCount(0);

    // ⋯ Clone… on claude-libra's card: the New agent page with it as the source.
    await tab.getByTestId(`agent-more-${SOURCE}`).click();
    await tab.getByTestId(`agent-menu-${SOURCE}`).getByTestId("menu-item-clone").click();
    await expect(tab.getByRole("heading", { name: `New agent — clone of ${SOURCE}` })).toBeVisible();
    await expect.poll(() => pomade.fake.appTabs.find((t) => t.projectId === "alpha")?.route).toBe(`roster/new?clone=${SOURCE}`);
    await expect(tab.getByTestId("new-agent-clone-source")).toHaveText(SOURCE);
    await expect(tab.getByTestId("new-agent-name")).toHaveValue("");
    expect(backend.running()).toBe(true);
  });
});
