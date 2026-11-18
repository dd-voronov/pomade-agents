import { describe, expect, it } from "vitest";

import { attribute, isInside, projectsHolding, type AttributionInput, type ProjectPlace } from "./attribution.ts";

const W = "/ws";
const place = (id: string, root: string): ProjectPlace => ({ id, root, folder: root === "" ? W : `${W}/${root}` });

/** Sidebar order: pomade and its docs project, two projects sharing one root, a project at the workspace root. */
const PROJECTS = [place("pomade", "Projects/Pomade"), place("docs", "Projects/Pomade/docs"), place("a", "Projects/shared"), place("b", "Projects/shared")];

const input = (patch: Partial<AttributionInput>): AttributionInput => ({ cwd: `${W}/Projects/Pomade`, record: null, projects: PROJECTS, ...patch });

describe("project attribution", () => {
  it.each<[string, Partial<AttributionInput>, string[], string]>([
    ["the project whose root is the start folder", {}, ["pomade"], "folder"],
    ["the project holding a sub-folder", { cwd: `${W}/Projects/Pomade/src/ui` }, ["pomade"], "folder"],
    ["the deepest project holding the folder", { cwd: `${W}/Projects/Pomade/docs/roadmap` }, ["docs"], "folder"],
    ["no project holding a sibling with the same prefix", { cwd: `${W}/Projects/Pomade-old` }, [], "workspace"],
    ["the Workspace for a folder outside every project", { cwd: `${W}/Knowledge` }, [], "workspace"],
    ["the Workspace for a folder outside the workspace", { cwd: "/elsewhere" }, [], "workspace"],
    ["the Workspace for an unknown start folder", { cwd: null }, [], "workspace"],
    ["the launching tab's project over the folder", { record: { launchedFrom: "docs" } }, ["docs"], "launched"],
    ["the Workspace bucket when launched from a tab in the Workspace scope", { record: { launchedFrom: "__workspace__" } }, [], "launched"],
    ["the override over the launching tab", { record: { projectOverride: true, project: "a", launchedFrom: "docs" } }, ["a"], "override"],
    ["the Workspace when moved there", { record: { projectOverride: true } }, [], "override"],
    ["the folder when the override's project is gone", { record: { projectOverride: true, project: "gone" } }, ["pomade"], "folder"],
    ["the folder when the launching tab's project is gone", { record: { launchedFrom: "gone" } }, ["pomade"], "folder"],
    ["the folder over the project it was in before", { record: { project: "a" } }, ["pomade"], "folder"],
    ["the project it was in before when no root holds the folder (renamed)", { cwd: `${W}/Projects/OldName`, record: { project: "pomade" } }, ["pomade"], "remembered"],
    ["the Workspace when the project it was in is gone", { cwd: `${W}/Projects/OldName`, record: { project: "gone" } }, [], "workspace"],
  ])("gives %s", (_name, patch, projects, by) => {
    expect(attribute(input(patch))).toEqual({ projects, by, sharedFolder: false });
  });

  it("shows a session in every project sharing its folder's root, with the marker, in sidebar order", () => {
    expect(attribute(input({ cwd: `${W}/Projects/shared/src` }))).toEqual({ projects: ["a", "b"], by: "folder", sharedFolder: true });
    expect(attribute(input({ cwd: `${W}/Projects/shared`, projects: [...PROJECTS].reverse() }))).toEqual({ projects: ["b", "a"], by: "folder", sharedFolder: true });
  });

  it("shows a session launched from one of the projects sharing a root only in that one", () => {
    expect(attribute(input({ cwd: `${W}/Projects/shared`, record: { launchedFrom: "b" } }))).toEqual({ projects: ["b"], by: "launched", sharedFolder: false });
  });

  it("puts every folder of the workspace in a project at the workspace root, unless a deeper one holds it", () => {
    const projects = [place("root", ""), ...PROJECTS];
    expect(attribute(input({ cwd: `${W}/Knowledge`, projects })).projects).toEqual(["root"]);
    expect(attribute(input({ cwd: W, projects })).projects).toEqual(["root"]);
    expect(attribute(input({ projects })).projects).toEqual(["pomade"]);
  });

  it("keeps what the record says while Pomade's projects are not known", () => {
    expect(attribute(input({ projects: null }))).toEqual({ projects: [], by: "workspace", sharedFolder: false });
    expect(attribute(input({ projects: null, record: { project: "pomade" } }))).toEqual({ projects: ["pomade"], by: "remembered", sharedFolder: false });
    expect(attribute(input({ projects: null, record: { launchedFrom: "x" } }))).toEqual({ projects: ["x"], by: "launched", sharedFolder: false });
    expect(attribute(input({ projects: null, record: { projectOverride: true, project: "y" } }))).toEqual({ projects: ["y"], by: "override", sharedFolder: false });
  });

  it("keeps a session's project through a rename of the project and of its folder", () => {
    // The session was placed by its folder; then the project and its folder were renamed: the id stays,
    // the transcript still names the old folder.
    const before = attribute(input({ cwd: `${W}/Projects/Pomade/src` }));
    const renamed = [place("pomade", "Projects/Pomade2"), ...PROJECTS.slice(1)];
    expect(attribute(input({ cwd: `${W}/Projects/Pomade/src`, projects: renamed, record: { project: before.projects[0] ?? "" } }))).toEqual({
      projects: ["pomade"],
      by: "remembered",
      sharedFolder: false,
    });
  });

  it("matches folders by whole path segments", () => {
    expect(isInside("/ws/a", "/ws/a")).toBe(true);
    expect(isInside("/ws/a", "/ws/a/b")).toBe(true);
    expect(isInside("/ws/a", "/ws/ab")).toBe(false);
    expect(isInside("/", "/ws")).toBe(true);
    expect(projectsHolding("/ws/x", PROJECTS)).toEqual([]);
  });
});
