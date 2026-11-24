// Each mode's launch spec for the Model & modes tab, asked from the backend's own `roster.launchSpec`
// — the spec Pomade's "+" menu and Runner build from — for a new session with no id of the
// caller's. Asked again when the roster changes. A mode the backend refuses (switched off) answers
// its reason.

import { useEffect, useState } from "react";
import type { HostClient } from "pomade-kit/sdk";

import { ROSTER_LAUNCH_SPEC_METHOD, isLaunchSpec, type LaunchSpec, type ModeId } from "../../../shared/roster.ts";

const ANSWER_TIMEOUT_MS = 5000;

export type LaunchLine = { ok: true; spec: LaunchSpec } | { ok: false; reason: string };

/** The launch line of each of `modes` for `agent`; a mode is absent until answered. */
export function useLaunchLines(host: HostClient, agent: string, modes: readonly ModeId[], again: unknown): ReadonlyMap<ModeId, LaunchLine> {
  const [lines, setLines] = useState<{ agent: string; byMode: ReadonlyMap<ModeId, LaunchLine> }>({ agent, byMode: new Map() });
  const key = modes.join(" ");

  useEffect(() => {
    let cancelled = false;
    const wanted = key === "" ? [] : (key.split(" ") as ModeId[]);
    void Promise.all(
      wanted.map(async (mode): Promise<[ModeId, LaunchLine]> => {
        try {
          const spec = await host.apps.call(host.welcome.appId, ROSTER_LAUNCH_SPEC_METHOD, { agent, mode }, { timeoutMs: ANSWER_TIMEOUT_MS });
          return [mode, isLaunchSpec(spec) ? { ok: true, spec } : { ok: false, reason: "the backend's answer was malformed" }];
        } catch (err) {
          return [mode, { ok: false, reason: err instanceof Error ? err.message : String(err) }];
        }
      }),
    ).then((answered) => {
      if (!cancelled) setLines({ agent, byMode: new Map(answered) });
    });
    return () => {
      cancelled = true;
    };
  }, [host, agent, key, again]);

  return lines.agent === agent ? lines.byMode : new Map();
}
