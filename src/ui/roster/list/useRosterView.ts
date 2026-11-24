// The Roster's view (cards or list), remembered on this Mac in the frame's own storage — the
// frame's origin is the app's, so the choice is the app's and the machine's. Storage that is
// blocked or full leaves the choice for the session only.

import { useCallback, useState } from "react";

import { DEFAULT_VIEW, viewOf, type RosterView } from "./roster-model.ts";

const STORAGE_KEY = "pomade-agents.roster.view";

function stored(): RosterView {
  try {
    return viewOf(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_VIEW;
  }
}

export function useRosterView(): [RosterView, (view: RosterView) => void] {
  const [view, setView] = useState<RosterView>(stored);
  const choose = useCallback((next: RosterView) => {
    setView(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not remembered; the choice holds until the frame reloads.
    }
  }, []);
  return [view, choose];
}
