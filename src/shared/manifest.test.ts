// The manifest is the single source of the app's id, version and API list; these checks keep the
// package and the code in step with it.

import { readFileSync } from "node:fs";

import { parseManifest } from "pomade-kit/protocol";
import { describe, expect, it } from "vitest";

import { createApi } from "../backend/interfaces/api.ts";
import { API_METHODS } from "./api.ts";

const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const raw = read("../../public/manifest.json");

describe("manifest.json", () => {
  it("is a valid Host API manifest for a with-Pomade app with one panel icon", () => {
    const parsed = parseManifest(raw);
    if (!parsed.ok) throw new Error(parsed.errors.map((e) => e.message).join("; "));
    expect(parsed.manifest).toMatchObject({
      id: "pomade-agents",
      name: "Agents",
      hostApi: 0,
      strip: [{ id: "agents", title: "Agents", action: "panel", route: "" }],
      backend: { entry: "backend/main.mjs", mode: "with-pomade" },
    });
    expect(parsed.unsupportedKeys).toEqual(["outsideWorkspace"]);
  });

  it("carries the package's version", () => {
    expect((raw as { version: string }).version).toBe((read("../../package.json") as { version: string }).version);
  });

  it("declares exactly the API methods the backend serves", () => {
    const api = (raw as { api: string[] }).api;
    expect(api).toEqual([...API_METHODS]);
    const info = { version: "0", startedAt: "", workspace: null, dataDir: null, stateDir: "/s" };
    expect(Object.keys(createApi(info))).toEqual(api);
  });
});
