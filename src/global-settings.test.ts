import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ enabled: false, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => native.enabled }));
vi.mock("./api", () => ({ invoke: native.invoke }));
import {
  defaultAppSettings,
  loadAppSettings,
  saveAppSettings,
} from "./global-settings";

beforeEach(() => {
  native.enabled = false;
  native.invoke.mockReset();
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("global instruction settings", () => {
  it("restores shared rules independently of workspace data in browser preview", async () => {
    expect(await loadAppSettings()).toEqual(defaultAppSettings);
    const settings = {
      ...defaultAppSettings,
      agentsMarkdown: "# Shared rules",
      branchConvention: "feature/{ticket}",
    };
    await saveAppSettings(settings);
    expect(await loadAppSettings()).toEqual(settings);
    expect(localStorage.getItem("workspace")).toBeNull();
  });
  it("does not silently overwrite corrupt saved instructions", async () => {
    localStorage.setItem("workbench.previewGlobalSettings", "invalid");
    await expect(loadAppSettings()).rejects.toThrow(
      "Could not read global settings.",
    );
    localStorage.setItem(
      "workbench.previewGlobalSettings",
      JSON.stringify({ agentsMarkdown: false }),
    );
    await expect(loadAppSettings()).rejects.toThrow(
      "Could not read global settings.",
    );
  });
  it("keeps the app usable when storage is blocked and reports failed saves", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(await loadAppSettings()).toEqual(defaultAppSettings);
    await expect(saveAppSettings(defaultAppSettings)).rejects.toThrow(
      "Could not save global settings.",
    );
  });
  it("uses native persistence for desktop settings rather than browser preview values", async () => {
    native.enabled = true;
    native.invoke
      .mockResolvedValueOnce(defaultAppSettings)
      .mockResolvedValueOnce(undefined);
    expect(await loadAppSettings()).toEqual(defaultAppSettings);
    expect(native.invoke).toHaveBeenNthCalledWith(1, "load_app_settings");
    await saveAppSettings(defaultAppSettings);
    expect(native.invoke).toHaveBeenNthCalledWith(2, "save_app_settings", {
      settings: defaultAppSettings,
    });
    expect(localStorage.getItem("workbench.previewGlobalSettings")).toBeNull();
  });
});
