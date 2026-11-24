import { describe, expect, it } from "vitest";

import { selectedSessionOf, sessionsRoute, viewFor } from "./routes.ts";

describe("viewFor", () => {
  it("shows Live now in the panel, whatever the route", () => {
    expect(viewFor("panel", "")).toBe("live-now");
    expect(viewFor("panel", "roster")).toBe("live-now");
  });

  it("shows the view a tab's route names", () => {
    expect(viewFor("tab", "sessions")).toBe("sessions");
    expect(viewFor("tab", "sessions/5b0e8f52-3c1d-4a7e-9f21-6d8c0b4a7e13")).toBe("sessions");
    expect(viewFor("tab", "roster")).toBe("roster");
    expect(viewFor("tab", "roster/claude-libra")).toBe("roster");
    expect(viewFor("tab", "settings")).toBe("settings");
  });

  it("shows Sessions in a tab opened at the default or an unknown route", () => {
    expect(viewFor("tab", "")).toBe("sessions");
    expect(viewFor("tab", "rosters")).toBe("sessions");
    expect(viewFor("tab", "nope")).toBe("sessions");
    expect(viewFor("tab", "settingsx")).toBe("sessions");
  });
});

describe("the Sessions route's selection", () => {
  it("names the selected session after `sessions/`", () => {
    expect(sessionsRoute("5b0e8f52-3c1d")).toBe("sessions/5b0e8f52-3c1d");
    expect(selectedSessionOf("sessions/5b0e8f52-3c1d")).toBe("5b0e8f52-3c1d");
    expect(sessionsRoute(null)).toBe("sessions");
  });

  it("round-trips an id with characters a route cannot hold as they are", () => {
    for (const id of ["a/b", "a b", "ünï", "%41"]) expect(selectedSessionOf(sessionsRoute(id))).toBe(id);
  });

  it("selects nothing on any other route", () => {
    for (const route of ["sessions", "", "sessions/", "roster/x", "sessions/a/b", "sessions/%E0", "sessionsx/a"]) expect(selectedSessionOf(route)).toBeNull();
  });
});
