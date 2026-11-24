import { describe, expect, it } from "vitest";

import { CARD_NAMES, connectedTitle, connectedTotal, cutName, fitCount, projectTint, rankConnected } from "./connected-model.ts";

const names = new Map([
  ["a", "Alpha"],
  ["b", "Beta"],
  ["c", "Gamma"],
  ["d", "Delta"],
]);
const counts = (...rows: [string, number][]) => rows.map(([project, sessions]) => ({ project, sessions, lastAt: null }));

describe("ranking the connected projects", () => {
  it("puts the projects with work sessions first, most first, then the rest in the panel's order", () => {
    const ranked = rankConnected(["a", "b", "c", "d"], counts(["c", 5], ["b", 2]), names);
    expect(ranked.map((p) => [p.id, p.sessions])).toEqual([
      ["c", 5],
      ["b", 2],
      ["a", 0],
      ["d", 0],
    ]);
  });

  it("keeps the panel's order between projects with as many sessions", () => {
    expect(rankConnected(["a", "b", "c"], counts(["c", 2], ["a", 2], ["b", 2]), names).map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("ignores sessions in a project the agent is not connected to, and in the Workspace", () => {
    const ranked = rankConnected(["a", "b"], counts(["__workspace__", 30], ["z", 9], ["b", 1]), names);
    expect(ranked.map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("counts a project with older sessions only as having none, and names an unknown one by its id", () => {
    const ranked = rankConnected(["x", "a"], counts(["x", 0], ["a", 0]), names);
    expect(ranked).toEqual([
      { id: "x", name: "x", sessions: 0 },
      { id: "a", name: "Alpha", sessions: 0 },
    ]);
  });

  it("is empty for an agent connected to nothing", () => {
    expect(rankConnected([], counts(["a", 4]), names)).toEqual([]);
  });
});

describe("how many names fit", () => {
  const base = { fixed: 40, items: [100, 110, 90], more: 20, available: 1000, total: 3 };

  it("names every candidate when there is room", () => {
    expect(fitCount(base)).toBe(3);
  });

  it("drops names from the end until the rest fit", () => {
    expect(fitCount({ ...base, available: 40 + 100 + 110 + 20 })).toBe(2);
    expect(fitCount({ ...base, available: 40 + 100 + 110 + 20 - 1 })).toBe(1);
  });

  it("keeps room for the … while some connected project is not named", () => {
    // Eight are connected, three are candidates: the … stands after the last name too.
    const more = { ...base, total: 8 };
    expect(fitCount({ ...more, available: 40 + 300 })).toBe(2);
    expect(fitCount({ ...more, available: 40 + 300 + 20 })).toBe(3);
    // With exactly the candidates connected the … is only needed when one is dropped.
    expect(fitCount({ ...base, available: 40 + 300 })).toBe(3);
    expect(fitCount({ ...base, available: 40 + 300 - 1 })).toBe(2);
  });

  it("always names one, even when it does not fit (the name is cut)", () => {
    expect(fitCount({ ...base, available: 10 })).toBe(1);
  });

  it("names none when there is no candidate", () => {
    expect(fitCount({ ...base, items: [], total: 0 })).toBe(0);
  });

  it("a card's candidates are at most three", () => {
    expect(CARD_NAMES).toBe(3);
  });
});

describe("how the field reads", () => {
  it("writes All N when every project of the workspace offers the agent", () => {
    expect(connectedTotal(12, 12)).toBe("All 12");
    expect(connectedTotal(8, 12)).toBe("8");
    expect(connectedTotal(0, 0)).toBe("0");
  });

  it("lists every project in the tooltip with its work sessions, and says so for none", () => {
    const ranked = rankConnected(["a", "b", "c"], counts(["b", 1], ["c", 7]), names);
    expect(connectedTitle(ranked, "claude-libra")).toBe(
      "Connected to 3, by work sessions in the last 90 days:\nGamma — 7 work sessions\nBeta — 1 work session\nAlpha\n\nOpen claude-libra's Projects tab",
    );
    expect(connectedTitle([], "codex")).toBe("Connected to no project. Open codex's Projects tab");
  });

  it("gives a project the same swatch every time, from the palette", () => {
    expect(projectTint("pomade-agents")).toBe(projectTint("pomade-agents"));
    expect(new Set(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map(projectTint)).size).toBeGreaterThan(2);
  });
});

describe("cutting a name", () => {
  const seven = (text: string): number => text.length * 7;

  it("keeps a name that fits, and ends a cut one in … right after its last letter", () => {
    expect(cutName("Pomade", 100, seven)).toBe("Pomade");
    expect(cutName("Translation-quality", 70, seven)).toBe("Translati…");
    expect(seven(cutName("Translation-quality", 70, seven))).toBeLessThanOrEqual(70);
    expect(cutName("Wiki gardening", 7 * 6, seven)).toBe("Wiki…");
  });

  it("leaves the … alone when not even one letter fits", () => {
    expect(cutName("Knowledge", 3, seven)).toBe("…");
  });
});
