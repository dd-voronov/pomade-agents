// The skills catalog, kept current: asked through Pomade's broker (`apps.call` to the app's own
// `skills.catalog`), then again whenever the backend's `skills.changed` says the folder list
// changed, and whenever the tab comes back into view — the catalog is read from disk on request, so
// skills and links made meanwhile show then. While the backend does not answer, it asks again
// every second. A change made here — the folder list, a skill's link — sets the catalog its answer
// carries.

import { useCallback, useEffect, useRef, useState } from "react";
import type { HostClient } from "pomade-kit/sdk";

import {
  SETTINGS_SET_SKILL_FOLDERS_METHOD,
  SKILLS_CATALOG_METHOD,
  SKILLS_CHANGED_EVENT,
  SKILLS_LINK_METHOD,
  SKILLS_UNLINK_METHOD,
  isSetSkillFoldersResult,
  isSkillLinkResult,
  isSkillsCatalog,
  isSkillsChanged,
  type SetSkillFoldersResult,
  type SkillLinkParams,
  type SkillLinkResult,
  type SkillUnlinkParams,
  type SkillsCatalog,
} from "../../shared/skills.ts";

const ANSWER_TIMEOUT_MS = 5000;
const RETRY_MS = 1000;

export interface SkillsCatalogState {
  /** `null` until the first answer. */
  catalog: SkillsCatalog | null;
  /** Write `folders` as the list; the catalog follows the answer. Rejects as the call does. */
  setFolders: (folders: string[]) => Promise<SetSkillFoldersResult>;
  /** Make a link in an agent's `skills/` (`skills.link`); the catalog follows the answer. Rejects as the call does. */
  link: (params: SkillLinkParams) => Promise<SkillLinkResult>;
  /** Take a link out of an agent's `skills/` (`skills.unlink`); the catalog follows the answer. Rejects as the call does. */
  unlink: (params: SkillUnlinkParams) => Promise<SkillLinkResult>;
}

export function useSkillsCatalog(host: HostClient): SkillsCatalogState {
  const [catalog, setCatalog] = useState<SkillsCatalog | null>(null);
  const askRef = useRef<() => Promise<void>>(() => Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    let asking = false;
    let again = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const ask = async (): Promise<void> => {
      if (asking) {
        again = true;
        return;
      }
      asking = true;
      clearTimeout(retry);
      try {
        const next = await host.apps.call(host.welcome.appId, SKILLS_CATALOG_METHOD, {}, { timeoutMs: ANSWER_TIMEOUT_MS });
        if (cancelled) return;
        if (!isSkillsCatalog(next)) throw new Error("malformed answer");
        setCatalog(next);
      } catch {
        if (!cancelled) retry = setTimeout(() => void ask(), RETRY_MS);
      } finally {
        asking = false;
        if (again && !cancelled) {
          again = false;
          void ask();
        }
      }
    };
    askRef.current = ask;

    const subscription = host.events.subscribe(`${host.welcome.appId}:${SKILLS_CHANGED_EVENT}`, (payload) => {
      if (isSkillsChanged(payload)) void ask();
    });
    const onVisible = (): void => {
      if (document.visibilityState === "visible") void ask();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    // Asked once the subscription stands, so no change after the first answer goes unheard.
    void subscription.then(
      () => ask(),
      () => ask(),
    );
    return () => {
      cancelled = true;
      clearTimeout(retry);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      void subscription.then((s) => s.close()).catch(() => undefined);
    };
  }, [host]);

  const setFolders = useCallback(
    async (folders: string[]): Promise<SetSkillFoldersResult> => {
      const answer = await host.apps.call(host.welcome.appId, SETTINGS_SET_SKILL_FOLDERS_METHOD, { folders }, { timeoutMs: ANSWER_TIMEOUT_MS });
      if (!isSetSkillFoldersResult(answer)) throw new Error("The backend's answer was malformed.");
      if (answer.ok) setCatalog(answer.catalog);
      else void askRef.current();
      return answer;
    },
    [host],
  );

  const write = useCallback(
    async (method: string, params: SkillLinkParams | SkillUnlinkParams): Promise<SkillLinkResult> => {
      const answer = await host.apps.call(host.welcome.appId, method, params, { timeoutMs: ANSWER_TIMEOUT_MS });
      if (!isSkillLinkResult(answer)) throw new Error("The backend's answer was malformed.");
      if (answer.ok) setCatalog(answer.catalog);
      else void askRef.current();
      return answer;
    },
    [host],
  );
  const link = useCallback((params: SkillLinkParams) => write(SKILLS_LINK_METHOD, params), [write]);
  const unlink = useCallback((params: SkillUnlinkParams) => write(SKILLS_UNLINK_METHOD, params), [write]);

  return { catalog, setFolders, link, unlink };
}
