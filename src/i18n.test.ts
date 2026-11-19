import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import english from "./locales/en.json";
import portuguese from "./locales/pt.json";

const nativeInvoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({ invoke: nativeInvoke }));

beforeEach(() => {
  vi.resetModules();
  nativeInvoke.mockClear();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal("document", { documentElement: { lang: "" } });
});
afterEach(() => vi.unstubAllGlobals());

describe("application languages", () => {
  it("starts in English regardless of the system language", async () => {
    vi.stubGlobal("navigator", { language: "pt-PT" });
    const { getLocale, t } = await import("./i18n");
    expect(getLocale()).toBe("en");
    expect(t("New conversation")).toBe("New conversation");
    expect(document.documentElement.lang).toBe("en");
  });

  it("persists the selected language and restores it on startup", async () => {
    const { selectLocale, t, dateLocale } = await import("./i18n");
    selectLocale("pt");
    expect(localStorage.getItem("workbench.locale")).toBe("pt");
    expect(document.documentElement.lang).toBe("pt");
    expect(t("New conversation")).toBe("Nova conversa");
    expect(dateLocale()).toBe("pt-PT");
    vi.resetModules();
    expect((await import("./i18n")).getLocale()).toBe("pt");
  });

  it("falls back to English for unsupported preferences and blocked storage", async () => {
    localStorage.setItem("workbench.locale", "fr");
    expect((await import("./i18n")).getLocale()).toBe("en");
    vi.resetModules();
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    const { getLocale, selectLocale } = await import("./i18n");
    expect(getLocale()).toBe("en");
    selectLocale("pt");
    expect(getLocale()).toBe("pt");
  });

  it("keeps catalog keys and interpolation parameters in sync", () => {
    expect(Object.keys(portuguese).sort()).toEqual(Object.keys(english).sort());
    for (const key of Object.keys(english) as (keyof typeof english)[]) {
      expect(english[key]).toBe(key);
      expect(portuguese[key].trim()).not.toBe("");
      const placeholders = (value: string) =>
        [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      expect(placeholders(portuguese[key]), key).toEqual(placeholders(key));
    }
  });

  it("interpolates named values literally and preserves unknown content", async () => {
    const { translate } = await import("./i18n");
    expect(translate("Environment {name}", "pt", { name: "$& <script>" })).toBe(
      "Ambiente $& <script>",
    );
    expect(translate("my code and user content", "pt")).toBe(
      "my code and user content",
    );
  });

  it("localizes API errors and old task records after switching languages", async () => {
    const { selectLocale, localizeMessage, t } = await import("./i18n");
    selectLocale("pt");
    expect(localizeMessage("Invalid environment.")).toBe("Ambiente inválido.");
    expect(localizeMessage("Error: Invalid environment.")).toBe(
      "Ambiente inválido.",
    );
    expect(localizeMessage({ secret: "must not be displayed" })).toBe(
      "Ocorreu um erro inesperado. Tenta novamente.",
    );
    selectLocale("en");
    expect(localizeMessage("Ambiente inválido.")).toBe("Invalid environment.");
    expect(t("Ação autorizada uma vez.")).toBe("Action allowed once.");
    const cleanup =
      "Docker did not confirm container cleanup. Check Docker before continuing.";
    expect(localizeMessage(`Ambiente inválido. ${portuguese[cleanup]}`)).toBe(
      `Invalid environment. ${cleanup}`,
    );
  });

  it("sends the selected language on every native API request", async () => {
    const { invoke } = await import("./api");
    const { selectLocale } = await import("./i18n");
    await invoke("load_workspace");
    expect(nativeInvoke).toHaveBeenLastCalledWith("load_workspace", {
      locale: "en",
    });
    selectLocale("pt");
    await invoke("worker_runtime", { locale: "en", environmentId: "personal" });
    expect(nativeInvoke).toHaveBeenLastCalledWith("worker_runtime", {
      locale: "pt",
      environmentId: "personal",
    });
  });
});
