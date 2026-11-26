// What the Model & modes tab shows and says, as pure functions: the model menu's choices, each
// mode's words, which modes an agent's profile enables, and the toasts of a change.

import { HostError } from "pomade-kit/sdk";

import { CLAUDE_MODEL_CHOICES } from "../../../shared/model-choices.ts";
import { MODE_IDS, type AgentProvider, type ModeId, type RosterEntry } from "../../../shared/roster.ts";

/** Each mode's name and what it does, per provider (ARCHITECTURE §3.5). */
export const MODE_TEXT: Record<ModeId, { label: string } & Record<AgentProvider, string>> = {
  normal: { label: "Normal", claude: "the agent’s own settings, no flags", codex: "default approvals" },
  "full-autonomy": { label: "Full autonomy", claude: "skips every permission prompt", codex: "bypasses approvals and the sandbox" },
};

export interface ModelChoice {
  /** The value written to `settings.json`'s `model`. */
  id: string;
  checked: boolean;
}

/** The default-model menu's models: the known ones, then the file's own when it names another. */
export function modelChoices(current: string | null): ModelChoice[] {
  const known = CLAUDE_MODEL_CHOICES.map((id) => ({ id, checked: id === current }));
  return current === null || (CLAUDE_MODEL_CHOICES as readonly string[]).includes(current) ? known : [...known, { id: current, checked: true }];
}

/** Whether the agent's profile enables `mode`; Normal is always on. `null` without a usable
 *  profile: the roster answers from first-sight values then, so the launch spec tells. */
export function modeEnabled(entry: RosterEntry, mode: ModeId): boolean | null {
  if (mode === "normal") return true;
  return entry.profile === null ? null : entry.profile.modes[mode]?.enabled === true;
}

/** The modes the page lists, in the roster's order. */
export const LISTED_MODES: readonly ModeId[] = MODE_IDS;

/** The config file as the user knows it: the profile's config folder as written, then the file's name. */
export function configFileLabel(configDir: string | undefined, file: string): string {
  const name = file.split("/").at(-1) ?? file;
  return configDir === undefined ? file : `${configDir.replace(/\/+$/, "")}/${name}`;
}

export const modelSavedText = (model: string | null): string =>
  model === null ? "settings.json: model removed — the provider’s default applies." : `settings.json: "model": "${model}".`;

export const effortSavedText = (effort: string): string => `settings.json: "effortLevel": "${effort}" — no other key changed.`;

export const modeSavedText = (mode: ModeId, agent: string, on: boolean): string =>
  on ? `${MODE_TEXT[mode].label} is offered for ${agent} again.` : `${MODE_TEXT[mode].label} is off for ${agent}: the “+” menu and Runner no longer offer it.`;

const CAUSES: Partial<Record<string, string>> = {
  "io-error": "The file could not be written, or it cannot be used as it is.",
  "not-ready": "Agent profiles are not kept right now.",
  "not-found": "The agent is no longer there.",
  "invalid-params": "The backend refused it.",
  "app-absent": "The app's backend is not running.",
  "app-not-responding": "The app's backend did not answer in time.",
};

/** What a refused change says: `text` in plain words, `reason` (the backend's own words) on hover. */
export function changeFailedText(what: "model" | "effort" | "mode", error: unknown): { text: string; reason: string } {
  const lead = what === "model" ? "The model was not changed." : what === "effort" ? "The effort was not changed." : "The mode was not switched.";
  const cause = (error instanceof HostError ? CAUSES[error.code] : undefined) ?? "Something went wrong.";
  const reason = (error instanceof Error ? error.message : String(error)).trim();
  return { text: `${lead} ${cause}`, reason: reason === "" ? cause : reason };
}
