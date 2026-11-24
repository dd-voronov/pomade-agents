// What makes a build folder installable (HOST-API §1, §2): a valid manifest, every file it names
// present — UI entry, icon, backend, each command's entry — and each skill folder holding a
// `SKILL.md` whose frontmatter names the skill and says when to use it. `npm run build` ends with
// this check (`check-build.ts`); `src/shared/manifest.test.ts` holds the skills' master copies to
// the same rules.

import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

import { parseManifest, readFrontmatter } from "pomade-kit/protocol";

/** Agents read a skill's description to decide whether to load it; Claude Code caps it here. */
export const SKILL_DESCRIPTION_MAX = 1024;

/** Why a `SKILL.md` text is not a valid skill named `name`; empty when it is. */
export function skillProblems(name: string, text: string): string[] {
  const read = readFrontmatter(text);
  if ("frontmatterError" in read) return [`its frontmatter is invalid: ${read.frontmatterError}`];
  const { frontmatter } = read;
  if (frontmatter === null) return ["it has no frontmatter"];
  const problems: string[] = [];
  if (frontmatter.name !== name) problems.push(`its name is ${JSON.stringify(frontmatter.name)}, not its folder's ${JSON.stringify(name)}`);
  const { description } = frontmatter;
  if (typeof description !== "string" || description.trim() === "") problems.push("it has no description");
  else if (description.length > SKILL_DESCRIPTION_MAX) problems.push(`its description is longer than ${SKILL_DESCRIPTION_MAX} characters`);
  return problems;
}

/** Why the build folder `dir` cannot be installed; empty when it can. */
export async function buildFolderProblems(dir: string): Promise<string[]> {
  const parsed = parseManifest(JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")));
  if (!parsed.ok) return parsed.errors.map((e) => `manifest.json: ${e.field}: ${e.message}`);
  const { manifest } = parsed;
  const named = [manifest.entry ?? "index.html", manifest.icon, manifest.backend?.entry, ...(manifest.commands ?? []).map((c) => c.entry)].filter((path) => path !== undefined);
  const problems: string[] = [];
  for (const path of named) {
    await access(join(dir, path)).catch(() => problems.push(`the manifest names "${path}", which the build did not produce`));
  }
  for (const skill of manifest.skills ?? []) {
    const file = `${skill.path}/SKILL.md`;
    const text = await readFile(join(dir, file), "utf8").catch(() => null);
    if (text === null) problems.push(`the manifest names the skill "${skill.path}", which holds no SKILL.md`);
    else problems.push(...skillProblems(skill.name, text).map((problem) => `${file}: ${problem}`));
  }
  return problems;
}
