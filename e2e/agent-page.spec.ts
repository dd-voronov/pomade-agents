// An agent's page through the built app and backend in the fake Pomade (DESIGN §3.4): the folder
// agent's page shows each tab from its folder's files and the tab survives a reload; role and tags
// are edited in place into `agent.yaml` without moving anything around them; Open CLAUDE.md /
// agent.yaml / settings.json / a memory file reach Pomade's editor; Open in Sessions opens the
// Workspace's Sessions tab with the agent as its filter; the header's controls stay inside it at
// every width.

import { mkdirSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Locator, Page } from "@playwright/test";

import type { Sandbox } from "../harness/sandbox.ts";
import { ROSTER_AGENTS_METHOD, claudeFolderName, isRosterAgentsAnswer } from "../src/shared/roster.ts";
import { agentRoute, type AgentTab } from "../src/ui/core/routes.ts";
import { expect, test, type Shell } from "./fixtures.ts";
import { answer, projectFolder, prompt, seedIntoProject } from "./transcripts.ts";

const ARTIFACTS = fileURLToPath(new URL("./artifacts", import.meta.url));
mkdirSync(ARTIFACTS, { recursive: true });

const LIBRA = "claude-libra";
const ROLE = "A meticulous librarian for the fixture workspace.";
const LIBRA_DIR = (sandbox: Sandbox): string => join(sandbox.workspace, "Agents", LIBRA);
const profileOf = (sandbox: Sandbox, id: string): string => join(sandbox.workspace, "Apps", "pomade-agents", "agents", id, "agent.yaml");
/** The memory folder name Claude Code gives a path. */
const memoryDir = (sandbox: Sandbox, folder: string): string => join(LIBRA_DIR(sandbox), "projects", claudeFolderName(folder), "memory");

const ALPHA_SESSION = "7a7a7a7a-0000-4000-8000-000000000001";
const BETA_SESSION = "7a7a7a7a-0000-4000-8000-000000000002";
const OTHER_AGENT_SESSION = "7a7a7a7a-0000-4000-8000-000000000003";

/** The folder agent's sessions in two projects, another agent's session, and its memory of Alpha and of a folder the workspace holds no project for. */
async function seedPage(sandbox: Sandbox): Promise<void> {
  await seedIntoProject(sandbox, "alpha");
  const session = async (store: string, id: string, folder: string, text: string, at: string): Promise<void> => {
    const path = join(store, "projects", "-e2e", `${id}.jsonl`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, prompt(text, at, folder) + answer({ model: "claude-opus-5-5", input: 50_000, at, cwd: folder }));
  };
  await session(LIBRA_DIR(sandbox), ALPHA_SESSION, projectFolder(sandbox, "alpha"), "File the inbox for Alpha", "2026-11-20T09:00:00.000Z");
  await session(LIBRA_DIR(sandbox), BETA_SESSION, projectFolder(sandbox, "beta"), "Tidy Beta's wiki links", new Date().toISOString());
  await session(join(sandbox.home, ".claude"), OTHER_AGENT_SESSION, projectFolder(sandbox, "alpha"), "Another agent's question", "2026-11-22T09:00:00.000Z");
  const alpha = memoryDir(sandbox, projectFolder(sandbox, "alpha"));
  await mkdir(alpha, { recursive: true });
  await writeFile(join(alpha, "MEMORY.md"), "# Alpha\n");
  await writeFile(join(alpha, "owner-calls.md"), "# Calls\n");
  await writeFile(join(alpha, "notes.txt"), "not Markdown\n");
  const elsewhere = memoryDir(sandbox, "/somewhere/else");
  await mkdir(elsewhere, { recursive: true });
  await writeFile(join(elsewhere, "MEMORY.md"), "# Elsewhere\n");
}

test.use({ seed: { into: seedPage }, viewport: { width: 1280, height: 800 } });

// Every test runs with the backend: the page reads the roster, the configs and the sessions from it.
test.beforeEach(({ backend }) => {
  expect(backend.running()).toBe(true);
});

/** Open the app's tab in Alpha at the agent's page and wait for the roster. */
async function openPage(page: Page, openShell: (page: Page) => Promise<Shell>, pomade: { fake: { openAppTab: (open: { projectId: string; route: string }) => unknown } }, agent: string, tab: AgentTab): Promise<Locator> {
  const { tabFrame } = await openShell(page);
  pomade.fake.openAppTab({ projectId: "alpha", route: agentRoute(agent, tab) });
  const frame = tabFrame("alpha");
  await expect(frame.getByTestId("agent-name")).toHaveText(agent);
  return frame.locator("html");
}

const frameOf = (page: Page) => page.frameLocator('[data-testid="tab-frame-alpha"]');
const tabRoute = (pomade: { fake: { appTabs: { projectId: string; route: string }[] } }): string | undefined => pomade.fake.appTabs.find((t) => t.projectId === "alpha")?.route;

test("the folder agent's page shows each tab from its folder's files, and a reload stays on the tab", async ({ page, openShell, pomade, backend }) => {
  await openPage(page, openShell, pomade, LIBRA, "overview");
  const frame = frameOf(page);
  const body = frame.getByTestId("agent-body");

  await expect(frame.getByTestId("agent-sub")).toHaveText("Claude Code·provider default·launches with claude-libra");
  await expect(frame.getByTestId("agent-role-text")).toHaveText(ROLE);
  await expect(frame.getByTestId("fact-provider")).toHaveText("Claude Code · folder agent");
  await expect(frame.getByTestId("fact-command")).toHaveText("claude-libraits shell alias");
  await expect(frame.getByTestId("fact-config-dir")).toHaveText("Agents/claude-libra");
  await expect(frame.getByTestId("fact-profile")).toHaveText("Apps/pomade-agents/agents/claude-libra/agent.yaml");
  // Its one session this week (Beta's, just now); the older ones are last week's.
  await expect(frame.getByTestId("agent-last-active")).toHaveText(/^(now|\dm)$/);
  await expect(frame.getByTestId("agent-this-week")).toHaveText(/^1 session · ~\$\d+\.\d\d$/);

  await frame.getByTestId("agent-tab-permissions").click();
  await expect.poll(() => tabRoute(pomade), { message: backend.output() }).toBe("roster/claude-libra/permissions");
  await expect(frame.getByTestId("perm-mode")).toHaveText("acceptEdits");
  await expect(frame.getByTestId("perm-allow").locator("code")).toHaveText(["Edit(Knowledge/**)", "Bash(git -C Knowledge:*)"]);
  await expect(frame.getByTestId("perm-deny").locator("code")).toHaveText(["Bash(rm -rf:*)", "Edit(Knowledge/01-Raw/**)"]);
  await expect(frame.getByTestId("perm-mcp")).toHaveText("excalidrawstdio");
  await expect(frame.getByTestId("perm-plugins")).toHaveText("easel@marketplace");
  await expect(frame.getByTestId("open-settings")).toHaveText("Open settings.json");

  await frame.getByTestId("agent-tab-memory").click();
  await expect(frame.getByTestId("memory-row")).toHaveCount(2);
  await expect(frame.getByTestId("memory-row").first().getByTestId("memory-file")).toHaveText(["MEMORY.md", "owner-calls.md"]);
  await expect(frame.getByTestId("memory-row").first()).toContainText("Alpha");
  await expect(frame.getByTestId("memory-row").nth(1)).toContainText("-somewhere-else");

  await frame.getByTestId("agent-tab-sessions").click();
  await expect(frame.getByTestId("agent-session-row")).toHaveCount(3);
  await expect(frame.getByTestId("agent-session-name")).toHaveText(["Tidy Beta's wiki links", "File the inbox for Alpha", /./]);
  await expect(body.locator(`[data-session-id="${OTHER_AGENT_SESSION}"]`)).toHaveCount(0);

  // A reload of the frame opens at the route the tab last recorded: the Sessions tab.
  await page.locator('[data-testid="tab-frame-alpha"]').evaluate((el: HTMLIFrameElement) => {
    el.src = el.src;
  });
  await expect(frame.getByTestId("agent-page")).toHaveAttribute("data-tab", "sessions");
  await expect(frame.getByTestId("agent-session-row")).toHaveCount(3);

  // ← Roster returns to the Roster.
  await frame.getByTestId("agent-back").click();
  await expect(frame.getByTestId("roster")).toBeVisible();
  await expect.poll(() => tabRoute(pomade)).toBe("roster");
  expect(backend.running()).toBe(true);
});

test("the Sessions tab filters by project, and Open in Sessions opens the Workspace's Sessions tab on the agent and the project", async ({ page, openShell, pomade }) => {
  await openPage(page, openShell, pomade, LIBRA, "sessions");
  const frame = frameOf(page);
  await expect(frame.getByTestId("agent-session-row")).toHaveCount(3);

  await frame.getByTestId("project-filter").click();
  await expect(frame.getByTestId("project-menu")).toBeVisible();
  await frame.getByTestId("menu-item-project-alpha").click();
  await expect(frame.getByTestId("project-filter")).toContainText("Alpha");
  await expect(frame.getByTestId("agent-session-row")).toHaveCount(2);
  await expect(frame.getByTestId("agent-session-name").first()).toHaveText("File the inbox for Alpha");
  await frame.getByTestId("project-filter-clear").click();
  await expect(frame.getByTestId("agent-session-row")).toHaveCount(3);

  await frame.getByTestId("project-filter").click();
  await frame.getByTestId("menu-item-project-beta").click();
  await expect(frame.getByTestId("agent-session-row")).toHaveCount(1);
  const before = pomade.fake.openedTabs.length;
  await frame.getByTestId("open-in-sessions").click();
  await expect.poll(() => pomade.fake.openedTabs.length).toBe(before + 1);
  expect(pomade.fake.openedTabs.at(-1)).toEqual({ kind: "app", projectId: "__workspace__", route: "sessions?agent=claude-libra&project=beta" });
  const workspace = page.frameLocator('[data-testid="tab-frame-__workspace__"]');
  await expect(workspace.getByTestId("view-sessions")).toHaveAttribute("aria-current", "page");
  await expect(workspace.getByTestId("session-row")).toHaveCount(1);
  await expect(workspace.getByTestId("session-name")).toHaveText("Tidy Beta's wiki links");
});

test("Open in Sessions with no project names only the agent", async ({ page, openShell, pomade }) => {
  await openPage(page, openShell, pomade, LIBRA, "sessions");
  const frame = frameOf(page);
  await frame.getByTestId("open-in-sessions").click();
  await expect.poll(() => pomade.fake.openedTabs.at(-1)).toEqual({ kind: "app", projectId: "__workspace__", route: "sessions?agent=claude-libra" });
  const workspace = page.frameLocator('[data-testid="tab-frame-__workspace__"]');
  await expect(workspace.getByTestId("session-row")).toHaveCount(3);
});

test("role and tags are edited in place into agent.yaml, and hovering or editing never moves anything", async ({ page, openShell, pomade, sandbox, backend }) => {
  await openPage(page, openShell, pomade, LIBRA, "overview");
  const frame = frameOf(page);
  const role = frame.getByTestId("agent-role");
  const tags = frame.getByTestId("agent-tags");
  const facts = frame.getByTestId("agent-facts");
  await expect(frame.getByTestId("agent-role-text")).toHaveText(ROLE);
  await expect(tags.getByTestId("agent-tags-add")).toBeVisible();

  const layout = async () => ({ role: await role.boundingBox(), tags: await tags.boundingBox(), facts: await facts.boundingBox() });
  const resting = await layout();
  // The pencil and the × have their room at rest: they are laid out, only their colour or opacity appears on hover.
  await expect(role.locator("svg")).toBeVisible();
  await expect(tags.getByTestId("agent-tags-remove")).toHaveCount(0);

  // Hovering the role and the add button, and opening the field, change no box.
  await role.hover();
  expect(await layout()).toEqual(resting);
  await frame.getByTestId("agent-role-text").click();
  const field = frame.getByTestId("agent-role-field");
  await expect(field).toBeFocused();
  expect(await layout()).toEqual(resting);
  await field.press("Escape");
  await expect(field).toHaveCount(0);
  await expect(frame.getByTestId("agent-role-text")).toHaveText(ROLE);
  expect(await readFile(profileOf(sandbox, LIBRA), "utf8")).toContain(`role: ${ROLE}`);

  // Enter saves; the file has the new line and the other keys as they were.
  await frame.getByTestId("agent-role-text").click();
  await field.fill("Files the vault's inbox.");
  await field.press("Enter");
  await expect(frame.getByTestId("agent-role-text")).toHaveText("Files the vault's inbox.");
  await expect(frame.getByTestId("toast-text")).toHaveText("Role line saved to agent.yaml.");
  await expect.poll(() => readFile(profileOf(sandbox, LIBRA), "utf8"), { message: backend.output() }).toContain("role: Files the vault's inbox.\n");
  expect(await readFile(profileOf(sandbox, LIBRA), "utf8")).toBe(
    "id: claude-libra\nprovider: claude\nkind: folder\nconfigDir: Agents/claude-libra\ncommand: claude-libra\nrole: Files the vault's inbox.\ntags: []\nhidden: false\nmodes:\n  normal:\n    enabled: true\n  full-autonomy:\n    enabled: true\n",
  );

  // Leaving the field saves too; an emptied one removes the role.
  await frame.getByTestId("agent-role-text").click();
  await field.fill("");
  await frame.getByTestId("agent-tab-overview").click();
  await expect(frame.getByTestId("agent-role-text")).toHaveText("No role line");
  await expect.poll(() => readFile(profileOf(sandbox, LIBRA), "utf8")).not.toContain("role:");

  // Tags: add two with Enter and a comma, remove one; the add button stays where it was.
  const add = tags.getByTestId("agent-tags-add");
  const addBox = await add.boundingBox();
  await add.click();
  const tagField = tags.getByTestId("agent-tags-field");
  expect(await tagField.boundingBox()).toEqual(addBox);
  await tagField.fill("Vault");
  await tagField.press("Enter");
  await tagField.fill("ops,");
  await expect(tags.getByTestId("agent-tags-tag")).toHaveText(["vault", "ops"]);
  await tagField.press("Escape");
  await expect(tagField).toHaveCount(0);
  await expect.poll(() => readFile(profileOf(sandbox, LIBRA), "utf8")).toMatch(/tags:\n {2}- vault\n {2}- ops\n/);
  // The roster has read both saves back: no answer still on its way can show the first one alone.
  await expect
    .poll(async () => {
      const roster = await pomade.fake.callApi(ROSTER_AGENTS_METHOD).catch(() => null);
      return isRosterAgentsAnswer(roster) ? roster.agents.find((a) => a.id === LIBRA)?.profile?.tags : null;
    })
    .toEqual(["vault", "ops"]);
  await expect(tags.getByTestId("agent-tags-tag")).toHaveText(["vault", "ops"]);

  const firstTag = tags.getByTestId("agent-tags-tag").first();
  await expect(firstTag.getByTestId("agent-tags-remove")).toBeVisible();
  const tagBoxes = async () => Promise.all((await tags.getByTestId("agent-tags-tag").all()).map((t) => t.boundingBox()));
  const before = await tagBoxes();
  await firstTag.hover();
  expect(await tagBoxes()).toEqual(before);
  await firstTag.getByTestId("agent-tags-remove").click();
  await expect(tags.getByTestId("agent-tags-tag")).toHaveText(["ops"]);
  await expect.poll(() => readFile(profileOf(sandbox, LIBRA), "utf8")).toMatch(/tags:\n {2}- ops\n/);
  // The roster follows the file: a reload shows the same.
  await page.locator('[data-testid="tab-frame-alpha"]').evaluate((el: HTMLIFrameElement) => {
    el.src = el.src;
  });
  await expect(tags.getByTestId("agent-tags-tag")).toHaveText(["ops"]);
});

test("an agent.yaml the app cannot use is reported, its role and tags are not editable, and the file is never written over", async ({ page, openShell, pomade, sandbox }) => {
  const file = profileOf(sandbox, LIBRA);
  await expect.poll(() => readFile(file, "utf8").catch(() => "")).toContain("role:");
  const broken = "id: [\n";
  await writeFile(file, broken);
  await openPage(page, openShell, pomade, LIBRA, "overview");
  const frame = frameOf(page);
  await expect(frame.getByTestId("agent-chip-problem")).toHaveText("agent.yaml can’t be read");
  await expect(frame.getByTestId("agent-problem-notice")).toContainText("never written over");
  await expect(frame.getByTestId("agent-role-text")).toBeDisabled();
  await expect(frame.getByTestId("agent-tags-add")).toHaveCount(0);
  await expect(frame.getByTestId("fact-command")).toHaveText("—");
  expect(await readFile(file, "utf8")).toBe(broken);
});

test("a hidden agent and an orphan are marked on their pages; an orphan has no Start session and nothing to edit", async ({ page, openShell, pomade, sandbox }) => {
  const file = profileOf(sandbox, LIBRA);
  await expect.poll(() => readFile(file, "utf8").catch(() => "")).toContain("hidden: false");
  await writeFile(file, (await readFile(file, "utf8")).replace("hidden: false", "hidden: true"));
  await openPage(page, openShell, pomade, LIBRA, "overview");
  const frame = frameOf(page);
  await expect(frame.getByTestId("agent-chip-hidden")).toHaveText("hidden");
  await frame.getByTestId("agent-more").click();
  await expect(frame.getByTestId("menu-item-hide")).toHaveText("Show in the “+” menu");
  await page.keyboard.press("Escape");

  await rename(LIBRA_DIR(sandbox), `${LIBRA_DIR(sandbox)}-renamed`);
  await expect(frame.getByTestId("agent-chip-orphan")).toHaveText("orphan");
  await expect(frame.getByTestId("agent-orphan-notice")).toContainText("Agents/claude-libra");
  await expect(frame.getByTestId("agent-start-session")).toHaveCount(0);
  await expect(frame.getByTestId("agent-role-text")).toBeDisabled();
  await expect(frame.getByTestId("agent-tags-add")).toHaveCount(0);
  await expect(frame.getByTestId("agent-chip-hidden")).toBeVisible();
});

test("Open CLAUDE.md, agent.yaml, settings.json and a memory file open in Pomade's editor; a file outside the workspace is refused with a toast", async ({ page, openShell, pomade, sandbox }) => {
  const alphaMemory = join(memoryDir(sandbox, projectFolder(sandbox, "alpha")), "owner-calls.md");
  const relative = (path: string): string => path.slice(sandbox.workspace.length + 1);
  for (const path of [join(LIBRA_DIR(sandbox), "CLAUDE.md"), join(LIBRA_DIR(sandbox), "settings.json"), profileOf(sandbox, LIBRA), alphaMemory]) pomade.fake.writeFile(relative(path), "text\n");
  await openPage(page, openShell, pomade, LIBRA, "overview");
  const frame = frameOf(page);
  const opened = (): unknown[] => pomade.fake.openedTabs.filter((t) => t.kind === "file");

  await frame.getByTestId("open-claude-md").click();
  await expect.poll(opened).toEqual([{ kind: "file", projectId: "alpha", path: "Agents/claude-libra/CLAUDE.md" }]);
  await frame.getByTestId("open-agent-yaml").click();
  await expect.poll(opened).toHaveLength(2);
  expect(opened()[1]).toEqual({ kind: "file", projectId: "alpha", path: "Apps/pomade-agents/agents/claude-libra/agent.yaml" });

  await frame.getByTestId("agent-more").click();
  await frame.getByTestId("menu-item-open-claude-md").click();
  await frame.getByTestId("agent-more").click();
  await frame.getByTestId("menu-item-open-agent-yaml").click();
  await expect.poll(opened).toHaveLength(4);

  await frame.getByTestId("agent-tab-permissions").click();
  await frame.getByTestId("open-settings").click();
  await expect.poll(opened).toHaveLength(5);
  expect(opened()[4]).toMatchObject({ path: "Agents/claude-libra/settings.json" });

  await frame.getByTestId("agent-tab-memory").click();
  await frame.getByTestId("memory-file").nth(1).click();
  await expect.poll(opened).toHaveLength(6);
  expect(opened()[5]).toMatchObject({ path: relative(alphaMemory) });

  // The built-in's files lie in the home folder, outside the workspace: Pomade refuses, the page says so.
  await frame.getByTestId("agent-back").click();
  pomade.fake.openAppTab({ projectId: "alpha", route: agentRoute("claude", "overview") });
  await expect(frame.getByTestId("agent-name")).toHaveText("claude");
  await frame.getByTestId("open-claude-md").click();
  await expect(frame.getByTestId("toast-text")).toHaveText("CLAUDE.md was not opened. Pomade does not let the app open files there.");
  expect(opened()).toHaveLength(6);
});

test("Start session and Hide show in their places, disabled, Clone… is there for a folder agent only; the page has no Start session for an orphan", async ({ page, openShell, pomade }) => {
  await openPage(page, openShell, pomade, LIBRA, "overview");
  const frame = frameOf(page);
  await expect(frame.getByTestId("agent-start-session")).toBeDisabled();
  await frame.getByTestId("agent-more").click();
  await expect(frame.getByTestId("menu-item-clone")).toBeEnabled();
  await expect(frame.getByTestId("menu-item-hide")).toHaveText("Hide from the “+” menu");
  await expect(frame.getByTestId("menu-item-hide")).toBeDisabled();
  await expect(frame.getByTestId("menu-item-open-claude-md")).toBeEnabled();
  await expect(frame.getByTestId("menu-item-open-agent-yaml")).toBeEnabled();
  await page.keyboard.press("Escape");

  // The built-ins cannot be cloned.
  await frame.getByTestId("agent-back").click();
  pomade.fake.openAppTab({ projectId: "alpha", route: agentRoute("claude", "overview") });
  await expect(frame.getByTestId("agent-name")).toHaveText("claude");
  await expect(frame.getByTestId("agent-chip-builtin")).toHaveText("built-in");
  await frame.getByTestId("agent-more").click();
  await expect(frame.getByTestId("menu-item-clone")).toHaveCount(0);
});

test("the built-ins: Claude's permissions come from its settings.json and the home .claude.json, Codex's from config.toml, and Codex has no CLAUDE.md or memory", async ({ page, openShell, pomade }) => {
  await openPage(page, openShell, pomade, "claude", "permissions");
  const frame = frameOf(page);
  await expect(frame.getByTestId("agent-sub")).toHaveText("Claude Code·opus high·launches with claude");
  await expect(frame.getByTestId("perm-allow").locator("code")).toHaveText(["Bash(git status:*)"]);
  await expect(frame.getByTestId("perm-mcp")).toHaveText("claude-in-chromestdiodocshttp");
  await expect(frame.getByTestId("perm-plugins")).toHaveText("none");

  await frame.getByTestId("agent-back").click();
  pomade.fake.openAppTab({ projectId: "alpha", route: agentRoute("codex", "permissions") });
  await expect(frame.getByTestId("agent-name")).toHaveText("codex");
  await expect(frame.getByTestId("agent-sub")).toHaveText("Codex·gpt-5.2-codex medium·launches with codex");
  await expect(frame.getByTestId("permissions-facts")).toContainText("Approvals");
  await expect(frame.getByTestId("perm-mode")).toHaveText("on-request");
  await expect(frame.getByTestId("perm-sandbox")).toHaveText("workspace-write");
  await expect(frame.getByTestId("perm-mcp")).toHaveText("context7stdio");
  await expect(frame.getByTestId("open-settings")).toHaveText("Open config.toml");
  await frame.getByTestId("agent-tab-overview").click();
  await expect(frame.getByTestId("fact-identity")).toHaveText("Codex has no CLAUDE.md");
  // Its one session is from mid-November: no week, but a last activity.
  await expect(frame.getByTestId("agent-this-week")).toHaveText("no sessions");
  await expect(frame.getByTestId("agent-last-active")).toHaveText(/^[A-Z][a-z]{2} \d+$|^\d+d$|^yesterday$/);
  await frame.getByTestId("agent-tab-memory").click();
  await expect(frame.getByTestId("memory-empty")).toBeVisible();
});

test("a route names an agent the roster does not hold, or no tab: the page says so, or opens Overview", async ({ page, openShell, pomade }) => {
  const { tabFrame } = await openShell(page);
  pomade.fake.openAppTab({ projectId: "alpha", route: "roster/ghost/memory" });
  const frame = tabFrame("alpha");
  await expect(frame.getByTestId("agent-missing")).toContainText("no agent called “ghost”");
  await frame.getByTestId("agent-missing-back").click();
  await expect(frame.getByTestId("roster")).toBeVisible();
  await expect.poll(() => tabRoute(pomade)).toBe("roster");

  pomade.fake.openAppTab({ projectId: "alpha", route: `roster/${LIBRA}` });
  await expect(frame.getByTestId("agent-page")).toHaveAttribute("data-tab", "overview");
  for (const [tab, title] of [["projects", "Projects"]] as const) {
    await frame.getByTestId(`agent-tab-${tab}`).click();
    await expect(frame.getByTestId(`agent-${tab}`)).toContainText(title);
    await expect(frame.getByTestId(`agent-${tab}`)).toContainText("not built yet");
  }
});

/** Every box of the header sits inside its row, and nothing makes the page scroll sideways. */
async function expectContained(page: Page, note: string): Promise<void> {
  const frame = frameOf(page);
  const header = await frame.getByTestId("agent-header").boundingBox();
  if (header === null) throw new Error("no header");
  for (const id of ["agent-back", "agent-name", "agent-start-session", "agent-more"]) {
    const box = await frame.getByTestId(id).boundingBox();
    expect(box, `${id} (${note})`).not.toBeNull();
    if (box === null) continue;
    expect(box.x, `${id} left (${note})`).toBeGreaterThanOrEqual(header.x);
    expect(box.x + box.width, `${id} right (${note})`).toBeLessThanOrEqual(header.x + header.width + 0.5);
  }
  const overflow = await frame.locator("html").evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow, `sideways scroll (${note})`).toBeLessThanOrEqual(0);
  const body = await frame.getByTestId("agent-body").evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(body, `body sideways scroll (${note})`).toBeLessThanOrEqual(0);
}

test("at every width the header's controls stay inside it and no tab scrolls sideways; screenshots of every surface", async ({ page, openShell, pomade }) => {
  pomade.fake.writeFile("Agents/claude-libra/CLAUDE.md", "# libra\n");
  await pomade.fake.callApi("roster.updateProfile", {
    agent: LIBRA,
    role: "A meticulous librarian for the fixture workspace: files the inbox, keeps links, indexes and names in order, and tells the owner what it changed.",
    tags: ["knowledge", "vault", "wiki", "a-rather-long-tag-name"],
  });
  await openPage(page, openShell, pomade, LIBRA, "overview");
  const frame = frameOf(page);
  const sizes = [
    ["wide", 1440],
    ["medium", 1000],
    ["narrow", 760],
    ["tiny", 600],
  ] as const;
  const tabs: AgentTab[] = ["overview", "skills", "projects", "model", "permissions", "memory", "sessions"];
  for (const [name, width] of sizes) {
    await page.setViewportSize({ width, height: 800 });
    for (const tab of tabs) {
      await frame.getByTestId(`agent-tab-${tab}`).click();
      await expect(frame.getByTestId("agent-page")).toHaveAttribute("data-tab", tab);
      await expect(frame.getByTestId("agent-body")).toBeVisible();
      await expectContained(page, `${tab} at ${name}`);
      await page.screenshot({ path: `${ARTIFACTS}/agent-page-${tab}-${name}.png` });
    }
  }

  // Hover and edit states, at the narrow width.
  await page.setViewportSize({ width: 760, height: 800 });
  await frame.getByTestId("agent-tab-overview").click();
  await frame.getByTestId("agent-role").hover();
  await page.screenshot({ path: `${ARTIFACTS}/agent-page-role-hover-narrow.png` });
  await frame.getByTestId("agent-role-text").click();
  await page.screenshot({ path: `${ARTIFACTS}/agent-page-role-edit-narrow.png` });
  await frame.getByTestId("agent-role-field").press("Escape");
  await frame.getByTestId("agent-tags-add").click();
  await frame.getByTestId("agent-tags-field").fill("vault");
  await page.screenshot({ path: `${ARTIFACTS}/agent-page-tag-edit-narrow.png` });
  await frame.getByTestId("agent-tags-field").press("Enter");
  await frame.getByTestId("agent-tags-tag").first().hover();
  await page.screenshot({ path: `${ARTIFACTS}/agent-page-tag-hover-narrow.png` });
  await frame.getByTestId("agent-more").click();
  await page.screenshot({ path: `${ARTIFACTS}/agent-page-menu-narrow.png` });
  await page.keyboard.press("Escape");
});
