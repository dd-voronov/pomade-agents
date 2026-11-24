import { WORKSPACE_PROJECT_ID } from "pomade-kit/protocol";
import { describe, expect, it } from "vitest";

import { testSession } from "../../shared/test-sessions.ts";
import { TOAST_NAME_MAX } from "./check-model.ts";
import { WORKSPACE_TARGET, currentTarget, inAgentTab, moveBack, moveTargets, movedToText, nameToSave, renamedText } from "./edit-model.ts";

const record = { id: "s1", provider: "claude-code", agent: "claude", status: "active" } as const;

describe("the name a rename saves", () => {
  it("is the typed text trimmed", () => {
    expect(nameToSave("  Port the bulk bar ", undefined)).toBe("Port the bulk bar");
    expect(nameToSave("New", "Old")).toBe("New");
  });
  it("is null for an empty or blank field — the session is unnamed again", () => {
    expect(nameToSave("", "Old")).toBeNull();
    expect(nameToSave("   ", "Old")).toBeNull();
  });
  it("is nothing when the name stays as it is", () => {
    expect(nameToSave("Old ", "Old")).toBeUndefined();
    expect(nameToSave("  ", undefined)).toBeUndefined();
  });
});

describe("the rename toast", () => {
  const live = testSession({ live: "working" });
  it("says the tab title follows only while an agent tab runs the session", () => {
    expect(renamedText(live, "Port the bulk bar")).toBe("Renamed — the tab title follows: “Port the bulk bar”");
    expect(renamedText(testSession(), "Port the bulk bar")).toBe("Renamed to “Port the bulk bar”");
  });
  it("leaves the tab out for a Runner run, which has no agent tab", () => {
    const run = testSession({ live: "working", record: { ...record, startedByRunner: { job: "nightly" } } });
    expect(inAgentTab(run)).toBe(false);
    expect(renamedText(run, "Nightly")).toBe("Renamed to “Nightly”");
  });
  it("counts Idle and Needs you as running in a tab", () => {
    expect(inAgentTab(testSession({ live: "idle" }))).toBe(true);
    expect(inAgentTab(testSession({ live: "needs-you" }))).toBe(true);
  });
  it("says the session is unnamed again for a removed name", () => {
    expect(renamedText(live, null)).toBe("Name removed — the session is unnamed again");
  });
  it("cuts a long name", () => {
    const text = renamedText(testSession(), "x".repeat(80));
    expect(text).toBe(`Renamed to “${"x".repeat(TOAST_NAME_MAX - 1)}…”`);
  });
});

describe("Move to project", () => {
  const projects = [
    { id: "alpha", name: "Alpha", root: "Projects/alpha" },
    { id: "beta", name: "Beta", root: "Projects/beta" },
  ];
  it("offers every project in order, then the Workspace", () => {
    expect(moveTargets(projects)).toEqual([
      { id: "alpha", name: "Alpha" },
      { id: "beta", name: "Beta" },
      { id: WORKSPACE_PROJECT_ID, name: WORKSPACE_TARGET },
    ]);
  });
  it("checks the one place the session shows in; none for a shared folder", () => {
    expect(currentTarget(testSession({ attribution: { projects: ["beta"], by: "folder", sharedFolder: false } }))).toBe("beta");
    expect(currentTarget(testSession())).toBe(WORKSPACE_PROJECT_ID);
    expect(currentTarget(testSession({ attribution: { projects: ["alpha", "twin"], by: "folder", sharedFolder: true } }))).toBeNull();
  });
  it("moves back to the user's earlier choice, else to the automatic project", () => {
    expect(moveBack({ ...record, project: "beta", projectOverride: true })).toBe("beta");
    expect(moveBack({ ...record, projectOverride: true })).toBe(WORKSPACE_PROJECT_ID);
    expect(moveBack({ ...record, project: "alpha" })).toBeNull();
    expect(moveBack(null)).toBeNull();
  });
  it("names the target in the toast", () => {
    expect(movedToText({ id: "beta", name: "Beta" })).toBe("Moved to Beta");
    expect(movedToText({ id: WORKSPACE_PROJECT_ID, name: WORKSPACE_TARGET })).toBe("Moved to the Workspace");
  });
});
