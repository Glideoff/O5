import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";

/** Version injectée au build depuis package.json (Vite). */
export const BUILD_VERSION = import.meta.env.VITE_APP_VERSION as string;

export async function resolveAppVersion(): Promise<string> {
  if (isTauri()) {
    try {
      return await getVersion();
    } catch {
      /* fallback */
    }
  }
  return BUILD_VERSION || "0.0.0";
}
