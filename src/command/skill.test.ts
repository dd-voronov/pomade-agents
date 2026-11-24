// The format skill (`public/skills/pomade-agents-sessions/SKILL.md`) is what agents and scripts
// follow with no other doc: it must name every record key, every status and every exit status
// the code has.

import { readFileSync } from "node:fs";

import { SESSION_STATUSES } from "pomade-kit/protocol";
import { describe, expect, it } from "vitest";

import { SESSION_RECORD_KEYS } from "../shared/sessions.ts";
import { testSummary } from "../shared/test-sessions.ts";
import { isWorkSession } from "../shared/work-sessions.ts";
import { EXIT, RECORDS_FOLDER } from "./cli.ts";

const SKILL = readFileSync(new URL("../../public/skills/pomade-agents-sessions/SKILL.md", import.meta.url), "utf8");

/** The rows of the Markdown table whose header row begins with `| <first> |`: their first cells. */
function firstCells(first: string): string[] {
  const start = SKILL.indexOf(`\n| ${first} |`);
  if (start < 0) return [];
  const rows = SKILL.slice(start + 1).split("\n\n")[0]?.split("\n").slice(2) ?? [];
  return rows.map((row) => row.split("|")[1]?.trim() ?? "");
}

describe("the pomade-agents-sessions skill", () => {
  it("describes every record key, in the files' order", () => {
    expect(firstCells("Key")).toEqual(SESSION_RECORD_KEYS.map((key) => `\`${key}\``));
  });

  it("describes every status, and the work-session rule as the code has it: every status counts but Done–skip", () => {
    expect(firstCells("Value")).toEqual(SESSION_STATUSES.map((status) => `\`${status}\``));
    const counted = SESSION_STATUSES.filter((status) => isWorkSession({ summary: testSummary(), record: { id: "s1", provider: "claude-code", agent: "claude", status } }));
    expect(SESSION_STATUSES.filter((status) => !counted.includes(status))).toEqual(["done-skip"]);
    expect(SKILL).toContain("**Every session is a work session unless its status\nis `done-skip`**");
    expect(SKILL).toContain('"work": true');
  });

  it("gives every exit status the command has", () => {
    expect(firstCells("Exit").map(Number)).toEqual(Object.values(EXIT).sort((a, b) => a - b));
  });

  it("names the records' folder and the command's usage", () => {
    expect(SKILL).toContain(`<workspace>/${RECORDS_FOLDER}/<session-id>.yaml`);
    expect(SKILL).toContain("pomade-agents show [--session <id>] [--json]");
    expect(SKILL).not.toMatch(/set-status/);
  });
});
