import { describe, expect, it } from "vitest";

import type { AgentProfile } from "../../shared/roster.ts";
import { checkProfileEdit, editedProfile } from "./profile-edit.ts";

const PROFILE: AgentProfile = { id: "a", provider: "claude", kind: "folder", configDir: "Agents/a", command: "a", role: "Old.", tags: ["x"], hidden: false, modes: {} };

describe("checkProfileEdit", () => {
  it("takes a role and tags, trimmed, either alone or both", () => {
    expect(checkProfileEdit(" New role. ", undefined)).toEqual({ ok: true, edit: { role: "New role." } });
    expect(checkProfileEdit(null, [" a", "b "])).toEqual({ ok: true, edit: { role: null, tags: ["a", "b"] } });
    expect(checkProfileEdit(undefined, [])).toEqual({ ok: true, edit: { tags: [] } });
  });

  it.each<[string, unknown, unknown]>([
    ["nothing", undefined, undefined],
    ["a blank role", "  ", undefined],
    ["a two-line role", "a\nb", undefined],
    ["a role over the limit", "x".repeat(201), undefined],
    ["a number as the role", 3, undefined],
    ["tags that are not a list", undefined, "a"],
    ["a blank tag", undefined, ["a", " "]],
    ["a tag over the limit", undefined, ["x".repeat(25)]],
    ["a repeated tag", undefined, ["a", "a "]],
    ["too many tags", undefined, Array.from({ length: 21 }, (_, i) => `t${i}`)],
  ])("refuses %s", (_, role, tags) => {
    expect(checkProfileEdit(role, tags)).toMatchObject({ ok: false });
  });
});

describe("editedProfile", () => {
  it("sets, replaces and removes only what the edit names", () => {
    expect(editedProfile(PROFILE, { role: "New." })).toEqual({ ...PROFILE, role: "New." });
    expect(editedProfile(PROFILE, { tags: ["y", "z"] })).toEqual({ ...PROFILE, tags: ["y", "z"] });
    expect(editedProfile(PROFILE, { role: null })).not.toHaveProperty("role");
    const { role: _role, ...bare } = PROFILE;
    expect(editedProfile(bare, { role: "Set." })).toEqual({ ...PROFILE, role: "Set." });
  });
});
