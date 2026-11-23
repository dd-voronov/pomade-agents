import { describe, expect, it } from "vitest";

import { isAppInfo, type AppInfo } from "./api.ts";

const INFO: AppInfo = {
  version: "0.1.0",
  startedAt: "2026-11-17T10:00:00.000Z",
  workspace: "/ws",
  workspaceReal: "/private/ws",
  dataDir: "/ws/Apps/pomade-agents",
  stateDir: "/ud/app-state/pomade-agents",
};

describe("isAppInfo", () => {
  it("accepts an answer with and without a workspace", () => {
    expect(isAppInfo(INFO)).toBe(true);
    expect(isAppInfo({ ...INFO, workspace: null, workspaceReal: null, dataDir: null })).toBe(true);
  });

  it("refuses anything else", () => {
    expect(isAppInfo(null)).toBe(false);
    expect(isAppInfo("0.1.0")).toBe(false);
    expect(isAppInfo({ ...INFO, version: 1 })).toBe(false);
    expect(isAppInfo({ ...INFO, stateDir: null })).toBe(false);
    const { workspaceReal: _real, ...withoutReal } = INFO;
    expect(isAppInfo(withoutReal)).toBe(false);
    const { startedAt: _startedAt, ...withoutStart } = INFO;
    expect(isAppInfo(withoutStart)).toBe(false);
  });
});
