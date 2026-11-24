import { HostError, type HostClient } from "pomade-kit/sdk";
import { describe, expect, it } from "vitest";

import { connectAgent, disconnectAgent, offerFailure } from "./project-offers.ts";

/** A host whose projects hold `lists`; `writes` collects each `project.setAgents`. */
function host(lists: Record<string, string[]>, writes: { projectId: string; visibleAgents: string[] }[] = []): HostClient {
  return {
    project: {
      getAgents: ({ projectId }: { projectId: string }) => {
        const list = lists[projectId];
        return list === undefined ? Promise.reject(new HostError("not-found", `No project ${projectId}`)) : Promise.resolve({ visibleAgents: [...list] });
      },
      setAgents: (params: { projectId: string; visibleAgents: string[] }) => {
        writes.push(params);
        lists[params.projectId] = params.visibleAgents;
        return Promise.resolve();
      },
    },
  } as unknown as HostClient;
}

describe("connecting an agent", () => {
  it("writes the list read now with the agent added, and reports the list it found", async () => {
    const writes: { projectId: string; visibleAgents: string[] }[] = [];
    expect(await connectAgent(host({ p: ["a", "b"] }, writes), "p", "me")).toEqual({ done: true, before: ["a", "b"] });
    expect(writes).toEqual([{ projectId: "p", visibleAgents: ["a", "b", "me"] }]);
  });

  it("puts it back where it was for an Undo", async () => {
    const writes: { projectId: string; visibleAgents: string[] }[] = [];
    await connectAgent(host({ p: ["a", "b"] }, writes), "p", "me", 1);
    expect(writes[0]?.visibleAgents).toEqual(["a", "me", "b"]);
  });

  it("writes nothing for a project that offers every agent or already offers it", async () => {
    const writes: { projectId: string; visibleAgents: string[] }[] = [];
    expect(await connectAgent(host({ p: ["*"], q: ["me"] }, writes), "p", "me")).toEqual({ done: false, reason: "The project offers every agent." });
    expect(await connectAgent(host({ p: ["*"], q: ["me"] }, writes), "q", "me")).toEqual({ done: false, reason: "The project already offers me." });
    expect(writes).toEqual([]);
  });
});

describe("disconnecting an agent", () => {
  it("writes the list read now without the agent, keeping what others added meanwhile", async () => {
    const writes: { projectId: string; visibleAgents: string[] }[] = [];
    expect(await disconnectAgent(host({ p: ["a", "me", "late"] }, writes), "p", "me")).toEqual({ done: true, before: ["a", "me", "late"] });
    expect(writes).toEqual([{ projectId: "p", visibleAgents: ["a", "late"] }]);
  });

  it("never rewrites a project that offers every agent, and writes nothing for one that does not offer the agent", async () => {
    const writes: { projectId: string; visibleAgents: string[] }[] = [];
    const lists = { p: ["*"], q: ["a"] };
    expect(await disconnectAgent(host(lists, writes), "p", "me")).toMatchObject({ done: false });
    expect(await disconnectAgent(host(lists, writes), "q", "me")).toEqual({ done: false, reason: "The project does not offer me." });
    expect(writes).toEqual([]);
  });

  it("lets the host's refusal through, and says it in plain words", async () => {
    await expect(disconnectAgent(host({}), "gone", "me")).rejects.toBeInstanceOf(HostError);
    expect(offerFailure(new HostError("not-found", "No project gone"))).toEqual({ text: "The project’s agents were not changed. Pomade no longer has the project.", title: "No project gone" });
    expect(offerFailure(new Error("boom")).text).toBe("The project’s agents were not changed. Something went wrong.");
  });
});
