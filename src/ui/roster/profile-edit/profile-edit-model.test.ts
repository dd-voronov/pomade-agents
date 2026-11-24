import { HostError } from "pomade-kit/sdk";
import { describe, expect, it } from "vitest";

import { failureText, oneLine, roleToSave, tagsFull, tagsOf, withTags, withoutTag } from "./profile-edit-model.ts";

describe("roleToSave", () => {
  it("sends the new role as one line", () => {
    expect(roleToSave("  Reviews\n  code.  ", "Old.")).toBe("Reviews code.");
    expect(roleToSave("New.", undefined)).toBe("New.");
  });

  it("sends null for an emptied field, and nothing when the saved role stays", () => {
    expect(roleToSave("   ", "Old.")).toBeNull();
    expect(roleToSave("Old.", "Old.")).toBeUndefined();
    expect(roleToSave(" Old. ", "Old.")).toBeUndefined();
    expect(roleToSave("", undefined)).toBeUndefined();
  });
});

describe("tags", () => {
  it("splits an entry at commas, lower-cases it and drops the empty", () => {
    expect(tagsOf(" Vault, Knowledge ,, ")).toEqual(["vault", "knowledge"]);
    expect(tagsOf("   ")).toEqual([]);
  });

  it("cuts a tag at the limit", () => {
    expect(tagsOf("x".repeat(30))).toEqual(["x".repeat(24)]);
  });

  it("adds only the tags the list lacks, once each, and keeps the same list when it adds none", () => {
    const tags = ["vault"];
    expect(withTags(tags, "Vault, new, new, other")).toEqual(["vault", "new", "other"]);
    expect(withTags(tags, "vault")).toBe(tags);
    expect(withTags(tags, " ")).toBe(tags);
  });

  it("adds no tag past the 20th", () => {
    const nineteen = Array.from({ length: 19 }, (_, i) => `t${i}`);
    const full = withTags(nineteen, "a, b, c");
    expect(full).toEqual([...nineteen, "a"]);
    expect(tagsFull(full)).toBe(true);
    expect(withTags(full, "d")).toBe(full);
  });

  it("removes one tag", () => {
    expect(withoutTag(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });
});

describe("failureText", () => {
  it("names what was not saved and why, in the code's plain words", () => {
    expect(failureText("role", new HostError("io-error", "EACCES"))).toEqual({ text: "The role line was not saved. agent.yaml could not be written, or it cannot be used as it is.", reason: "EACCES" });
    expect(failureText("tags", new HostError("app-absent", "")).text).toBe("The tags were not saved. The app's backend is not running.");
  });

  it("says something went wrong for any other error", () => {
    expect(failureText("tags", new Error("boom"))).toEqual({ text: "The tags were not saved. Something went wrong.", reason: "boom" });
  });

  it("collapses line breaks like a role line does", () => {
    expect(oneLine("a\n\tb")).toBe("a b");
  });
});
