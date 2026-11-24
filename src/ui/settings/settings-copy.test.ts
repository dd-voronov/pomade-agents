import { describe, expect, it } from "vitest";

import { addedText, dependText, linksText, plural, refusedText, removedText } from "./settings-copy.ts";

describe("the Settings page's words", () => {
  it("counts in the singular and the plural", () => {
    expect(plural(0, "skill")).toBe("0 skills");
    expect(plural(1, "skill")).toBe("1 skill");
    expect(plural(12, "skill")).toBe("12 skills");
  });

  it("says how many links from how many agents point into a folder", () => {
    expect(linksText({ links: 0, agents: [] })).toBe("no links");
    expect(linksText({ links: 1, agents: ["a"] })).toBe("1 link from 1 agent");
    expect(linksText({ links: 5, agents: ["a", "b", "c"] })).toBe("5 links from 3 agents");
  });

  it("leads the Remove warning with what depends on the folder", () => {
    expect(dependText({ links: 1, agents: ["a"] })).toBe("1 skill link in 1 agent depends on this folder");
    expect(dependText({ links: 4, agents: ["a", "b"] })).toBe("4 skill links in 2 agents depend on this folder");
  });

  it("says what a change did", () => {
    expect(addedText("Projects/kit/skills", 2)).toBe("Added Projects/kit/skills: Add skill now offers its 2 skills.");
    expect(addedText("Projects/docs", 0)).toBe("Added Projects/docs — it holds no skills yet (no SKILL.md found).");
    expect(removedText("Knowledge/_skills")).toBe("Removed Knowledge/_skills from Skill folders.");
    expect(refusedText("Projects/a/b", "It is listed already.")).toBe("Projects/a/b was not added. It is listed already.");
  });
});
