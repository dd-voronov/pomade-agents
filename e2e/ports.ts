/** Where the e2e serves the built app and the fake Pomade's shell page. Each app repo of the family
 *  has its own pair (pomade-runner 4327/4328, pomade-planner 4417/4418), so their suites can run at
 *  the same time. `AGENTS_E2E_PORT_BASE` moves the pair, so two worktrees of this repo can run
 *  their suites at the same time too. */
const base = Number(process.env.AGENTS_E2E_PORT_BASE ?? 4337);
if (!Number.isInteger(base) || base < 1024 || base > 65534) throw new Error(`AGENTS_E2E_PORT_BASE must be a port number, got "${process.env.AGENTS_E2E_PORT_BASE}"`);

export const APP_PORT = base;
export const SHELL_PORT = base + 1;

export const APP_URL = `http://localhost:${APP_PORT}/`;
export const SHELL_URL = `http://localhost:${SHELL_PORT}/index.html`;
