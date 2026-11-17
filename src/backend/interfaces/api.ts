// The API the backend serves through Pomade's broker (HOST-API §4 `apps`): one handler per method
// in the manifest's `api`. The UI reaches it with `apps.call`, as other apps and Pomade do.

import type { ApiHandler } from "pomade-kit/sdk";

import { APP_INFO_METHOD, type AppInfo } from "../../shared/api.ts";

export function createApi(info: AppInfo): Record<string, ApiHandler> {
  return {
    [APP_INFO_METHOD]: () => ({ ...info }),
  };
}
