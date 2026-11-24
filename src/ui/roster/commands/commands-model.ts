// What an agent's actions offer, the same on a card, a list row and the agent's page (DESIGN §3.3,
// §3.4): the modes and projects of Start session ▾, whether it can start one at all, and the words
// the toasts say.

import { providerModes, type ProjectRef } from "pomade-kit/protocol";

import { MODE_IDS, type ModeId, type RosterEntry } from "../../../shared/roster.ts";

export type LaunchMode = { id: ModeId; name: string };

/** The modes Start session offers, in the roster's order: the profile's enabled ones — both when no
 *  usable profile answers, since first sight enables both. Normal always. */
export function launchModes(entry: RosterEntry): LaunchMode[] {
  const enabled = entry.profile === null ? MODE_IDS : MODE_IDS.filter((id) => id === "normal" || entry.profile?.modes[id]?.enabled === true);
  return providerModes(entry.provider)
    .filter((mode) => (enabled as readonly string[]).includes(mode.id))
    .map((mode) => ({ id: mode.id as ModeId, name: mode.name }));
}

/** Start session's projects: the connected ones, then the others, each in the Projects panel's order. */
export function launchTargets(connected: readonly string[], projects: ReadonlyMap<string, ProjectRef>): { connected: ProjectRef[]; others: ProjectRef[] } {
  const on = new Set(connected);
  const all = [...projects.values()];
  return { connected: all.filter((p) => on.has(p.id)), others: all.filter((p) => !on.has(p.id)) };
}

/** Why Start session is off for the agent; `null` when it can start one. Pomade launches only agents
 *  its "+" menu offers (`roster.list`), so not a hidden agent or an orphan. */
export function cannotStart(entry: RosterEntry, profilesOff: string | null): string | null {
  if (profilesOff !== null) return "No workspace is open";
  if (entry.orphan) return "Its config folder is gone";
  if (entry.hidden) return "Hidden from the “+” menu: show it there to start a session";
  return null;
}

/** The toast after Hide or Show. */
export function hiddenText(name: string, hidden: boolean): string {
  return hidden ? `${name} is hidden from Pomade’s “+” menu.` : `${name} is back in Pomade’s “+” menu.`;
}

/** The toast after a Re-link. */
export function relinkedText(name: string, configDir: string): string {
  return `${name} now points at ${configDir}. It is back in the “+” menu.`;
}

/** The toast after a re-link's Undo. */
export function relinkUndoneText(name: string, configDir: string): string {
  return `Re-link taken back: ${name} is an orphan again, ${configDir} an agent of its own.`;
}

/** The toast after a Remove. */
export function removedText(name: string): string {
  return `${name}’s profile is removed. No agent folder was touched.`;
}

const CAUSES: Record<string, string> = {
  "not-found": "Pomade does not know the agent, or its command is not found.",
  "invalid-params": "Pomade refused the request.",
  "not-ready": "No workspace is open.",
  "io-error": "A file could not be written.",
  "app-absent": "The app’s background part is not running.",
  "app-not-responding": "The app’s background part does not answer.",
};

/** A refused action's toast: what was not done and, by the error's code, why. */
export function refusedText(what: string, code: string | null): string {
  return `${what} ${(code === null ? undefined : CAUSES[code]) ?? "Something went wrong."}`;
}
