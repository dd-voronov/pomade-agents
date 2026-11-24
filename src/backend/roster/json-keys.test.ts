import { describe, expect, it } from "vitest";

import { editJsonKeys, jsonObjectProblem, newJsonObject } from "./json-keys.ts";

const SETTINGS = `{
  "model": "opus",
  "effortLevel": "high",
  "permissions": {
    "allow": ["Bash(git status:*)"]
  }
}
`;

describe("editJsonKeys", () => {
  it("changes a key's value where it stands and nothing else", () => {
    expect(editJsonKeys(SETTINGS, { effortLevel: "low" })).toBe(SETTINGS.replace('"effortLevel": "high"', '"effortLevel": "low"'));
    expect(editJsonKeys(SETTINGS, { model: "sonnet" })).toBe(SETTINGS.replace('"model": "opus"', '"model": "sonnet"'));
  });

  it("adds a missing key after the last one, at its indentation, keeping the trailing newline", () => {
    const text = '{\n    "permissions": {\n        "deny": []\n    }\n}\n';
    expect(editJsonKeys(text, { effortLevel: "high" })).toBe('{\n    "permissions": {\n        "deny": []\n    },\n    "effortLevel": "high"\n}\n');
  });

  it("follows tab indentation, CRLF line ends and a file with no trailing newline", () => {
    expect(editJsonKeys('{\r\n\t"a": 1\r\n}', { model: "opus" })).toBe('{\r\n\t"a": 1,\r\n\t"model": "opus"\r\n}');
  });

  it("follows one-line objects and their spacing", () => {
    expect(editJsonKeys('{"a":1}', { model: "opus" })).toBe('{"a":1,"model":"opus"}');
    expect(editJsonKeys('{ "a": 1, "b": [1, 2] }\n', { model: "opus" })).toBe('{ "a": 1, "b": [1, 2], "model": "opus" }\n');
  });

  it("lays a new key out like the last member, not the first", () => {
    expect(editJsonKeys('{\n  "a": 1, "b": 2\n}\n', { c: "x" })).toBe('{\n  "a": 1, "b": 2, "c": "x"\n}\n');
  });

  it("fills an empty object on its own lines", () => {
    expect(editJsonKeys("{}\n", { model: "opus" })).toBe('{\n  "model": "opus"\n}\n');
    expect(editJsonKeys("{\n}\n", { model: "opus" })).toBe('{\n  "model": "opus"\n}\n');
  });

  it("removes a key with its separating comma, first, middle or last", () => {
    expect(editJsonKeys(SETTINGS, { model: null })).toBe(SETTINGS.replace('  "model": "opus",\n', ""));
    expect(editJsonKeys(SETTINGS, { effortLevel: null })).toBe(SETTINGS.replace('  "effortLevel": "high",\n', ""));
    const last = '{\n  "a": 1,\n  "model": "opus"\n}\n';
    expect(editJsonKeys(last, { model: null })).toBe('{\n  "a": 1\n}\n');
    expect(editJsonKeys('{"a":1,"model":"opus","b":2}', { model: null })).toBe('{"a":1,"b":2}');
  });

  it("removing the only key leaves an empty object", () => {
    expect(editJsonKeys('{\n  "model": "opus"\n}\n', { model: null })).toBe("{}\n");
  });

  it("removing an absent key changes nothing", () => {
    expect(editJsonKeys(SETTINGS, { other: null })).toBe(SETTINGS);
  });

  it("does not take a key of a nested object, or a key-like text inside a string, for a top-level key", () => {
    const text = '{\n  "env": { "model": "nested" },\n  "note": "\\"model\\": \\"x\\", {"\n}\n';
    const out = editJsonKeys(text, { model: "opus" });
    expect(out).toBe('{\n  "env": { "model": "nested" },\n  "note": "\\"model\\": \\"x\\", {",\n  "model": "opus"\n}\n');
    expect(JSON.parse(out)).toEqual({ env: { model: "nested" }, note: '"model": "x", {', model: "opus" });
    expect(editJsonKeys(out, { model: null })).toBe(text);
  });

  it("sets every copy of a repeated key, and removes them all", () => {
    const text = '{"model":"a","x":1,"model":"b"}';
    expect(editJsonKeys(text, { model: "c" })).toBe('{"model":"c","x":1,"model":"c"}');
    expect(editJsonKeys(text, { model: null })).toBe('{"x":1}');
  });

  it("writes values as JSON strings, escapes included", () => {
    expect(JSON.parse(editJsonKeys("{}", { model: 'a "quoted" \\ name' }))).toEqual({ model: 'a "quoted" \\ name' });
  });

  it("applies several changes in one go, and the result stays valid JSON", () => {
    const out = editJsonKeys(SETTINGS, { model: null, effortLevel: "xhigh" });
    expect(out).toBe(SETTINGS.replace('  "model": "opus",\n', "").replace('"high"', '"xhigh"'));
    expect(jsonObjectProblem(out)).toBeNull();
  });

  it("keeps numbers, literals and nested values of other keys byte for byte", () => {
    const text = '{\n  "n": -1.5e+3,\n  "t": true,\n  "z": null,\n  "list": [ {"a": "}"}, "]" ]\n}\n';
    expect(editJsonKeys(text, { model: "opus" })).toBe(text.replace('"]" ]\n}', '"]" ],\n  "model": "opus"\n}'));
  });
});

describe("jsonObjectProblem", () => {
  it("takes an object and refuses anything else", () => {
    expect(jsonObjectProblem("{}")).toBeNull();
    expect(jsonObjectProblem('{"a": [1]}\n')).toBeNull();
    expect(jsonObjectProblem("[]")).toBe("it is not a JSON object");
    expect(jsonObjectProblem("null")).toBe("it is not a JSON object");
    expect(jsonObjectProblem('{"a": 1,}')).toMatch(/^it is not valid JSON/);
    expect(jsonObjectProblem("")).toMatch(/^it is not valid JSON/);
  });
});

describe("newJsonObject", () => {
  it("holds just the keys set", () => {
    expect(newJsonObject({ model: "opus", effortLevel: null })).toBe('{\n  "model": "opus"\n}\n');
    expect(newJsonObject({ model: "opus", effortLevel: "high" })).toBe('{\n  "model": "opus",\n  "effortLevel": "high"\n}\n');
    expect(newJsonObject({ model: null })).toBe("{}\n");
  });
});
