import { HostError } from "pomade-kit/sdk";
import { describe, expect, it } from "vitest";

import { connectionsOf, projectsFor, type ProjectReads } from "./connections.ts";

const VISIBLE: Record<string, string[]> = { alpha: ["*"], beta: ["codex", "quiet", "ghost"], gamma: [], delta: ["claude"] };
const reads = (visible: Record<string, string[]> = VISIBLE, gone: string[] = []): ProjectReads => ({
  projects: () => Promise.resolve(Object.keys(visible)),
  visibleAgents: (id) => (gone.includes(id) || visible[id] === undefined ? Promise.reject(new HostError("not-found", `No project ${id}`)) : Promise.resolve(visible[id])),
});

describe("every agent's connected projects at once", () => {
  it("lists, per agent, the projects whose setting offers it, in the Projects panel's order; `*` offers every agent", async () => {
    expect(await connectionsOf(["claude", "codex", "quiet", "none"], reads())).toEqual([
      { agent: "claude", projects: ["alpha", "delta"] },
      { agent: "codex", projects: ["alpha", "beta"] },
      { agent: "quiet", projects: ["alpha", "beta"] },
      { agent: "none", projects: ["alpha"] },
    ]);
  });

  it("answers what `projectsFor` does for an agent the roster lists", async () => {
    const [claude] = await connectionsOf(["claude"], reads());
    expect(claude?.projects).toEqual(await projectsFor("claude", ["claude"], reads()));
  });

  it("counts a project removed between the two reads as offering nothing", async () => {
    expect(await connectionsOf(["claude"], reads(VISIBLE, ["alpha"]))).toEqual([{ agent: "claude", projects: ["delta"] }]);
  });

  it("answers an empty list for no agent and for no project", async () => {
    expect(await connectionsOf([], reads())).toEqual([]);
    expect(await connectionsOf(["claude"], reads({}))).toEqual([{ agent: "claude", projects: [] }]);
  });
});
