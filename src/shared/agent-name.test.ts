import { describe, expect, it } from "vitest";

import { AGENT_NAME_MAX, nameRuleProblem } from "./agent-name.ts";

describe("a new agent's name rules", () => {
  it("takes lowercase letters, digits and dashes, a letter or digit first", () => {
    for (const name of ["claude-tax-advisor", "a", "7", "x9", "a-b-c", "a--b", "ends-", "9lives"]) expect(nameRuleProblem(name), name).toBeNull();
  });

  it("checks in order: empty, a leading dash, the characters, the length, then the reserved names", () => {
    expect(nameRuleProblem("")).toBe("empty");
    expect(nameRuleProblem("-tax")).toBe("leading-dash");
    expect(nameRuleProblem("-Tax")).toBe("leading-dash");
    for (const name of ["Tax", "tax advisor", "tax_advisor", "tax.advisor", "ünï", "tax/x", " tax", "tax\n"]) expect(nameRuleProblem(name), name).toBe("characters");
    expect(nameRuleProblem("a".repeat(AGENT_NAME_MAX))).toBeNull();
    expect(nameRuleProblem("a".repeat(AGENT_NAME_MAX + 1))).toBe("too-long");
    expect(nameRuleProblem("UPPER".repeat(20))).toBe("characters");
  });

  it("reserves `new` (the New agent page's route) and any name the agent scan would skip", () => {
    expect(nameRuleProblem("new")).toBe("reserved");
    expect(nameRuleProblem("my-template")).toBe("reserved");
    expect(nameRuleProblem("templates")).toBe("reserved");
    expect(nameRuleProblem("new-agent")).toBeNull();
    expect(nameRuleProblem("renew")).toBeNull();
  });
});
