import { describe, expect, it } from "vitest";

import { resolveLocations } from "./locations.ts";

describe("resolveLocations", () => {
  it("takes the state folder from POMADE_APP_STATE and the data folder from the workspace", () => {
    expect(resolveLocations({ POMADE_APP_STATE: "/ud/app-state/pomade-agents", POMADE_WORKSPACE: "/ws" }, "pomade-agents")).toEqual({
      workspace: "/ws",
      dataDir: "/ws/Apps/pomade-agents",
      stateDir: "/ud/app-state/pomade-agents",
    });
  });

  it("does not derive the state folder from the socket", () => {
    expect(resolveLocations({ POMADE_APP_STATE: "/state", POMADE_SOCKET: "/ud/run/pomade.sock" }, "pomade-agents").stateDir).toBe("/state");
  });

  it("has no data folder while no workspace is open", () => {
    expect(resolveLocations({ POMADE_APP_STATE: "/ud/app-state/pomade-agents" }, "pomade-agents")).toEqual({
      workspace: null,
      dataDir: null,
      stateDir: "/ud/app-state/pomade-agents",
    });
    expect(resolveLocations({ POMADE_APP_STATE: "/s", POMADE_WORKSPACE: "" }, "pomade-agents").workspace).toBeNull();
  });

  it("refuses an environment that is not a backend's", () => {
    expect(() => resolveLocations({}, "pomade-agents")).toThrow("POMADE_APP_STATE is not set");
    expect(() => resolveLocations({ POMADE_SOCKET: "/ud/run/pomade.sock" }, "pomade-agents")).toThrow("POMADE_APP_STATE is not set");
    expect(() => resolveLocations({ POMADE_APP_STATE: "app-state/x" }, "pomade-agents")).toThrow("POMADE_APP_STATE must be an absolute path");
    expect(() => resolveLocations({ POMADE_APP_STATE: "/s", POMADE_WORKSPACE: "ws" }, "pomade-agents")).toThrow(
      "POMADE_WORKSPACE must be an absolute path",
    );
  });
});
