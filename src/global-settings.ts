import { isTauri } from "@tauri-apps/api/core";
import { invoke } from "./api";
import defaults from "./global-settings-defaults.json";

export interface AppSettings {
  agentsMarkdown: string;
  commitConvention: string;
  pullRequestConvention: string;
  branchConvention: string;
}
export const defaultAppSettings: AppSettings = defaults;
const previewStorageKey = "workbench.previewGlobalSettings";

export async function loadAppSettings(): Promise<AppSettings> {
  if (isTauri()) return invoke<AppSettings>("load_app_settings");
  let stored: string | null;
  try {
    stored = localStorage.getItem(previewStorageKey);
  } catch {
    return { ...defaults };
  }
  if (!stored) return { ...defaults };
  try {
    const value: unknown = JSON.parse(stored);
    if (
      !value ||
      typeof value !== "object" ||
      !Object.keys(defaults).every(
        (key) => typeof (value as Record<string, unknown>)[key] === "string",
      )
    )
      throw new Error();
    return Object.fromEntries(
      Object.keys(defaults).map((key) => [
        key,
        (value as Record<string, string>)[key],
      ]),
    ) as unknown as AppSettings;
  } catch {
    throw new Error("Could not read global settings.");
  }
}

export async function saveAppSettings(settings: AppSettings): Promise<void> {
  if (isTauri()) return invoke("save_app_settings", { settings });
  try {
    localStorage.setItem(previewStorageKey, JSON.stringify(settings));
  } catch {
    throw new Error("Could not save global settings.");
  }
}
