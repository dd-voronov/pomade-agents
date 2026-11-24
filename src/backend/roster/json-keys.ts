// Setting and removing top-level string keys of a JSON object file in place (`settings.json`'s
// `model` and `effortLevel`): only the named keys' text changes. Every other key, the key order,
// the indentation, the spacing around `:` and the text after the closing brace (a trailing newline)
// stay as they were. A key is set where it stands; a new key goes after the last one, laid out like
// it (on its own line at its indentation, or inline); a removed key takes its separating comma with it.

/** Each key to set (a string) or remove (`null`). */
export type JsonKeyChanges = Readonly<Record<string, string | null>>;

interface Member {
  key: string;
  /** Where the member's key string starts. */
  keyStart: number;
  /** The text between the key and its value: `": "`, `":"`. */
  colon: string;
  valueStart: number;
  valueEnd: number;
}

interface TopObject {
  open: number;
  close: number;
  members: Member[];
}

const WS = /[ \t\n\r]/;

function skipWs(text: string, at: number): number {
  let i = at;
  while (i < text.length && WS.test(text.charAt(i))) i++;
  return i;
}

/** The end of the string literal starting at `at` (just past its closing quote). */
function stringEnd(text: string, at: number): number {
  let i = at + 1;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (ch === "\\") i += 2;
    else if (ch === '"') return i + 1;
    else i++;
  }
  throw new Error("an unterminated string");
}

/** The end of the JSON value starting at `at`. */
function valueEnd(text: string, at: number): number {
  const ch = text.charAt(at);
  if (ch === '"') return stringEnd(text, at);
  if (ch === "{" || ch === "[") {
    let depth = 0;
    let i = at;
    while (i < text.length) {
      const c = text.charAt(i);
      if (c === '"') {
        i = stringEnd(text, i);
        continue;
      }
      if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") {
        depth--;
        if (depth === 0) return i + 1;
      }
      i++;
    }
    throw new Error("an unclosed object or array");
  }
  let i = at;
  while (i < text.length && !/[,}\]\s]/.test(text.charAt(i))) i++;
  return i;
}

/** The top-level object's members, with where each one's parts stand. `text` is valid JSON whose value is an object. */
function topObject(text: string): TopObject {
  const open = skipWs(text, 0);
  const members: Member[] = [];
  let i = skipWs(text, open + 1);
  if (text.charAt(i) === "}") return { open, close: i, members };
  for (;;) {
    const keyStart = i;
    const keyEnd = stringEnd(text, keyStart);
    const key = JSON.parse(text.slice(keyStart, keyEnd)) as string;
    const valueStart = skipWs(text, text.indexOf(":", keyEnd) + 1);
    const end = valueEnd(text, valueStart);
    members.push({ key, keyStart, colon: text.slice(keyEnd, valueStart), valueStart, valueEnd: end });
    i = skipWs(text, end);
    if (text.charAt(i) === "}") return { open, close: i, members };
    i = skipWs(text, i + 1);
  }
}

/** Why `text` cannot be edited as a JSON object, or `null` when it can. */
export function jsonObjectProblem(text: string): string | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return `it is not valid JSON (${err instanceof Error ? err.message : String(err)})`;
  }
  return typeof value === "object" && value !== null && !Array.isArray(value) ? null : "it is not a JSON object";
}

/** A new file holding just the keys set, two-space indented, with a trailing newline. */
export function newJsonObject(changes: JsonKeyChanges): string {
  const set = Object.entries(changes).filter((entry): entry is [string, string] => entry[1] !== null);
  if (set.length === 0) return "{}\n";
  return `{\n${set.map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(",\n")}\n}\n`;
}

/** `text` (a JSON object: `jsonObjectProblem` is `null`) with `changes` applied, every other byte kept. */
export function editJsonKeys(text: string, changes: JsonKeyChanges): string {
  let out = text;
  for (const [key, value] of Object.entries(changes)) out = value === null ? removeKey(out, key) : setKey(out, key, value);
  return out;
}

function setKey(text: string, key: string, value: string): string {
  const { open, close, members } = topObject(text);
  const literal = JSON.stringify(value);
  const held = members.filter((m) => m.key === key);
  if (held.length > 0) {
    // Every copy of a repeated key gets the value, so the object reads the same whichever copy a reader takes.
    let out = text;
    for (const m of [...held].reverse()) out = out.slice(0, m.valueStart) + literal + out.slice(m.valueEnd);
    return out;
  }
  const last = members.at(-1);
  if (last === undefined) {
    const inner = text.slice(open + 1, close);
    const member = `${JSON.stringify(key)}: ${literal}`;
    return text.slice(0, open + 1) + (inner.includes("\n") || inner.trim() === "" ? `\n  ${member}\n` : member) + text.slice(close);
  }
  // Laid out like the last member: the same lead (a line break and indentation, or a space) and colon.
  const before = members.at(-2);
  const leadFrom = before === undefined ? open + 1 : text.indexOf(",", before.valueEnd) + 1;
  const lead = text.slice(leadFrom, last.keyStart);
  return `${text.slice(0, last.valueEnd)},${lead}${JSON.stringify(key)}${last.colon}${literal}${text.slice(last.valueEnd)}`;
}

function removeKey(text: string, key: string): string {
  let out = text;
  for (;;) {
    const { open, close, members } = topObject(out);
    const index = members.findIndex((m) => m.key === key);
    if (index === -1) return out;
    const member = members[index] as Member;
    const next = members[index + 1];
    const previous = members[index - 1];
    if (next !== undefined) out = out.slice(0, member.keyStart) + out.slice(next.keyStart);
    else if (previous !== undefined) out = out.slice(0, previous.valueEnd) + out.slice(member.valueEnd);
    else out = out.slice(0, open + 1) + out.slice(close);
  }
}
