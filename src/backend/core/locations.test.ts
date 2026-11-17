import { describe, expect, it } from "vitest";

import { resolveLocations } from "./locations.ts";

describe("resolveLocations", () => {
  it("derives the state folder from the socket and the data folder from the workspace", () => {
    expect(resolveLocations({ POMADE_SOCKET: "/ud/run/pomade.sock", POMADE_WORKSPACE: "/ws" }, "pomade-agents")).toEqual({
      workspace: "/ws",
      dataDir: "/ws/Apps/pomade-agents",
      stateDir: "/ud/app-state/pomade-agents",
    });
  });

  it("has no data folder while no workspace is open", () => {
    expect(resolveLocations({ POMADE_SOCKET: "/ud/run/pomade.sock" }, "pomade-agents")).toEqual({
      workspace: null,
      dataDir: null,
      stateDir: "/ud/app-state/pomade-agents",
    });
    expect(resolveLocations({ POMADE_SOCKET: "/ud/run/pomade.sock", POMADE_WORKSPACE: "" }, "pomade-agents").workspace).toBeNull();
  });

  it("refuses an environment that is not a backend's", () => {
    expect(() => resolveLocations({}, "pomade-agents")).toThrow("POMADE_SOCKET is not set");
    expect(() => resolveLocations({ POMADE_SOCKET: "run/pomade.sock" }, "pomade-agents")).toThrow("must be an absolute path");
    expect(() => resolveLocations({ POMADE_SOCKET: "/ud/pomade.sock" }, "pomade-agents")).toThrow('not in Pomade\'s "run" folder');
    expect(() => resolveLocations({ POMADE_SOCKET: "/ud/run/pomade.sock", POMADE_WORKSPACE: "ws" }, "pomade-agents")).toThrow(
      "POMADE_WORKSPACE must be an absolute path",
    );
  });
});
