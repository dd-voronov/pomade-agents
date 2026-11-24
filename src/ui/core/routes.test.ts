import { describe, expect, it } from "vitest";

import { NEW_AGENT_ROUTE, agentPageOf, agentProjectOf, agentRoute, agentSessionsRoute, cloneSourceOf, isNewAgentRoute, newAgentRoute, selectedSessionOf, sessionsFilterRoute, sessionsPresetOf, sessionsRoute, viewFor } from "./routes.ts";

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

describe("the New agent route", () => {
  it("is `roster/new` exactly, in the Roster view", () => {
    expect(NEW_AGENT_ROUTE).toBe("roster/new");
    expect(isNewAgentRoute("roster/new")).toBe(true);
    expect(viewFor("tab", "roster/new")).toBe("roster");
    for (const route of ["roster", "roster/new/x", "roster/newer", "roster/claude-libra", "sessions/new"]) expect(isNewAgentRoute(route), route).toBe(false);
  });

  it("names the agent to clone after `?clone=`, never as an agent's page", () => {
    expect(newAgentRoute()).toBe("roster/new");
    expect(newAgentRoute("claude-libra")).toBe("roster/new?clone=claude-libra");
    expect(newAgentRoute("a b&c")).toBe("roster/new?clone=a+b%26c");
    expect(cloneSourceOf(newAgentRoute("a b&c"))).toBe("a b&c");
    expect(isNewAgentRoute("roster/new?clone=claude-libra")).toBe(true);
    expect(agentPageOf("roster/new?clone=claude-libra")).toBeNull();
    expect(viewFor("tab", "roster/new?clone=claude-libra")).toBe("roster");
    for (const route of ["roster/new", "roster/new?clone=", "roster/new?x=1", "roster/claude-libra", "sessions?clone=x"]) expect(cloneSourceOf(route), route).toBeNull();
  });
});

describe("the agent page's route", () => {
  it("names the agent and the tab after `roster/`", () => {
    expect(agentRoute("claude-libra", "permissions")).toBe("roster/claude-libra/permissions");
    expect(agentRoute("claude-libra")).toBe("roster/claude-libra/overview");
    expect(agentPageOf("roster/claude-libra/memory")).toEqual({ agent: "claude-libra", tab: "memory" });
  });

  it("opens Overview for a route with no tab or an unknown one", () => {
    expect(agentPageOf("roster/claude-libra")).toEqual({ agent: "claude-libra", tab: "overview" });
    expect(agentPageOf("roster/claude-libra/nope")).toEqual({ agent: "claude-libra", tab: "overview" });
  });

  it("round-trips an agent id with characters a route cannot hold as they are", () => {
    for (const id of ["a/b", "a b", "ünï", "%41"]) expect(agentPageOf(agentRoute(id, "sessions"))).toEqual({ agent: id, tab: "sessions" });
  });

  it("names no agent on the Roster, on the new-agent page or on any other route", () => {
    for (const route of ["roster", "roster/", "roster/new", "roster/new/overview", "sessions/a", "", "roster/a/overview/x", "roster/%E0/overview", "rosters/a"]) expect(agentPageOf(route)).toBeNull();
  });

  it("shows every agent-page route in the Roster view", () => {
    expect(viewFor("tab", agentRoute("claude-libra", "sessions"))).toBe("roster");
    expect(viewFor("tab", agentSessionsRoute("claude-libra", "alpha"))).toBe("roster");
  });
});

describe("the agent page's Sessions tab filtered to a project", () => {
  it("names the project after `sessions?project=`, and the plain tab route for none", () => {
    expect(agentSessionsRoute("claude-libra", "alpha")).toBe("roster/claude-libra/sessions?project=alpha");
    expect(agentSessionsRoute("claude-libra", null)).toBe("roster/claude-libra/sessions");
  });

  it("keeps the agent and the tab whatever the query says", () => {
    expect(agentPageOf("roster/claude-libra/sessions?project=alpha")).toEqual({ agent: "claude-libra", tab: "sessions" });
    expect(agentPageOf("roster/claude-libra/projects?project=alpha")).toEqual({ agent: "claude-libra", tab: "projects" });
  });

  it("reads the project back, URI-encoded ids included", () => {
    for (const project of ["alpha", "a/b&c=d", "ünï %41", "__workspace__"]) {
      expect(agentProjectOf(agentSessionsRoute("a b", project))).toBe(project);
    }
  });

  it("names no project on another tab, with no query, with an empty one, or on a route that is no agent's page", () => {
    for (const route of ["roster/a/sessions", "roster/a/sessions?", "roster/a/sessions?project=", "roster/a/sessions?other=1", "roster/a/memory?project=x", "roster?project=x", "sessions?project=x", "roster/new?project=x"]) {
      expect(agentProjectOf(route)).toBeNull();
    }
  });
});

describe("the Sessions route's preset filters", () => {
  it("names the agent and the project after `sessions?`", () => {
    expect(sessionsFilterRoute({ agent: "claude-libra" })).toBe("sessions?agent=claude-libra");
    expect(sessionsFilterRoute({ agent: "a", project: "p-1" })).toBe("sessions?agent=a&project=p-1");
    expect(sessionsFilterRoute({})).toBe("sessions");
  });

  it("round-trips ids with characters a route cannot hold as they are, and shows the Sessions view", () => {
    const preset = { agent: "a/b&c=d", project: "ünï %41" };
    expect(sessionsPresetOf(sessionsFilterRoute(preset))).toEqual(preset);
    expect(viewFor("tab", sessionsFilterRoute(preset))).toBe("sessions");
    expect(selectedSessionOf(sessionsFilterRoute(preset))).toBeNull();
  });

  it("presets nothing on any other route", () => {
    for (const route of ["sessions", "", "sessions?", "sessions?other=1", "sessions/a", "roster?agent=a"]) expect(sessionsPresetOf(route)).toBeNull();
  });
});
