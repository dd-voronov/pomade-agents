import { describe, expect, it } from "vitest";

import { DEFAULT_SKILL_FOLDERS } from "../../shared/skills.ts";
import { checkFolderList, normalizeFolder, readSkillFolders, settingsWithSkillFolders } from "./skill-folders.ts";

const WS = "/ws/link";
const WS_REAL = "/ws/real";
const ROOTS = [WS, WS_REAL];

describe("readSkillFolders", () => {
  it("is the default folders with no file, an empty file, comments only, or no skillFolders key", () => {
    for (const text of [null, "", "# nothing yet\n", "adoptedAt: 2026-11-17T10:00:00.000Z\n", "skillFolders:\n"]) {
      expect(readSkillFolders(text)).toEqual({ ok: true, value: [...DEFAULT_SKILL_FOLDERS] });
    }
  });

  it("is the listed folders, trimmed and without a trailing slash; an empty list is no folders", () => {
    expect(readSkillFolders("skillFolders:\n  - Agents/_shared/skills/\n  - ' Projects/kit/skills '\n")).toEqual({ ok: true, value: ["Agents/_shared/skills", "Projects/kit/skills"] });
    expect(readSkillFolders("skillFolders: []\n")).toEqual({ ok: true, value: [] });
  });

  it("names what is wrong with a file it cannot use", () => {
    expect(readSkillFolders("skillFolders: [").ok).toBe(false);
    expect(readSkillFolders("- a\n")).toEqual({ ok: false, problem: "it is not a mapping of keys to values" });
    expect(readSkillFolders("skillFolders: Agents\n")).toEqual({ ok: false, problem: "its skillFolders is not a list of folders" });
    expect(readSkillFolders("skillFolders: [a, 3]\n")).toEqual({ ok: false, problem: "its skillFolders is not a list of folders" });
    expect(readSkillFolders("skillFolders: [a, '  ']\n")).toEqual({ ok: false, problem: "its skillFolders is not a list of folders" });
  });
});

describe("settingsWithSkillFolders", () => {
  it("writes a new file with the list", () => {
    expect(settingsWithSkillFolders(null, ["a/b", "c"])).toBe("skillFolders:\n  - a/b\n  - c\n");
    expect(settingsWithSkillFolders("", [])).toBe("skillFolders: []\n");
  });

  it("keeps the file's other keys, comments and order, changing only the list", () => {
    const text = "# my settings\nadoptedAt: 2026-11-17T10:00:00.000Z # first run\nskillFolders:\n  - a # the shared ones\n  - b\nother: 1\n";
    const next = settingsWithSkillFolders(text, ["a", "b", "c"]);
    expect(next).toContain("# my settings\nadoptedAt: 2026-11-17T10:00:00.000Z # first run\n");
    expect(next).toContain("other: 1\n");
    expect(readSkillFolders(next)).toEqual({ ok: true, value: ["a", "b", "c"] });
    expect(next.indexOf("skillFolders")).toBeLessThan(next.indexOf("other"));
    expect(settingsWithSkillFolders("# mine\nadoptedAt: x\n", ["a"])).toBe("# mine\nadoptedAt: x\nskillFolders:\n  - a\n");
  });
});

describe("normalizeFolder", () => {
  it.each([
    ["Agents/_shared/skills", "Agents/_shared/skills"],
    ["Agents/_shared/skills/", "Agents/_shared/skills"],
    ["./Agents//x/../skills", "Agents/skills"],
    [`${WS}/Projects/kit/skills`, "Projects/kit/skills"],
    [`${WS_REAL}/Projects/kit`, "Projects/kit"],
  ])("takes %s as %s", (input, folder) => {
    expect(normalizeFolder(input, ROOTS)).toEqual({ ok: true, folder });
  });

  it.each([
    ["/elsewhere/skills", "It is outside the workspace: the catalog reads folders inside it."],
    ["/ws/linked/skills", "It is outside the workspace: the catalog reads folders inside it."],
    ["../outside", "It is outside the workspace: the catalog reads folders inside it."],
    ["Agents/../../outside", "It is outside the workspace: the catalog reads folders inside it."],
    ["", "It is not a folder path."],
    [".", "That is the whole workspace: pick a folder inside it."],
    [WS, "That is the whole workspace: pick a folder inside it."],
    [".pomade/skills", "It is Pomade's own folder."],
    [".Pomade", "It is Pomade's own folder."],
  ])("refuses %s", (input, reason) => {
    expect(normalizeFolder(input, ROOTS)).toEqual({ ok: false, reason });
  });
});

describe("checkFolderList", () => {
  it("normalizes every folder in order", () => {
    expect(checkFolderList(["a/", `${WS}/b`], ROOTS)).toEqual({ ok: true, folders: ["a", "b"] });
    expect(checkFolderList([], ROOTS)).toEqual({ ok: true, folders: [] });
  });

  it("refuses a folder listed twice, inside a listed one, or around one", () => {
    expect(checkFolderList(["a", "a/"], ROOTS)).toEqual({ ok: false, folder: "a/", reason: "It is listed already." });
    expect(checkFolderList(["a", "a/b"], ROOTS)).toEqual({ ok: false, folder: "a/b", reason: "It is inside a, which is read with its subfolders." });
    expect(checkFolderList(["a/b", "a"], ROOTS)).toEqual({ ok: false, folder: "a", reason: "It holds a/b, which is listed: remove that one first." });
    expect(checkFolderList(["ab", "a"], ROOTS)).toEqual({ ok: true, folders: ["ab", "a"] });
  });

  it("names the first folder it cannot take", () => {
    expect(checkFolderList(["a", "/elsewhere", "../b"], ROOTS)).toMatchObject({ ok: false, folder: "/elsewhere" });
  });
});
