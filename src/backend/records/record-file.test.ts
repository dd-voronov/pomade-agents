import { describe, expect, it } from "vitest";

import type { AgentProfile } from "../../shared/roster.ts";
import type { SessionRecord } from "../../shared/sessions.ts";
import { parseProfile, parseRecord, parseSettings, renderProfile, renderRecord, rewriteProfile, rewriteRecord, settingsWithAdoptedAt } from "./record-file.ts";

const ID = "7b5c3451-0370-4bf9-b6fd-617d56545a78";
const RECORD: SessionRecord = {
  id: ID,
  provider: "claude-code",
  agent: "claude",
  name: "G4: agents grill",
  status: "on-hold",
  note: "waiting for the v0.2.6 test round # not a comment",
  project: "p1",
  projectRoot: "Projects/Pomade",
  launchedFrom: "p1",
  transcript: `/Users/x/.claude/projects/-w/${ID}.jsonl`,
  cwd: "/Users/x/Projects/Pomade",
  updated: "2026-11-09T14:32:00Z",
};

describe("a session record file", () => {
  it("is written in ARCHITECTURE §4's key order and reads back as it was written", () => {
    const text = renderRecord(RECORD);
    expect(text.split("\n")[0]).toBe(`id: ${ID}`);
    expect(text).toContain('name: "G4: agents grill"');
    expect(text).toContain("updated: 2026-11-09T14:32:00Z");
    expect(parseRecord(ID, text)).toEqual({ ok: true, value: RECORD });
  });

  it("keeps a time a string, names any value that looks like another type as text, and a long note on one line", () => {
    const record: SessionRecord = { ...RECORD, name: "123", note: "x ".repeat(200).trim() };
    const text = renderRecord(record);
    expect(text.split("\n").find((l) => l.startsWith("note:"))?.length).toBeGreaterThan(400);
    expect(parseRecord(ID, text)).toEqual({ ok: true, value: record });
  });

  it("reads a key with no value, and a false flag, as absent", () => {
    expect(parseRecord(ID, `id: ${ID}\nprovider: codex\nagent: codex\nstatus: done\nname:\nprojectOverride: false\n`)).toEqual({
      ok: true,
      value: { id: ID, provider: "codex", agent: "codex", status: "done" },
    });
  });

  it.each([
    ["not YAML", "id: [unclosed\n", "it is not valid YAML"],
    ["not a mapping", "- a\n- b\n", "it is not a mapping"],
    ["empty", "", "it is not a mapping"],
    ["a repeated key", `id: ${ID}\nid: ${ID}\n`, "it is not valid YAML"],
    ["another session's", "id: other\nprovider: codex\nagent: codex\nstatus: done\n", "its id is not"],
    ["without a status", `id: ${ID}\nprovider: codex\nagent: codex\n`, "its status is missing"],
    ["with an unknown status", `id: ${ID}\nprovider: codex\nagent: codex\nstatus: paused\n`, "its status is not valid"],
    ["with a name of two lines", `id: ${ID}\nprovider: codex\nagent: codex\nstatus: done\nname: "a\\nb"\n`, "its name is not valid"],
    ["with a numeric name", `id: ${ID}\nprovider: codex\nagent: codex\nstatus: done\nname: 2026\n`, "its name is not valid"],
  ])("refuses a file %s, saying why", (_name, text, problem) => {
    const parsed = parseRecord(ID, text);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.problem).toContain(problem);
  });

  it("is rewritten key by key: comments, extra keys, order and quoting of the rest stay", () => {
    const edited = [
      "# My notes on this one",
      `id: ${ID}`,
      "status: done   # finished on Friday",
      "provider: claude-code",
      "agent: claude",
      "name: 'Grill'",
      "color: red",
      "note: old note",
      "",
    ].join("\n");
    const parsed = parseRecord(ID, edited);
    expect(parsed).toEqual({ ok: true, value: { id: ID, status: "done", provider: "claude-code", agent: "claude", name: "Grill", note: "old note" } });
    if (!parsed.ok) return;
    const { note: _note, ...rest } = parsed.value;
    const next: SessionRecord = { ...rest, status: "on-hold", launchedFrom: "p1" };
    expect(rewriteRecord(edited, next)).toBe(
      [
        "# My notes on this one",
        `id: ${ID}`,
        "status: on-hold # finished on Friday",
        "provider: claude-code",
        "agent: claude",
        "name: 'Grill'",
        "color: red",
        "launchedFrom: p1",
        "",
      ].join("\n"),
    );
  });

  it("is not touched by a rewrite to the same values", () => {
    const text = `# keep\nid: ${ID}\nprovider: codex\nagent: codex\nstatus: done\nname:\n`;
    expect(rewriteRecord(text, { id: ID, provider: "codex", agent: "codex", status: "done" })).toBe(text);
  });
});

describe("the settings file", () => {
  it("holds the first run's time", () => {
    const text = settingsWithAdoptedAt(null, "2026-11-17T10:00:00.000Z");
    expect(text).toBe("adoptedAt: 2026-11-17T10:00:00.000Z\n");
    expect(settingsWithAdoptedAt("# mine\n", "2026-11-17T10:00:00.000Z")).toBe("# mine\n\nadoptedAt: 2026-11-17T10:00:00.000Z\n");
    expect(settingsWithAdoptedAt("# mine\nother: 1 # kept\n", "2026-11-17T10:00:00.000Z")).toBe("# mine\nother: 1 # kept\nadoptedAt: 2026-11-17T10:00:00.000Z\n");
    expect(parseSettings(text)).toEqual({ ok: true, value: { adoptedAt: "2026-11-17T10:00:00.000Z" } });
  });

  it("is no first run yet when empty or without the time", () => {
    expect(parseSettings("")).toEqual({ ok: true, value: { adoptedAt: null } });
    expect(parseSettings("# nothing yet\n")).toEqual({ ok: true, value: { adoptedAt: null } });
    expect(parseSettings("# nothing yet\nother: 1\n")).toEqual({ ok: true, value: { adoptedAt: null } });
  });

  it("is refused when it is not YAML or the time is not a time", () => {
    expect(parseSettings("adoptedAt: [").ok).toBe(false);
    expect(parseSettings("adoptedAt: soon\n")).toEqual({ ok: false, problem: "its adoptedAt is not a time" });
    expect(parseSettings("adoptedAt: 5\n").ok).toBe(false);
    expect(parseSettings("- a\n").ok).toBe(false);
  });
});

describe("an agent profile file", () => {
  const PROFILE: AgentProfile = {
    id: "claude-libra",
    provider: "claude",
    kind: "folder",
    configDir: "Agents/claude-libra",
    command: "claude-libra",
    role: "A meticulous librarian for the Knowledge vault.",
    tags: ["knowledge", "vault"],
    hidden: false,
    modes: { normal: { enabled: true }, "full-autonomy": { enabled: true } },
  };

  it("is written in ARCHITECTURE §3.2's key order and reads back as it was written", () => {
    const text = renderProfile(PROFILE);
    expect(text.split("\n").map((l) => l.split(":")[0]).filter((k): k is string => k !== undefined && k !== "" && !k.startsWith(" "))).toEqual([
      "id",
      "provider",
      "kind",
      "configDir",
      "command",
      "role",
      "tags",
      "hidden",
      "modes",
    ]);
    expect(parseProfile("claude-libra", text)).toEqual({ ok: true, value: PROFILE });
  });

  it("reads absent tags and hidden as none and false, an absent mode as not enabled, and leaves unknown modes out", () => {
    const text = "id: codex\nprovider: codex\nkind: builtin\nconfigDir: ~/.codex\ncommand: codex\nmodes:\n  normal: { enabled: true }\n  plan: { enabled: true }\n";
    expect(parseProfile("codex", text)).toEqual({
      ok: true,
      value: { id: "codex", provider: "codex", kind: "builtin", configDir: "~/.codex", command: "codex", tags: [], hidden: false, modes: { normal: { enabled: true } } },
    });
  });

  it.each([
    ["id: [\n", "not valid YAML"],
    ["- a\n", "not a mapping"],
    [renderProfile({ ...PROFILE, id: "other" }), 'its id is not "claude-libra"'],
    [renderProfile(PROFILE).replace("provider: claude", "provider: gemini"), "its provider is not valid"],
    [renderProfile(PROFILE).replace("command: claude-libra\n", ""), "its command is missing"],
    [renderProfile(PROFILE).replace("hidden: false", "hidden: maybe"), "its hidden is not valid"],
    [renderProfile(PROFILE).replace("normal:\n    enabled: true", "normal:\n    enabled: yes please"), "its modes is not valid"],
  ])("names why it cannot be used: %j", (text, problem) => {
    expect(parseProfile("claude-libra", text)).toEqual({ ok: false, problem: expect.stringContaining(problem) });
  });

  it("is rewritten key by key, keeping comments and keys the app does not know", () => {
    const text = `# my librarian\n${renderProfile(PROFILE)}color: teal # mine\n`;
    const next = rewriteProfile(text, { ...PROFILE, role: "Keeps the vault.", hidden: true });
    expect(next).toContain("# my librarian");
    expect(next).toContain("color: teal # mine");
    expect(next).toContain("role: Keeps the vault.");
    expect(parseProfile("claude-libra", next)).toEqual({ ok: true, value: { ...PROFILE, role: "Keeps the vault.", hidden: true } });
    expect(rewriteProfile(text, PROFILE)).toBe(text);
  });
});
