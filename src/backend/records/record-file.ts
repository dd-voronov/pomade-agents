// The app's files in `<workspace>/Apps/pomade-agents/` as text (ARCHITECTURE §3.2, §4): a session
// record, `sessions/<id>.yaml`; an agent profile, `agents/<id>/agent.yaml`; and the app settings,
// `settings.yaml`.
//
// YAML through the `yaml` library: its document model rewrites a file key by key, so a record a
// person edited keeps their comments, their extra keys, their key order and their quoting on every
// later write of the app — only the keys whose values change are touched. Both kinds of file are
// read and rewritten the same way; only their keys and checks differ. Values are read with the
// YAML 1.2 core schema, so `updated: 2026-11-09T14:32:00Z` stays a string. A key with no value
// (`name:`) reads as absent, as does `false` for the flags that are only ever `true`.

import { isMap, parseDocument, stringify } from "yaml";

import { AGENT_PROFILE_KEYS, MODE_IDS, isAgentProfile, type AgentProfile } from "../../shared/roster.ts";
import { SESSION_RECORD_KEYS, isSessionRecord, type SessionRecord } from "../../shared/sessions.ts";

export type Parsed<T> = { ok: true; value: T } | { ok: false; problem: string };

export interface AppSettings {
  /** When the app's first run adopted the sessions that existed, ISO 8601; `null`: not yet. */
  adoptedAt: string | null;
}

const STRINGIFY = { lineWidth: 0 } as const;
const FLAGS: readonly string[] = ["projectOverride", "outsidePomade"];

/** The file's top-level mapping as plain values, or why it is not one. `orEmpty`: a file with no
 *  value at all (empty, or comments only) is an empty mapping. */
function readMapping(text: string, orEmpty = false): Parsed<Record<string, unknown>> {
  const doc = parseDocument(text);
  const [error] = doc.errors;
  if (error) return { ok: false, problem: `it is not valid YAML (${error.message.split("\n")[0] ?? ""})` };
  if (orEmpty && doc.contents === null) return { ok: true, value: {} };
  if (!isMap(doc.contents)) return { ok: false, problem: "it is not a mapping of keys to values" };
  return { ok: true, value: doc.toJS() as Record<string, unknown> };
}

/** The record's keys as the app reads them: known keys only, valueless ones and `false` flags left out. */
function recordValues(mapping: Record<string, unknown>): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const key of SESSION_RECORD_KEYS) {
    const value = mapping[key];
    if (value === null || value === undefined || (FLAGS.includes(key) && value === false)) continue;
    values[key] = value;
  }
  return values;
}

/** The record in `<id>.yaml`, or why the app cannot use it. */
export function parseRecord(id: string, text: string): Parsed<SessionRecord> {
  const mapping = readMapping(text);
  if (!mapping.ok) return mapping;
  const values = recordValues(mapping.value);
  if (values.id !== id) return { ok: false, problem: `its id is not ${JSON.stringify(id)}, the session its file name names` };
  for (const key of SESSION_RECORD_KEYS) {
    // Each key checked alone against a record otherwise well-formed, to name the one at fault.
    const probe: Record<string, unknown> = { id, provider: "codex", agent: "a", status: "active", [key]: values[key] };
    if (values[key] === undefined) delete probe[key];
    if (!isSessionRecord(probe)) return { ok: false, problem: `its ${key} is ${values[key] === undefined ? "missing" : "not valid"}` };
  }
  return isSessionRecord(values) ? { ok: true, value: values } : { ok: false, problem: "it is not a session record" };
}

/** A new record file: the keys in ARCHITECTURE §4's order. */
export function renderRecord(record: SessionRecord): string {
  const ordered: Record<string, unknown> = {};
  for (const key of SESSION_RECORD_KEYS) if (record[key] !== undefined) ordered[key] = record[key];
  return stringify(ordered, STRINGIFY);
}

/** `text` holding `next`: of `keys`, only those whose values differ from what `valuesOf` reads are
 *  set or removed; everything else in the file stays as it was. */
function rewriteKeys(text: string, keys: readonly string[], valuesOf: (mapping: Record<string, unknown>) => Record<string, unknown>, next: Record<string, unknown>): string {
  const doc = parseDocument(text);
  const current = valuesOf(doc.toJS() as Record<string, unknown>);
  for (const key of keys) {
    const value = next[key];
    if (JSON.stringify(current[key]) === JSON.stringify(value)) continue;
    if (value === undefined) doc.delete(key);
    else doc.set(key, value);
  }
  return doc.toString(STRINGIFY);
}

/** `text` (a record `parseRecord` accepts) holding `next`: only the keys whose values differ are
 *  set or removed; everything else in the file stays as it was. */
export function rewriteRecord(text: string, next: SessionRecord): string {
  return rewriteKeys(text, SESSION_RECORD_KEYS, recordValues, next);
}

/** The profile's keys as the app reads them: known keys only; valueless ones left out; `tags` and
 *  `hidden` default to none and `false`; of `modes`, only the known modes. */
function profileValues(mapping: Record<string, unknown>): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const key of AGENT_PROFILE_KEYS) {
    const value = mapping[key];
    if (value !== null && value !== undefined) values[key] = value;
  }
  values.tags ??= [];
  values.hidden ??= false;
  const modes = values.modes;
  if (typeof modes === "object" && modes !== null && !Array.isArray(modes)) {
    const known: Record<string, unknown> = {};
    for (const [id, mode] of Object.entries(modes)) if ((MODE_IDS as readonly string[]).includes(id)) known[id] = mode;
    values.modes = known;
  }
  return values;
}

/** The profile in `agents/<id>/agent.yaml`, or why the app cannot use it. */
export function parseProfile(id: string, text: string): Parsed<AgentProfile> {
  const mapping = readMapping(text);
  if (!mapping.ok) return mapping;
  const values = profileValues(mapping.value);
  if (values.id !== id) return { ok: false, problem: `its id is not ${JSON.stringify(id)}, the agent its folder names` };
  const sound: AgentProfile = { id, provider: "claude", kind: "folder", configDir: "a", command: "a", tags: [], hidden: false, modes: {} };
  for (const key of AGENT_PROFILE_KEYS) {
    // Each key checked alone against a profile otherwise well-formed, to name the one at fault.
    const probe: Record<string, unknown> = { ...sound, [key]: values[key] };
    if (values[key] === undefined) delete probe[key];
    if (!isAgentProfile(probe)) return { ok: false, problem: `its ${key} is ${values[key] === undefined ? "missing" : "not valid"}` };
  }
  return isAgentProfile(values) ? { ok: true, value: values } : { ok: false, problem: "it is not an agent profile" };
}

/** A new profile file: the keys in ARCHITECTURE §3.2's order. */
export function renderProfile(profile: AgentProfile): string {
  const ordered: Record<string, unknown> = {};
  for (const key of AGENT_PROFILE_KEYS) if (profile[key] !== undefined) ordered[key] = profile[key];
  return stringify(ordered, STRINGIFY);
}

/** `text` (a profile `parseProfile` accepts) holding `next`, changing only the keys whose values differ. */
export function rewriteProfile(text: string, next: AgentProfile): string {
  return rewriteKeys(text, AGENT_PROFILE_KEYS, profileValues, next);
}

export function parseSettings(text: string): Parsed<AppSettings> {
  const mapping = readMapping(text, true);
  if (!mapping.ok) return mapping;
  const { adoptedAt } = mapping.value;
  if (adoptedAt === undefined || adoptedAt === null) return { ok: true, value: { adoptedAt: null } };
  if (typeof adoptedAt !== "string" || Number.isNaN(Date.parse(adoptedAt))) return { ok: false, problem: "its adoptedAt is not a time" };
  return { ok: true, value: { adoptedAt } };
}

/** `settings.yaml`'s text (absent: `null`) with the first run's time set, everything else kept. */
export function settingsWithAdoptedAt(text: string | null, adoptedAt: string): string {
  if (text === null) return stringify({ adoptedAt }, STRINGIFY);
  const doc = parseDocument(text);
  doc.set("adoptedAt", adoptedAt);
  return doc.toString(STRINGIFY);
}
