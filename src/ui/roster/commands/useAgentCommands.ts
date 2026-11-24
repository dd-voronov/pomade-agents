// What an agent's actions do, one implementation for a card, a list row and the agent's page:
// start a session in a project (`agentTabs.launch` — Pomade builds the command line from
// `roster.launchSpec`), open its sessions in the Workspace's Sessions tab, hide it from Pomade's "+"
// menu or show it there again (with Undo), open its files in Pomade's editor, and, for an orphan,
// re-link it to an unclaimed agent folder or remove its profile. A toast says what was done, or what
// was not and why; the backend's own words show on hover. A launch says nothing when it works:
// Pomade switches to the new tab.

import { useCallback, useMemo } from "react";
import { WORKSPACE_PROJECT_ID } from "pomade-kit/protocol";
import { HostError, type HostClient } from "pomade-kit/sdk";

import {
  ROSTER_RELINK_METHOD,
  ROSTER_REMOVE_ORPHAN_METHOD,
  ROSTER_UNCLAIMED_FOLDERS_METHOD,
  ROSTER_UNDO_RELINK_METHOD,
  ROSTER_UPDATE_PROFILE_METHOD,
  isRemoveOrphanResult,
  isRosterRelinkResult,
  isRosterUpdateProfileResult,
  isUnclaimedFoldersAnswer,
  type AgentProfile,
  type ModeId,
  type UnclaimedFolder,
} from "../../../shared/roster.ts";
import { sessionsFilterRoute } from "../../core/routes.ts";
import type { ShowToast } from "../../sessions/useToast.ts";
import { useOpenFile } from "../agent-page/open-file.ts";
import type { WorkspaceRoots } from "../agent-page/agent-model.ts";
import { hiddenText, refusedText, relinkedText, relinkUndoneText, removedText } from "./commands-model.ts";

const ANSWER_TIMEOUT_MS = 5000;

export interface AgentCommands {
  /** Start a session of `agent` in `mode`, in the project `projectId` (`"__workspace__"`: the Workspace). */
  launch: (agent: string, mode: ModeId, projectId: string) => void;
  /** The Workspace's Sessions tab with its Agent filter on `agent`. */
  openSessions: (agent: string) => void;
  /** Leave the agent out of Pomade's "+" menu, or offer it there again; the toast offers Undo. */
  setHidden: (agent: string, name: string, hidden: boolean) => void;
  /** Open an absolute path in Pomade's editor. */
  openFile: (absolute: string) => void;
  /** The agent folders an orphan can be re-linked to; rejects when the backend does not answer. */
  unclaimedFolders: () => Promise<UnclaimedFolder[]>;
  /** Point the orphan at `folder`; the toast offers Undo. */
  relink: (agent: string, name: string, folder: UnclaimedFolder) => void;
  /** Remove the orphan's profile; resolves `true` when it is gone. */
  removeOrphan: (agent: string, name: string) => Promise<boolean>;
}

const reasonOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const codeOf = (err: unknown): string | null => (err instanceof HostError ? err.code : null);

export function useAgentCommands(host: HostClient, show: ShowToast, roots: WorkspaceRoots, onSaved: (profile: AgentProfile) => void): AgentCommands {
  const openFile = useOpenFile(host, roots, show);
  const call = useCallback((method: string, params: Record<string, unknown>): Promise<unknown> => host.apps.call(host.welcome.appId, method, params as never, { timeoutMs: ANSWER_TIMEOUT_MS }), [host]);

  const launch = useCallback<AgentCommands["launch"]>(
    (agent, mode, projectId) => {
      host.agentTabs.launch({ agentId: agent, projectId, mode }).catch((err: unknown) => show(refusedText("The session was not started.", codeOf(err)), null, reasonOf(err)));
    },
    [host, show],
  );

  const openSessions = useCallback<AgentCommands["openSessions"]>(
    (agent) => {
      host.tabs.openApp({ route: sessionsFilterRoute({ agent }), projectId: WORKSPACE_PROJECT_ID }).catch((err: unknown) => show("Sessions was not opened.", null, reasonOf(err)));
    },
    [host, show],
  );

  const setHidden = useCallback<AgentCommands["setHidden"]>(
    (agent, name, hidden) => {
      const write = async (to: boolean, undo: boolean): Promise<void> => {
        try {
          const answer = await call(ROSTER_UPDATE_PROFILE_METHOD, { agent, hidden: to });
          if (!isRosterUpdateProfileResult(answer)) throw new Error("the backend's answer was malformed");
          onSaved(answer.profile);
          show(hiddenText(name, to), undo ? () => void write(!to, false) : null);
        } catch (err) {
          show(refusedText(to ? `${name} was not hidden.` : `${name} was not shown.`, codeOf(err)), null, reasonOf(err));
        }
      };
      void write(hidden, true);
    },
    [call, show, onSaved],
  );

  const unclaimedFolders = useCallback(async (): Promise<UnclaimedFolder[]> => {
    const answer = await call(ROSTER_UNCLAIMED_FOLDERS_METHOD, {});
    if (!isUnclaimedFoldersAnswer(answer)) throw new Error("the backend's answer was malformed");
    return answer.folders;
  }, [call]);

  const relink = useCallback<AgentCommands["relink"]>(
    (agent, name, folder) => {
      void (async () => {
        try {
          const answer = await call(ROSTER_RELINK_METHOD, { agent, folder: folder.name });
          if (!isRosterRelinkResult(answer)) throw new Error("the backend's answer was malformed");
          const { undo } = answer;
          show(relinkedText(name, folder.configDir), () => {
            call(ROSTER_UNDO_RELINK_METHOD, undo).then(
              (undone) => {
                if (!isRosterUpdateProfileResult(undone)) throw new Error("the backend's answer was malformed");
                show(relinkUndoneText(name, folder.configDir), null);
              },
              (err: unknown) => show(refusedText(`The re-link of ${name} was not taken back.`, codeOf(err)), null, reasonOf(err)),
            ).catch((err: unknown) => show(refusedText(`The re-link of ${name} was not taken back.`, null), null, reasonOf(err)));
          });
        } catch (err) {
          show(refusedText(`${name} was not re-linked.`, codeOf(err)), null, reasonOf(err));
        }
      })();
    },
    [call, show],
  );

  const removeOrphan = useCallback<AgentCommands["removeOrphan"]>(
    async (agent, name) => {
      try {
        const answer = await call(ROSTER_REMOVE_ORPHAN_METHOD, { agent });
        if (!isRemoveOrphanResult(answer)) throw new Error("the backend's answer was malformed");
        show(removedText(name), null);
        return true;
      } catch (err) {
        show(refusedText(`${name}’s profile was not removed.`, codeOf(err)), null, reasonOf(err));
        return false;
      }
    },
    [call, show],
  );

  return useMemo(() => ({ launch, openSessions, setHidden, openFile, unclaimedFolders, relink, removeOrphan }), [launch, openSessions, setHidden, openFile, unclaimedFolders, relink, removeOrphan]);
}
