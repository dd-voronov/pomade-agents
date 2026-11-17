// The backend's state as the UI sees it: asked through Pomade's broker (`apps.call` to the app's
// own API), again every few seconds — sooner while it does not answer — because Pomade restarts a
// backend that crashed and stops it on an update.

import { useEffect, useState } from "react";
import { HostError, type HostClient } from "pomade-kit/sdk";

import { APP_INFO_METHOD, isAppInfo, type AppInfo } from "../../shared/api.ts";

export type BackendState =
  | { status: "checking" }
  | { status: "running"; info: AppInfo }
  /** `reason`: the broker's error code, or what was wrong with the answer. */
  | { status: "down"; reason: string };

const ANSWER_TIMEOUT_MS = 2000;
const RECHECK_RUNNING_MS = 15000;
const RECHECK_DOWN_MS = 1000;

async function ask(host: HostClient): Promise<BackendState> {
  try {
    const value = await host.apps.call(host.welcome.appId, APP_INFO_METHOD, {}, { timeoutMs: ANSWER_TIMEOUT_MS });
    return isAppInfo(value) ? { status: "running", info: value } : { status: "down", reason: "malformed answer" };
  } catch (err) {
    return { status: "down", reason: err instanceof HostError ? err.code : String(err) };
  }
}

function same(a: BackendState, b: BackendState): boolean {
  if (a.status === "running" && b.status === "running") {
    return a.info.startedAt === b.info.startedAt && a.info.version === b.info.version;
  }
  if (a.status === "down" && b.status === "down") return a.reason === b.reason;
  return a.status === b.status;
}

export function useBackendInfo(host: HostClient): BackendState {
  const [state, setState] = useState<BackendState>({ status: "checking" });
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async (): Promise<void> => {
      const next = await ask(host);
      if (cancelled) return;
      setState((prev) => (same(prev, next) ? prev : next));
      timer = setTimeout(() => void check(), next.status === "running" ? RECHECK_RUNNING_MS : RECHECK_DOWN_MS);
    };
    void check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [host]);
  return state;
}
