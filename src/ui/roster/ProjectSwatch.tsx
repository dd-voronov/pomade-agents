// A project's swatch: an 8 px square in one of `PROJECT_TINTS`, chosen by the project's id, since
// Pomade gives a project no colour. Shown beside a project's name wherever the Roster names one.

import type { ReactElement } from "react";

import { projectTint } from "./list/connected-model.ts";
import styles from "./ProjectSwatch.module.css";

export function ProjectSwatch({ id, className }: { id: string; className?: string | undefined }): ReactElement {
  return <span className={className === undefined ? styles.swatch : `${styles.swatch} ${className}`} data-tint={projectTint(id)} aria-hidden="true" />;
}
