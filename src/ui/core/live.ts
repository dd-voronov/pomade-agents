// A live state in words (ARCHITECTURE §2.4, glossary "Live state"), as every surface says it.

import type { SessionLiveState } from "pomade-kit/protocol";

export const LIVE_LABELS: Record<SessionLiveState, string> = {
  working: "Working",
  "needs-you": "Needs you",
  idle: "Idle",
  closed: "Closed",
};
