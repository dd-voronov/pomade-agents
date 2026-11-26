// The name of a new agent (ARCHITECTURE §3.6): one word that is its folder `Agents/<name>/`, its shell
// alias and its name in the "+" menu. The rules here need nothing but the name, so the New agent
// page applies them as the user types and the backend applies them again before it writes; the
// folder and the shell are the backend's to check (`roster.checkName`).

/** Lowercase letters, digits and "-", a letter or digit first. */
const NAME_CHARACTERS = /^[a-z0-9][a-z0-9-]*$/;

/** The longest name: a folder, an alias and a "+" menu entry stay readable. */
export const AGENT_NAME_MAX = 64;

/** The word the New agent page's route takes (`roster/new`), so it never names an agent. */
export const NEW_AGENT_WORD = "new";

/** Why a name cannot be had, in the order the checks run:
 *  - `empty` — no name yet
 *  - `leading-dash` — starts with "-", which the alias would read as an option
 *  - `characters` — anything but lowercase letters, digits and "-"
 *  - `too-long` — longer than `AGENT_NAME_MAX`
 *  - `reserved` — `new` (the New agent page's route) or a name with "template" in it (the agent
 *    scan skips such folders, so the agent would never be listed)
 *  - `folder` — `Agents/<name>` exists, or a Create of the name is running
 *  - `agent` — the roster holds an agent of that id (a built-in, a profile whose folder is elsewhere)
 *  - `shell` — `zsh -ilc` resolves the name: an alias, function, builtin or command
 *  - `shell-error` — zsh could not be asked (missing, or no answer in time) */
export type NameProblem = "empty" | "leading-dash" | "characters" | "too-long" | "reserved" | "folder" | "agent" | "shell" | "shell-error";

/** The problems `nameRuleProblem` finds without the disk or the shell. */
export type NameRuleProblem = Extract<NameProblem, "empty" | "leading-dash" | "characters" | "too-long" | "reserved">;

/** What the name alone rules out; `null` when the name passes its rules. */
export function nameRuleProblem(name: string): NameRuleProblem | null {
  if (name === "") return "empty";
  if (name.startsWith("-")) return "leading-dash";
  if (!NAME_CHARACTERS.test(name)) return "characters";
  if (name.length > AGENT_NAME_MAX) return "too-long";
  if (name === NEW_AGENT_WORD || name.includes("template")) return "reserved";
  return null;
}
