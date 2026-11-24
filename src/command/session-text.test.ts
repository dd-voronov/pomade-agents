import { describe, expect, it } from "vitest";

import { testSession, testSummary } from "../shared/test-sessions.ts";
import { MESSAGE_SHOWN, oneLine, sessionText, utcStamp } from "./session-text.ts";

const NAMES = new Map([
  ["alpha", "Alpha"],
  ["beta", "Beta"],
]);

describe("show's text", () => {
  it("lays a named session out as label and value lines, its name first", () => {
    const session = testSession({
      id: "7b5c",
      summary: testSummary({
        id: "7b5c",
        transcript: "/h/.claude/projects/-w/7b5c.jsonl",
        cwd: "/w/alpha",
        branch: "main",
        model: "claude-opus-5-5",
        effort: "high",
        tokens: { input: 1200, output: 35000, cacheRead: 900000, cacheWrite: 40000 },
        context: { used: 84000, window: 200000 },
        costUsd: 4.2,
        firstMessage: { text: "Write the\n  release notes", at: "2026-11-17T10:00:00.000Z" },
        lastMessage: { text: "Ship it", at: null },
        lastAnswer: null,
      }),
      record: { id: "7b5c", provider: "claude-code", agent: "claude", name: "G4 tickets", status: "on-hold", note: "waiting for review", startedByRunner: { job: "Morning summary" } },
      attribution: { projects: ["alpha", "beta"], by: "folder", sharedFolder: true },
      live: "needs-you",
      liveSince: "2026-11-17T10:06:30.000Z",
    });
    expect(sessionText(session, NAMES)).toBe(
      [
        "G4 tickets",
        "status        On hold — waiting for review",
        "live          Needs you since 2026-11-17 10:06 UTC",
        "agent         claude · claude-code · claude-opus-5-5 high",
        "project       Alpha (alpha), Beta (beta) — shared folder",
        "folder        /w/alpha",
        "branch        main",
        "started       2026-11-17 10:00 UTC",
        "last active   2026-11-17 10:05 UTC",
        'first message "Write the release notes" (2026-11-17 10:00 UTC)',
        'last message  "Ship it"',
        "tokens        1,200 in · 35,000 out · 900,000 cache read · 40,000 cache write",
        "cost          ~$4.20 est.",
        "context       42% of 200,000",
        "runner job    Morning summary",
        "transcript    /h/.claude/projects/-w/7b5c.jsonl",
        "id            7b5c",
        "",
      ].join("\n"),
    );
  });

  it("says unnamed, the Workspace, Closed, an unknown cost and a missing record plainly, and leaves out what is unknown", () => {
    const text = sessionText(testSession({ id: "s1", record: null, attribution: { projects: ["gone"], by: "remembered", sharedFolder: false } }), NAMES);
    expect(text.split("\n").slice(0, 5)).toEqual(["Unnamed session", "status        — no record yet", "live          Closed", "agent         claude · claude-code", "project       gone"]);
    expect(text).toContain("cost          — a model it ran is not in the price table\n");
    expect(text).not.toMatch(/^(branch|context|runner job|first message|last answer) /m);
    expect(sessionText(testSession({ record: null, recordProblem: "it is not valid YAML" }), NAMES)).toContain("status        — its record cannot be read: it is not valid YAML\n");
    expect(sessionText(testSession(), NAMES)).toContain("project       Workspace\n");
  });

  it("holds no escape sequence: the text is the same on a terminal and in a pipe", () => {
    expect(sessionText(testSession(), NAMES)).not.toContain("\u001b");
  });

  it("cuts a message to one line and dates in UTC", () => {
    expect(oneLine("a\n\tb   c ")).toBe("a b c");
    const cut = oneLine("x".repeat(MESSAGE_SHOWN + 5));
    expect(cut).toHaveLength(MESSAGE_SHOWN);
    expect(cut.endsWith("…")).toBe(true);
    expect(oneLine("x".repeat(MESSAGE_SHOWN))).toBe("x".repeat(MESSAGE_SHOWN));
    expect(utcStamp("2026-11-17T12:05:59+02:00")).toBe("2026-11-17 10:05 UTC");
    expect(utcStamp("soon")).toBe("soon");
  });
});
