import type { ReactElement } from "react";

import { RosterIcon } from "../core/icons.tsx";
import { StatePage } from "../core/StatePage.tsx";

export function RosterTab(): ReactElement {
  return (
    <StatePage icon={<RosterIcon size={20} />} title="Roster" testId="roster-empty">
      Your agents will be listed here: what each one is for, its model, modes and skills. This view isn't built yet.
    </StatePage>
  );
}
