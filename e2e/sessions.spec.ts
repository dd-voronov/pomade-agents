// The session stores reach the UI: the backend indexes the sandbox's stores, the Workspace's
// Sessions tab counts what it indexed (the seeded sessions started outside the fixture projects),
// and a store that changes reaches the tab within ~2 s — through the backend's `sessions.changed`
// notice and a `sessions.list` delta, no polling.

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { SEEDED_TRANSCRIPTS } from "../harness/sandbox.ts";
import { SESSIONS_LIST_METHOD, isSessionsAnswer, type SessionsAnswer } from "../src/shared/sessions.ts";
import { expect, test } from "./fixtures.ts";
import { prompt } from "./transcripts.ts";

/** The ticket's bound: a grown or new transcript shows within ~2 s. */
const WITHIN_MS = 2000;
const CLAUDE_TRANSCRIPT = Object.keys(SEEDED_TRANSCRIPTS).find((path) => path.startsWith("home/.claude/")) ?? "";

test("the Workspace's Sessions tab counts every session the backend indexed, and a growing or new transcript reaches it within 2 s", async ({
  page,
  openShell,
  pomade,
  sandbox,
  backend,
}) => {
  pomade.fake.setActiveProject(null);
  const { panel, tabFrame } = await openShell(page);
  await panel.getByTestId("open-sessions").click();
  const count = tabFrame("__workspace__").getByTestId("sessions-count");
  await expect(count).toHaveAttribute("data-count", "3", { timeout: 10_000 });
  await expect(count).not.toHaveAttribute("data-indexing");
  const revision = Number(await count.getAttribute("data-revision"));

  // A transcript grows: the view's copy moves on, and the summary holds the new message.
  const transcript = join(sandbox.root, CLAUDE_TRANSCRIPT);
  const grown = Date.now();
  await appendFile(transcript, prompt("Add a growth test", "2026-11-17T12:00:00.000Z"));
  await expect.poll(async () => Number(await count.getAttribute("data-revision")), { timeout: WITHIN_MS }).toBeGreaterThan(revision);
  expect(Date.now() - grown).toBeLessThan(WITHIN_MS);
  const answer = (await pomade.fake.callApi(SESSIONS_LIST_METHOD)) as SessionsAnswer;
  expect(isSessionsAnswer(answer)).toBe(true);
  expect(answer.sessions.find((s) => s.summary.transcript === transcript)?.summary.lastMessage).toEqual({ text: "Add a growth test", at: "2026-11-17T12:00:00.000Z" });

  // A new session's transcript appears in a project folder the store did not have.
  const fresh = join(sandbox.home, ".claude", "projects", "-fixture-workspace-Projects-beta", "7a1d2e3f-4b5c-4d6e-8f70-81a2b3c4d5e6.jsonl");
  await mkdir(dirname(fresh), { recursive: true });
  const created = Date.now();
  await writeFile(fresh, prompt("A brand new session", "2026-11-17T12:01:00.000Z"));
  await expect(count).toHaveAttribute("data-count", "4", { timeout: WITHIN_MS });
  expect(Date.now() - created).toBeLessThan(WITHIN_MS);
  expect(backend.running()).toBe(true);
});

test("the Sessions tab says it is reading the stores while the backend does not answer", async ({ page, openShell }) => {
  const { panel, tabFrame } = await openShell(page);
  await panel.getByTestId("open-sessions").click();
  await expect(tabFrame("alpha").getByTestId("sessions-reading")).toContainText("Reading the session stores…");
  await expect(tabFrame("alpha").getByTestId("sessions-count")).toHaveCount(0);
});
