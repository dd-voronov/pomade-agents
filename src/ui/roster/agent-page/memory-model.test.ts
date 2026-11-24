import type { ProjectRef } from "pomade-kit/protocol";
import { describe, expect, it } from "vitest";

import { claudeFolderName } from "../../../shared/roster.ts";
import { folderLabels } from "./memory-model.ts";

const project = (id: string, name: string, root: string): ProjectRef => ({ id, kind: "project", name, root });

describe("claudeFolderName", () => {
  it("writes every character but letters and digits as a dash", () => {
    expect(claudeFolderName("/Users/me/git-base/Projects/pomade.app")).toBe("-Users-me-git-base-Projects-pomade-app");
    expect(claudeFolderName("/tmp/pa x/ünï")).toBe("-tmp-pa-x--n-");
  });
});

describe("folderLabels", () => {
  const projects = [project("p1", "Pomade", "Projects/Pomade"), project("p2", "Agents", "Projects/pomade-agents")];

  it("names the workspace and each project by its encoded folder, as Pomade names the workspace and resolved", () => {
    const labels = folderLabels(projects, { workspace: "/ws", workspaceReal: "/private/ws" });
    expect(labels.get("-ws")).toBe("Workspace");
    expect(labels.get("-ws-Projects-Pomade")).toBe("Pomade");
    expect(labels.get("-private-ws-Projects-pomade-agents")).toBe("Agents");
    expect(labels.get("-ws-Projects-other")).toBeUndefined();
  });

  it("names nothing without a workspace, and takes a project at the workspace root as the workspace", () => {
    expect(folderLabels(projects, { workspace: null, workspaceReal: null }).size).toBe(0);
    expect(folderLabels([project("w", "Root", "")], { workspace: "/ws", workspaceReal: "/ws" })).toEqual(new Map([["-ws", "Workspace"]]));
  });
});
