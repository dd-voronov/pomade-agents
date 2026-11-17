import { describe, expect, it } from "vitest";

import { viewFor } from "./routes.ts";

describe("viewFor", () => {
  it("shows Live now in the panel, whatever the route", () => {
    expect(viewFor("panel", "")).toBe("live-now");
    expect(viewFor("panel", "roster")).toBe("live-now");
  });

  it("shows the view a tab's route names", () => {
    expect(viewFor("tab", "sessions")).toBe("sessions");
    expect(viewFor("tab", "roster")).toBe("roster");
    expect(viewFor("tab", "roster/claude-libra")).toBe("roster");
  });

  it("shows Sessions in a tab opened at the default or an unknown route", () => {
    expect(viewFor("tab", "")).toBe("sessions");
    expect(viewFor("tab", "rosters")).toBe("sessions");
    expect(viewFor("tab", "nope")).toBe("sessions");
  });
});
