// Saving an agent's role line or tags: `roster.updateProfile` through Pomade's broker. A toast says
// what was saved, or what was not and why. The profile the backend answers goes to `onSaved`, so the
// frame shows the new value at once; the roster follows the file with `roster.changed`.

import { useCallback } from "react";
import type { HostClient } from "pomade-kit/sdk";

import { ROSTER_UPDATE_PROFILE_METHOD, isRosterUpdateProfileResult, type AgentProfile, type RosterUpdateProfileParams } from "../../../shared/roster.ts";
import type { ShowToast } from "../../sessions/useToast.ts";
import { SAVED_TEXT, failureText, type EditKind } from "./profile-edit-model.ts";

const ANSWER_TIMEOUT_MS = 5000;

export interface ProfileEdit {
  /** Save the role line (`null` removes it). Resolves `true` when saved. */
  saveRole: (agent: string, role: string | null) => Promise<boolean>;
  /** Save the whole tag list. Resolves `true` when saved. */
  saveTags: (agent: string, tags: readonly string[]) => Promise<boolean>;
}

export function useProfileEdit(host: HostClient, show: ShowToast, onSaved: (profile: AgentProfile) => void): ProfileEdit {
  const save = useCallback(
    async (params: RosterUpdateProfileParams, kind: EditKind): Promise<boolean> => {
      try {
        const answer = await host.apps.call(host.welcome.appId, ROSTER_UPDATE_PROFILE_METHOD, params, { timeoutMs: ANSWER_TIMEOUT_MS });
        if (!isRosterUpdateProfileResult(answer)) throw new Error("the backend's answer was malformed");
        onSaved(answer.profile);
        show(SAVED_TEXT[kind], null);
        return true;
      } catch (err) {
        const failed = failureText(kind, err);
        show(failed.text, null, failed.reason);
        return false;
      }
    },
    [host, show, onSaved],
  );
  return {
    saveRole: useCallback((agent, role) => save({ agent, role }, "role"), [save]),
    saveTags: useCallback((agent, tags) => save({ agent, tags: [...tags] }, "tags"), [save]),
  };
}
