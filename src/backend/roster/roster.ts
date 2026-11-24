// The roster (DESIGN §3.1, §3.2): every agent and its profile, kept current as agent folders,
// profiles, Pomade's overrides and the providers' configs change.
//
// - **Agents** are the built-ins `claude` and `codex` and the folder agents (`folderAgentNames`),
//   plus every profile in `agents/` — an agent whose folder is gone keeps its profile.
// - **First sight** writes an agent's `agent.yaml` from its first-sight values (`first-sight.ts`)
//   when it has no file, and never over one: a file that is there, usable or not, is left as it is.
//   A folder some profile already names as its `configDir` is that profile's agent, not a new one.
// - **Orphans**: a folder agent's profile whose `configDir` is gone. A built-in is never an orphan.
//   An orphan is re-linked to an unclaimed agent folder — one no profile has made its own: none
//   names it but the first-sight profile written when the folder appeared, still as written (a
//   folder renamed outside the app gets that profile within a tick) — or its profile is removed.
// - **What answers**: an agent's profile when it is usable; else, for an agent the scan finds
//   (or with no workspace open, so no profiles), its first-sight values.
// - **Changes**: a profile changed on disk is seen at once (the record store's watch); folders,
//   `.pomade/agents.json` and the providers' configs every `TICK_MS`. Every change of the answer
//   is a new revision and a `roster.changed` notice.

import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { providerModes, type RosterAgent } from "pomade-kit/protocol";
import { HostError } from "pomade-kit/sdk";

import {
  MODE_IDS,
  type AgentMemory,
  type AgentModelConfig,
  type AgentPermissions,
  type AgentProfile,
  type ModeId,
  type RosterAgentsAnswer,
  type RosterChanged,
  type RelinkUndo,
  type RosterEntry,
  type UnclaimedFolder,
} from "../../shared/roster.ts";
import { RecordError, type FileSet } from "../records/record-store.ts";
import { isRecordId } from "../sessions/rules.ts";
import { AGENTS_FOLDER, folderAgentNames } from "../stores/roots.ts";
import { readMemory, readPermissions } from "./agent-files.ts";
import { editedProfile, type ProfileEdit } from "./profile-edit.ts";
import { BUILTIN_IDS, NO_OVERRIDES, agentName, builtinProfile, folderProfile, readPomadeOverrides } from "./first-sight.ts";
import { modelDefaults } from "./provider-config.ts";
import { ModelWriteError, readModelConfig, writeModelConfig, type ModelChange } from "./model-config.ts";

/** How often folders, overrides and provider configs are read again. */
export const TICK_MS = 2000;
/** How long profile changes gather before the roster is read again. */
const SETTLE_MS = 40;

export interface RosterOptions {
  /** The home folder (`~`); `null` when unknown. */
  home: string | null;
  /** The open workspace; `null` when none is open. */
  workspace: string | null;
  /** The profiles on disk; `null` when none are kept (no workspace, or the data folder cannot be read). */
  profiles: FileSet<AgentProfile> | null;
  /** Why no profiles are kept, when `profiles` is `null`. */
  noProfiles: string;
  log: (line: string) => void;
  tickMs?: number;
}

/** An agent as launches and connections see it: the profile that answers for it, and whether it is an orphan. */
export interface RosterAgentFacts {
  profile: AgentProfile;
  orphan: boolean;
}

export interface Roster {
  /** Every agent, hidden ones and orphans included (`roster.agents`). */
  answer(): RosterAgentsAnswer;
  /** The agents Pomade's "+" menu offers (`roster.list`): neither hidden nor orphans. */
  list(): RosterAgent[];
  /** The agent `id`, when the roster has an answering profile for it. */
  agent(id: string): RosterAgentFacts | undefined;
  /** Apply `edit` to the agent's `agent.yaml` (only the keys it names change) and answer the profile as written.
   *  Rejects with `HostError`: `not-ready` (no profiles are kept), `not-found` (no such agent, or an orphan),
   *  `io-error` (the file cannot be used or written). */
  updateProfile(id: string, edit: ProfileEdit): Promise<AgentProfile>;
  /** The agent's permissions, MCP servers and plugins as its provider config says; `not-found` for an unknown agent or an orphan. */
  permissions(id: string): Promise<AgentPermissions>;
  /** The project memory the agent keeps; `not-found` as `permissions`. */
  memory(id: string): Promise<AgentMemory>;
  /** The agent's default model and effort as its provider config holds them; `not-found` as `permissions`. */
  modelConfig(id: string): Promise<AgentModelConfig>;
  /** Write the agent's default model and effort (Claude Code's `settings.json`, only those keys) and answer the config as written;
   *  the roster is read again before it resolves. Rejects with `HostError`: `not-ready` (no profiles are kept), `not-found` as
   *  `permissions`, `invalid-params` (a Codex
   *  agent), `io-error` (the file cannot be used or written). */
  setModel(id: string, change: ModelChange): Promise<AgentModelConfig>;
  /** The agent folders an orphan can be re-linked to, by name; none when no profiles are kept. */
  unclaimedFolders(): Promise<UnclaimedFolder[]>;
  /** Point the orphan `id`'s profile at the unclaimed agent folder `folder` (its name under `Agents/`) and remove
   *  that folder's first-sight profile; answers the profile as written and what takes it back, the roster read again. Rejects with
   *  `HostError`: `not-ready` (no profiles are kept), `not-found` (no such agent), `invalid-params` (not an orphan,
   *  or the folder is not unclaimed), `io-error` (a file cannot be written or removed). */
  relink(id: string, folder: string): Promise<{ profile: AgentProfile; undo: RelinkUndo }>;
  /** Take a re-link back: the agent's profile, then the folder's removed one, written back as their files held them;
   *  the roster read again, as before the re-link. Rejects with `HostError`: `not-ready`, `not-found` (no
   *  such agent), `invalid-params` (the agent no longer names the folder, or the text is not the folder's profile),
   *  `io-error`. */
  undoRelink(undo: RelinkUndo): Promise<AgentProfile>;
  /** Remove the orphan `id`'s profile (its `agent.yaml`, and its folder when nothing else is in it) — never an
   *  agent folder; the roster read again. Rejects with `HostError`: `not-ready`, `not-found`, `invalid-params`
   *  (not an orphan), `io-error`. */
  removeOrphan(id: string): Promise<void>;
  /** Read everything again now; resolves when the answer is current. */
  refresh(): Promise<void>;
  onChange(listener: (changed: RosterChanged) => void): () => void;
  stop(): void;
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** A profile's `configDir`, absolute: `~/…` under the home folder, a relative one under the workspace. */
export function resolveConfigDir(configDir: string, home: string | null, workspace: string | null): string | null {
  if (configDir === "~") return home;
  if (configDir.startsWith("~/")) return home === null ? null : join(home, configDir.slice(2));
  if (isAbsolute(configDir)) return configDir;
  return workspace === null ? null : join(workspace, configDir);
}

/** A profile as first sight would write it again: the keys that tell an untouched profile from an edited one. */
const sightKey = (p: AgentProfile): string =>
  JSON.stringify([p.id, p.provider, p.kind, p.configDir, p.command, p.role ?? null, p.tags, p.hidden, MODE_IDS.map((id) => p.modes[id]?.enabled === true)]);

/** The modes a profile enables, in the roster's order. */
export const enabledModes = (profile: AgentProfile): ModeId[] => MODE_IDS.filter((id) => profile.modes[id]?.enabled === true);

const order = (a: string, b: string): number => {
  const builtin = (id: string): number => (BUILTIN_IDS.includes(id) ? BUILTIN_IDS.indexOf(id) : BUILTIN_IDS.length);
  return builtin(a) - builtin(b) || a.localeCompare(b);
};

interface Built {
  entries: RosterEntry[];
  /** The profile answering for each agent that has one, and whether it is an orphan. */
  facts: Map<string, RosterAgentFacts>;
}

export function startRoster(options: RosterOptions): Roster {
  const { home, workspace, profiles, noProfiles, log } = options;
  const epoch = randomUUID();
  let revision = 0;
  let built: Built = { entries: [], facts: new Map() };
  let last = "";
  const listeners = new Set<(changed: RosterChanged) => void>();
  /** First-sight writes in flight, by agent id. */
  const creating = new Set<string>();
  /** Agent folders whose names cannot name a profile, logged once. */
  const unnamable = new Set<string>();

  const resolve = (configDir: string): string | null => resolveConfigDir(configDir, home, workspace);

  const build = async (): Promise<Built> => {
    const overrides = workspace === null ? NO_OVERRIDES : await readPomadeOverrides(workspace, log);
    const folders = workspace === null ? [] : (await folderAgentNames(workspace)).filter((name) => !BUILTIN_IDS.includes(name));
    for (const name of folders) {
      if (isRecordId(name) || unnamable.has(name)) continue;
      unnamable.add(name);
      log(`roster: the agent folder ${JSON.stringify(name)} cannot name a profile; it is left out`);
    }
    const seen = new Map<string, AgentProfile>();
    for (const id of BUILTIN_IDS) seen.set(id, builtinProfile(id, overrides));
    const usable = (id: string): AgentProfile | null => profiles?.get(id)?.value ?? null;
    /** The folders the profiles name, absolute: a folder named by a profile of another id is that agent's. */
    const claimed = new Map<string, string>();
    for (const id of profiles?.ids() ?? []) {
      const profile = usable(id);
      const dir = profile === null ? null : resolve(profile.configDir);
      if (dir !== null) claimed.set(dir, id);
    }
    for (const name of folders.filter(isRecordId)) {
      const owner = workspace === null ? undefined : claimed.get(join(workspace, AGENTS_FOLDER, name));
      if (owner !== undefined && owner !== name) continue;
      // First-sight values are needed only where no usable profile answers (its CLAUDE.md is read then).
      seen.set(name, usable(name) ?? (await folderProfile(workspace ?? "", name, overrides)));
    }

    if (profiles !== null) {
      for (const [id, profile] of seen) {
        if (profiles.get(id) !== undefined || creating.has(id)) continue;
        creating.add(id);
        profiles
          .create(profile)
          .catch((err: unknown) => log(`roster: could not write the profile of ${id}: ${message(err)}`))
          .finally(() => creating.delete(id));
      }
    }

    const ids = [...new Set([...seen.keys(), ...(profiles?.ids() ?? [])])].sort(order);
    const entries: RosterEntry[] = [];
    const facts = new Map<string, RosterAgentFacts>();
    for (const id of ids) {
      const held = profiles?.get(id);
      const profile = held?.value ?? null;
      const answering = profile ?? seen.get(id) ?? null;
      const configDir = answering === null ? null : resolve(answering.configDir);
      const orphan = answering !== null && answering.kind === "folder" && (configDir === null || !(await isFolder(configDir)));
      const defaults = answering === null || orphan ? { model: null, effort: null } : await modelDefaults(answering.provider, configDir);
      entries.push({
        id,
        name: agentName(id),
        profile,
        problem: held?.problem ?? null,
        orphan,
        configDir: profile === null ? null : configDir,
        ...defaults,
        provider: answering?.provider ?? "claude",
        kind: answering?.kind ?? "folder",
        hidden: answering?.hidden ?? false,
      });
      if (answering !== null) facts.set(id, { profile: answering, orphan });
    }
    return { entries, facts };
  };

  /** The agent `id`'s facts as the roster reads them now, when it is an orphan whose profile can be written. */
  const orphanAgent = async (id: string): Promise<RosterAgentFacts> => {
    if (profiles === null) throw new HostError("not-ready", noProfiles);
    await refresh();
    const facts = built.facts.get(id);
    if (facts === undefined) throw new HostError("not-found", `No agent ${JSON.stringify(id)} in the roster`);
    if (!facts.orphan) throw new HostError("invalid-params", `${id} is not an orphan: its config folder is there`);
    return facts;
  };

  const writeFailed = (err: unknown): HostError =>
    err instanceof RecordError ? new HostError(err.kind === "missing" ? "not-found" : "io-error", err.message) : new HostError("io-error", message(err));

  const unclaimedFolders = async (): Promise<UnclaimedFolder[]> => {
    if (profiles === null || workspace === null) return [];
    const overrides = await readPomadeOverrides(workspace, log);
    const folders = (await folderAgentNames(workspace)).filter((name) => !BUILTIN_IDS.includes(name) && isRecordId(name));
    const named = new Map<string, string[]>();
    for (const id of profiles.ids()) {
      const profile = profiles.get(id)?.value ?? null;
      const dir = profile === null ? null : resolve(profile.configDir);
      if (dir !== null) named.set(dir, [...(named.get(dir) ?? []), id]);
    }
    const unclaimed: UnclaimedFolder[] = [];
    for (const name of folders) {
      if ((named.get(join(workspace, AGENTS_FOLDER, name)) ?? []).some((id) => id !== name)) continue;
      const own = profiles.get(name);
      // A profile of its own that is unusable, or no longer its first-sight one, makes the folder its agent's.
      if (own !== undefined && (own.value === null || sightKey(own.value) !== sightKey(await folderProfile(workspace, name, overrides)))) continue;
      unclaimed.push({ name, configDir: `${AGENTS_FOLDER}/${name}` });
    }
    return unclaimed;
  };

  /** The agent `id`'s facts; `not-found` for an agent the roster does not hold and for an orphan. */
  const livingAgent = (id: string): RosterAgentFacts => {
    const facts = built.facts.get(id);
    if (facts === undefined || facts.orphan) throw new HostError("not-found", `No agent ${JSON.stringify(id)} in the roster`);
    return facts;
  };

  // ── Reading again ────────────────────────────────────────────────────────

  let running: Promise<void> | null = null;
  /** Counts the asks: a pass that started before the latest ask runs once more. */
  let asked = 0;
  let stopped = false;

  const pass = async (): Promise<void> => {
    const next = await build();
    built = next;
    const text = JSON.stringify(next.entries);
    if (text === last) return;
    last = text;
    revision++;
    const changed = { epoch, revision };
    for (const listener of listeners) listener(changed);
  };

  const refresh = (): Promise<void> => {
    asked++;
    running ??= (async () => {
      for (;;) {
        const seen = asked;
        try {
          await pass();
        } catch (err) {
          log(`roster: could not read the roster: ${message(err)}`);
        }
        if (seen === asked || stopped) break;
      }
      running = null;
    })();
    return running;
  };

  let settleTimer: NodeJS.Timeout | null = null;
  const unsubscribe = profiles?.onChange(() => {
    settleTimer ??= setTimeout(() => {
      settleTimer = null;
      void refresh();
    }, SETTLE_MS);
  });
  const tick = setInterval(() => void refresh(), options.tickMs ?? TICK_MS);
  void refresh();

  return {
    answer: () => ({ epoch, revision, agents: built.entries, profilesOff: profiles === null ? noProfiles : null }),

    list() {
      const agents: RosterAgent[] = [];
      for (const entry of built.entries) {
        const facts = built.facts.get(entry.id);
        if (facts === undefined || facts.orphan || facts.profile.hidden) continue;
        const { profile } = facts;
        const enabled = enabledModes(profile);
        const configDir = resolve(profile.configDir);
        agents.push({
          id: entry.id,
          name: entry.name,
          command: profile.command,
          provider: profile.provider,
          ...(configDir === null ? {} : { configDir }),
          modes: providerModes(profile.provider).filter((mode) => (enabled as string[]).includes(mode.id)),
        });
      }
      return agents;
    },

    agent: (id) => built.facts.get(id),

    async updateProfile(id, edit) {
      if (profiles === null) throw new HostError("not-ready", noProfiles);
      const { profile } = livingAgent(id);
      try {
        // An agent the scan found whose first-sight write has not landed yet gets its file first.
        if (profiles.get(id) === undefined) await profiles.create(profile);
        const written = await profiles.update(id, (current) => editedProfile(current, edit));
        await refresh();
        return written;
      } catch (err) {
        throw writeFailed(err);
      }
    },

    unclaimedFolders,

    async relink(id, folder) {
      await orphanAgent(id);
      if (!(await unclaimedFolders()).some((f) => f.name === folder)) {
        throw new HostError("invalid-params", `${AGENTS_FOLDER}/${folder} is not an unclaimed agent folder`);
      }
      // `profiles` is kept: `orphanAgent` refused otherwise.
      const kept = profiles as FileSet<AgentProfile>;
      try {
        const agentText = kept.text(id);
        if (agentText === null) throw new HostError("io-error", `The profile of ${id} could not be read`);
        const written = await kept.update(id, (current) => ({ ...current, configDir: `${AGENTS_FOLDER}/${folder}` }));
        // The folder is this agent's now: the profile first sight gave it goes.
        const profileText = kept.get(folder) === undefined ? null : await kept.remove(folder);
        await refresh();
        return { profile: written, undo: { agent: id, agentText, folder, profileText } };
      } catch (err) {
        throw writeFailed(err);
      }
    },

    async undoRelink({ agent, agentText, folder, profileText }) {
      if (profiles === null) throw new HostError("not-ready", noProfiles);
      const linked = `${AGENTS_FOLDER}/${folder}`;
      const before = profiles.text(agent);
      if (profiles.get(agent)?.value?.configDir !== linked || before === null) throw new HostError("invalid-params", `${agent} no longer names ${linked}: nothing to take back`);
      try {
        await profiles.restore(agent, agentText);
      } catch (err) {
        throw err instanceof RecordError && err.kind === "unreadable" ? new HostError("invalid-params", err.message) : writeFailed(err);
      }
      try {
        // The folder is unclaimed again: its own profile comes back as its file held it.
        if (profileText !== null) await profiles.restore(folder, profileText);
      } catch (err) {
        // Nothing half-done: the agent keeps the folder.
        await profiles.restore(agent, before).catch(() => undefined);
        await refresh();
        throw err instanceof RecordError && err.kind === "unreadable" ? new HostError("invalid-params", err.message) : writeFailed(err);
      }
      await refresh();
      const restored = profiles.get(agent)?.value;
      if (restored === undefined || restored === null) throw new HostError("io-error", `The profile of ${agent} could not be read back`);
      return restored;
    },

    async removeOrphan(id) {
      await orphanAgent(id);
      try {
        await (profiles as FileSet<AgentProfile>).remove(id);
      } catch (err) {
        throw writeFailed(err);
      }
      await refresh();
    },

    async permissions(id) {
      const { profile } = livingAgent(id);
      const configDir = resolve(profile.configDir);
      if (configDir === null) throw new HostError("not-found", `The config folder of ${JSON.stringify(id)} cannot be resolved`);
      return readPermissions({ provider: profile.provider, configDir, builtin: profile.kind === "builtin", home });
    },

    async memory(id) {
      const { profile } = livingAgent(id);
      const configDir = resolve(profile.configDir);
      return configDir === null ? { folders: [] } : readMemory(profile.provider, configDir);
    },

    async modelConfig(id) {
      const { profile } = livingAgent(id);
      const configDir = resolve(profile.configDir);
      if (configDir === null) throw new HostError("not-found", `The config folder of ${JSON.stringify(id)} cannot be resolved`);
      return readModelConfig(profile.provider, configDir);
    },

    async setModel(id, change) {
      // Without a workspace the built-ins are shown read-only, their model included (DESIGN §3.3).
      if (profiles === null) throw new HostError("not-ready", noProfiles);
      const { profile } = livingAgent(id);
      const configDir = resolve(profile.configDir);
      if (configDir === null) throw new HostError("not-found", `The config folder of ${JSON.stringify(id)} cannot be resolved`);
      try {
        const written = await writeModelConfig(profile.provider, configDir, change);
        await refresh();
        return written;
      } catch (err) {
        if (err instanceof ModelWriteError) throw new HostError(err.kind === "read-only" ? "invalid-params" : "io-error", err.message);
        throw err;
      }
    },

    refresh,

    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    stop() {
      stopped = true;
      clearInterval(tick);
      if (settleTimer) clearTimeout(settleTimer);
      unsubscribe?.();
    },
  };
}
