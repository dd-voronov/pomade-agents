import type { ReactElement } from "react";

import { SessionsIcon } from "../core/icons.tsx";
import { StatePage } from "../core/StatePage.tsx";

export function SessionsTab(): ReactElement {
  return (
    <StatePage icon={<SessionsIcon size={20} />} title="Sessions" testId="sessions-empty">
      The project's agent sessions will be listed here by status, each with its agent, model, context and cost. This
      view isn't built yet.
    </StatePage>
  );
}
