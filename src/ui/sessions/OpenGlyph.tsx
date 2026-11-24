// Open / Resume's glyph: a box with an arrow out of it for a tab or a run's terminal, a play mark for a resume.

import type { ReactElement } from "react";

import { OpenIcon, ResumeIcon } from "../core/icons.tsx";
import type { OpenKind } from "./open-model.ts";

export function OpenGlyph({ kind, size = 16 }: { kind: OpenKind; size?: number }): ReactElement {
  return kind === "resumed" ? <ResumeIcon size={size} /> : <OpenIcon size={size} />;
}
