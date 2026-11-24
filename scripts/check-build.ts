// The last step of `npm run build`: fails the build when `dist/` is not an installable app folder.

import { fileURLToPath } from "node:url";

import { buildFolderProblems } from "./build-folder.ts";

const dist = fileURLToPath(new URL("../dist", import.meta.url));
const problems = await buildFolderProblems(dist);
if (problems.length > 0) {
  for (const problem of problems) console.error(`dist/${problem}`);
  process.exit(1);
}
