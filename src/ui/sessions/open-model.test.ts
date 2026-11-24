import { HostError } from "pomade-kit/sdk";
import { describe, expect, it } from "vitest";

import type { Session } from "../../shared/sessions.ts";
import { testSession, testSummary } from "../../shared/test-sessions.ts";
import { notOpenedText, openHint, openKind, openedText } from "./open-model.ts";

const NAMES = new Map([["alpha", "Alpha"]]);

const session = (patch: Partial<Session> = {}): Session =>
  testSession({
    summary: testSummary({ firstMessage: { text: "Fix the flaky spec", at: null } }),
    record: { id: "s1", provider: "claude-code", agent: "claude", status: "done" },
    attribution: { projects: ["alpha"], by: "folder", sharedFolder: false },
    ...patch,
  });

describe("Open / Resume", () => {
  it("opens the bound tab, a run's terminal, or resumes", () => {
    expect(openKind(session({ tab: { tabId: "t", projectId: "alpha" }, live: "idle" }))).toBe("tab");
    // A restored tab not revived yet runs nothing, and is still the session's tab.
    expect(openKind(session({ tab: { tabId: "t", projectId: "alpha" } }))).toBe("tab");
    expect(openKind(session({ live: "working" }))).toBe("run");
    expect(openKind(session())).toBe("resumed");
  });

  it("hints that a resume sets the status back to Active, only where it will", () => {
    expect(openHint(session())).toBe("Resume sets the status back to Active.");
    expect(openHint(session({ record: { id: "s1", provider: "claude-code", agent: "claude", status: "active" } }))).toBeNull();
    expect(openHint(session({ tab: { tabId: "t", projectId: "alpha" } }))).toBeNull();
    expect(openHint(session({ hidden: "empty" }))).toBe("It holds no messages, so there is nothing to resume.");
  });

  it("says what was done", () => {
    const before = session();
    const active = session({ record: { id: "s1", provider: "claude-code", agent: "claude", status: "active" } });
    expect(openedText(before, { opened: "resumed", tabId: "t", session: active }, NAMES)).toBe("Resumed in a new agent tab in Alpha · status set to Active");
    expect(openedText(active, { opened: "resumed", tabId: "t", session: active }, NAMES)).toBe("Resumed in a new agent tab in Alpha");
    const workspace = session({ attribution: { projects: [], by: "workspace", sharedFolder: false } });
    expect(openedText(workspace, { opened: "resumed", tabId: "t", session: workspace }, NAMES)).toBe("Resumed in a new agent tab in the Workspace");
    expect(openedText(active, { opened: "tab", tabId: "t", session: active }, NAMES)).toBe("Focused the open tab “Fix the flaky spec”");
    const run = session({ record: { id: "s1", provider: "claude-code", agent: "claude", status: "active", startedByRunner: { job: "Nightly" } } });
    expect(openedText(run, { opened: "run", tabId: null, session: run }, NAMES)).toBe("Opened the terminal of the run “Nightly”");
  });

  it("says why nothing was done: the backend's words, or plain ones when it did not answer", () => {
    expect(notOpenedText(new HostError("not-found", "Its agent “x” is not in the roster."))).toEqual({
      text: "The session was not opened. Its agent “x” is not in the roster.",
      reason: "Its agent “x” is not in the roster.",
    });
    expect(notOpenedText(new HostError("not-found", "Pomade did not find it in its agent's store — No session \"x\" of \"claude\""))).toEqual({
      text: "The session was not opened. Pomade did not find it in its agent's store.",
      reason: "Pomade did not find it in its agent's store — No session \"x\" of \"claude\"",
    });
    expect(notOpenedText(new HostError("app-not-responding", "timeout after 10000 ms")).text).toBe("The session was not opened. The app's backend did not answer in time.");
    expect(notOpenedText(new Error("boom")).text).toBe("The session was not opened. Something went wrong.");
  });
});
