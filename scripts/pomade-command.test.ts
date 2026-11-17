import { describe, expect, it } from "vitest";

import { findPomadeCommand } from "./pomade-command.ts";

const only = (...paths: string[]) => (path: string): boolean => paths.includes(path);

describe("findPomadeCommand", () => {
  it("prefers POMADE_BIN, and reports nothing when it names no file", () => {
    expect(findPomadeCommand({ POMADE_BIN: "/x/pomade", PATH: "/a" }, "/ws/pomade-agents", only("/x/pomade", "/a/pomade"))).toBe("/x/pomade");
    expect(findPomadeCommand({ POMADE_BIN: "/x/pomade", PATH: "/a" }, "/ws/pomade-agents", only("/a/pomade"))).toBeNull();
  });

  it("takes the first pomade on PATH, else the sibling checkout's", () => {
    const sibling = "/ws/Pomade/bin/pomade";
    expect(findPomadeCommand({ PATH: "/a:/b" }, "/ws/pomade-agents", only("/b/pomade", sibling))).toBe("/b/pomade");
    expect(findPomadeCommand({ PATH: "/a:/b" }, "/ws/pomade-agents", only(sibling))).toBe(sibling);
    expect(findPomadeCommand({}, "/ws/pomade-agents", only())).toBeNull();
  });
});
