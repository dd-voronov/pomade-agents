// A session's name as its rows show it: the fork mark, the name (the first message in grey when
// it is unnamed) and its chips — an unattended run, "shared folder", "outside Pomade".

import type { ReactElement } from "react";

import { ForkIcon, TimerIcon } from "../core/icons.tsx";
import type { Session } from "../../shared/sessions.ts";
import { chipsOf, rowName } from "./table-model.ts";
import styles from "./SessionName.module.css";

export interface SessionNameProps {
  session: Session;
  /** Project names by id. */
  names: ReadonlyMap<string, string>;
  /** The fork mark's tooltip; `null`: no fork. */
  fork: string | null;
}

export function SessionName({ session, names, fork }: SessionNameProps): ReactElement {
  const name = rowName(session);
  const chips = chipsOf(session, names);
  return (
    <>
      {fork !== null && (
        <span className={styles.fork} title={fork} data-testid="fork-mark">
          <ForkIcon size={14} />
        </span>
      )}
      <span className={styles.name} data-unnamed={name.unnamed ? "" : undefined} title={name.text}>
        {name.text}
      </span>
      {chips.length > 0 && (
        <span className={styles.chips}>
          {chips.map((chip) => (
            <span key={chip.kind} className={styles.chip} data-kind={chip.kind} title={chip.tooltip} data-testid={`chip-${chip.kind}`}>
              {chip.kind === "runner" && <TimerIcon size={11} />}
              {chip.text}
            </span>
          ))}
        </span>
      )}
    </>
  );
}
