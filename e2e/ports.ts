/** Where the e2e serves the built app and the fake Pomade's shell page. Each app repo of the family
 *  has its own pair (pomade-runner 4327/4328, pomade-planner 4417/4418), so their suites can run at
 *  the same time. */
export const APP_PORT = 4337;
export const SHELL_PORT = 4338;

export const APP_URL = `http://localhost:${APP_PORT}/`;
export const SHELL_URL = `http://localhost:${SHELL_PORT}/index.html`;
